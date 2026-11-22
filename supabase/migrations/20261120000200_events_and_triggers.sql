-- LeadPilot AI — event outbox, delivery log and history triggers
--
-- Every business event is written to public.events in the SAME transaction
-- as the change that caused it (transactional outbox). Nothing is lost if a
-- webhook is down, and the unique idempotency_key guarantees that the same
-- business fact is never recorded twice. A dispatcher (Phase 2) claims rows
-- with FOR UPDATE SKIP LOCKED, POSTs them to n8n with an HMAC signature and
-- records each attempt in public.event_deliveries.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'lead.created', 'lead.assigned', 'lead.status_changed', 'task.created', 'task.overdue'
  )),
  aggregate_type text not null check (aggregate_type in ('lead', 'task')),
  aggregate_id uuid not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status public.event_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index events_dispatch_idx on public.events (next_attempt_at)
  where status in ('pending', 'failed');
create index events_created_idx on public.events (created_at desc);
create index events_aggregate_idx on public.events (aggregate_type, aggregate_id);

create table public.event_deliveries (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  attempt integer not null,
  success boolean not null,
  response_status integer,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index event_deliveries_event_idx on public.event_deliveries (event_id, created_at desc);

alter table public.events enable row level security;
alter table public.event_deliveries enable row level security;

create policy "events: admin read" on public.events
  for select to authenticated using (public.is_admin());

create policy "event_deliveries: admin read" on public.event_deliveries
  for select to authenticated using (public.is_admin());

revoke all on public.events, public.event_deliveries from anon;
revoke insert, update, delete on public.events, public.event_deliveries from authenticated;

-- ---------------------------------------------------------------------------
-- Emit helpers
-- ---------------------------------------------------------------------------
create or replace function public.emit_event(
  p_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_idempotency_key text,
  p_payload jsonb,
  p_is_demo boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.events (type, aggregate_type, aggregate_id, idempotency_key, payload, is_demo)
  values (
    p_type, p_aggregate_type, p_aggregate_id, p_idempotency_key,
    jsonb_build_object(
      'event', p_type,
      'occurred_at', now(),
      'idempotency_key', p_idempotency_key,
      'data', p_payload
    ),
    p_is_demo
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id; -- null when the event already existed
end;
$$;

create or replace function public.log_activity(
  p_lead_id uuid,
  p_type public.activity_type,
  p_details jsonb,
  p_is_demo boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  select coalesce(nullif(p.full_name, ''), p.email) into v_label
  from public.profiles p where p.id = auth.uid();

  insert into public.activities (lead_id, actor_id, actor_label, type, details, is_demo)
  values (p_lead_id, auth.uid(), coalesce(v_label, 'System'), p_type, coalesce(p_details, '{}'::jsonb), p_is_demo);
end;
$$;

create or replace function public.lead_event_payload(l public.leads)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lead_id', l.id,
    'full_name', l.full_name,
    'email', l.email,
    'phone', l.phone,
    'source', l.source,
    'status', l.status,
    'property_type', l.property_type,
    'budget', l.budget,
    'assigned_agent', (
      select jsonb_build_object('id', a.id, 'full_name', a.full_name, 'email', a.email)
      from public.agents a where a.id = l.assigned_agent_id
    ),
    'is_demo', l.is_demo
  );
$$;

-- ---------------------------------------------------------------------------
-- Lead triggers → history + events
-- ---------------------------------------------------------------------------
create or replace function public.leads_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if public.is_seeding() then
    return new;
  end if;

  v_payload := public.lead_event_payload(new);

  if tg_op = 'INSERT' then
    perform public.log_activity(new.id, 'lead_created',
      jsonb_build_object('source', new.source, 'status', new.status), new.is_demo);
    perform public.emit_event('lead.created', 'lead', new.id,
      'lead.created:' || new.id, v_payload, new.is_demo);

    if new.assigned_agent_id is not null then
      perform public.log_activity(new.id, 'assigned',
        jsonb_build_object('to_agent_id', new.assigned_agent_id), new.is_demo);
      perform public.emit_event('lead.assigned', 'lead', new.id,
        'lead.assigned:' || new.id || ':r' || new.revision,
        v_payload || jsonb_build_object('previous_agent_id', null), new.is_demo);
    end if;
    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    perform public.log_activity(new.id, 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status, 'lost_reason', new.lost_reason), new.is_demo);
    perform public.emit_event('lead.status_changed', 'lead', new.id,
      'lead.status_changed:' || new.id || ':r' || new.revision,
      v_payload || jsonb_build_object('previous_status', old.status), new.is_demo);
  end if;

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    if new.assigned_agent_id is null then
      perform public.log_activity(new.id, 'unassigned',
        jsonb_build_object('from_agent_id', old.assigned_agent_id), new.is_demo);
    else
      perform public.log_activity(new.id, 'assigned',
        jsonb_build_object('from_agent_id', old.assigned_agent_id, 'to_agent_id', new.assigned_agent_id), new.is_demo);
      perform public.emit_event('lead.assigned', 'lead', new.id,
        'lead.assigned:' || new.id || ':r' || new.revision,
        v_payload || jsonb_build_object('previous_agent_id', old.assigned_agent_id), new.is_demo);
    end if;
  end if;

  if new.next_follow_up_at is distinct from old.next_follow_up_at and new.next_follow_up_at is not null then
    perform public.log_activity(new.id, 'follow_up_scheduled',
      jsonb_build_object('at', new.next_follow_up_at), new.is_demo);
  end if;

  if (new.full_name, new.email, new.phone, new.source, new.property_type, new.property_interest,
      new.preferred_area, new.budget)
     is distinct from
     (old.full_name, old.email, old.phone, old.source, old.property_type, old.property_interest,
      old.preferred_area, old.budget) then
    perform public.log_activity(new.id, 'lead_updated', '{}'::jsonb, new.is_demo);
  end if;

  return new;
end;
$$;

create trigger leads_after_write after insert or update on public.leads
  for each row execute function public.leads_after_write();

-- ---------------------------------------------------------------------------
-- Task triggers
-- ---------------------------------------------------------------------------
create or replace function public.tasks_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_seeding() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.lead_id is not null then
      perform public.log_activity(new.lead_id, 'task_created',
        jsonb_build_object('task_id', new.id, 'title', new.title, 'due_at', new.due_at), new.is_demo);
    end if;
    perform public.emit_event('task.created', 'task', new.id, 'task.created:' || new.id,
      jsonb_build_object(
        'task_id', new.id, 'lead_id', new.lead_id, 'title', new.title,
        'due_at', new.due_at, 'priority', new.priority,
        'assigned_agent_id', new.assigned_agent_id, 'is_demo', new.is_demo
      ), new.is_demo);
    return new;
  end if;

  if new.lead_id is not null and (new.completed_at is null) <> (old.completed_at is null) then
    perform public.log_activity(new.lead_id,
      case when new.completed_at is not null then 'task_completed'::public.activity_type
           else 'task_reopened'::public.activity_type end,
      jsonb_build_object('task_id', new.id, 'title', new.title), new.is_demo);
  end if;
  return new;
end;
$$;

create trigger tasks_after_write after insert or update on public.tasks
  for each row execute function public.tasks_after_write();

create or replace function public.notes_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_seeding() then
    return new;
  end if;
  perform public.log_activity(new.lead_id, 'note_added',
    jsonb_build_object('note_id', new.id, 'preview', left(new.body, 140)), new.is_demo);
  return new;
end;
$$;

create trigger notes_after_insert after insert on public.lead_notes
  for each row execute function public.notes_after_insert();

-- ---------------------------------------------------------------------------
-- task.overdue — emitted by a scheduled job (Phase 2: n8n Cron or pg_cron).
-- Idempotent per (task, due date): re-running never duplicates an event, but
-- rescheduling a task and missing the new date emits a fresh one.
-- ---------------------------------------------------------------------------
create or replace function public.emit_overdue_task_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  t record;
begin
  if not (public.is_privileged_caller()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for t in
    select * from public.tasks
    where completed_at is null and due_at < now()
  loop
    if public.emit_event('task.overdue', 'task', t.id,
         'task.overdue:' || t.id || ':' || floor(extract(epoch from t.due_at))::bigint,
         jsonb_build_object(
           'task_id', t.id, 'lead_id', t.lead_id, 'title', t.title, 'due_at', t.due_at,
           'assigned_agent_id', t.assigned_agent_id, 'is_demo', t.is_demo
         ), t.is_demo) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatcher primitives (used by /api/events/dispatch with the secret key).
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_events(p_limit integer default 25)
returns setof public.events
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Release rows stuck in "processing" (e.g. the worker crashed mid-request).
  update public.events
     set status = 'failed', locked_at = null, last_error = coalesce(last_error, 'lock expired')
   where status = 'processing' and locked_at < now() - interval '5 minutes';

  return query
  update public.events e
     set status = 'processing', locked_at = now(), attempts = e.attempts + 1
   where e.id in (
     select id from public.events
      where status in ('pending', 'failed') and next_attempt_at <= now()
      order by created_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked
   )
  returning e.*;
end;
$$;

create or replace function public.complete_event_delivery(
  p_event_id uuid,
  p_success boolean,
  p_response_status integer default null,
  p_error text default null,
  p_duration_ms integer default null
)
returns public.event_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_status public.event_status;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event % not found', p_event_id;
  end if;

  insert into public.event_deliveries (event_id, attempt, success, response_status, error, duration_ms)
  values (p_event_id, v_event.attempts, p_success, p_response_status, left(p_error, 1000), p_duration_ms);

  if p_success then
    v_status := 'delivered';
    update public.events
       set status = v_status, delivered_at = now(), locked_at = null, last_error = null
     where id = p_event_id;
  else
    v_status := case when v_event.attempts >= 8 then 'dead'::public.event_status else 'failed'::public.event_status end;
    update public.events
       set status = v_status,
           locked_at = null,
           last_error = left(p_error, 1000),
           -- exponential backoff: 1, 2, 4 … minutes, capped at 6 hours
           next_attempt_at = now() + least(interval '6 hours', interval '1 minute' * power(2, greatest(v_event.attempts - 1, 0)))
     where id = p_event_id;
  end if;
  return v_status;
end;
$$;

revoke execute on function public.emit_event(text, text, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.log_activity(uuid, public.activity_type, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.lead_event_payload(public.leads) from public, anon, authenticated;
revoke execute on function public.leads_after_write() from public, anon, authenticated;
revoke execute on function public.tasks_after_write() from public, anon, authenticated;
revoke execute on function public.notes_after_insert() from public, anon, authenticated;
revoke execute on function public.emit_overdue_task_events() from public, anon;
revoke execute on function public.claim_pending_events(integer) from public, anon, authenticated;
revoke execute on function public.complete_event_delivery(uuid, boolean, integer, text, integer) from public, anon, authenticated;
grant execute on function public.emit_overdue_task_events() to authenticated, service_role;
grant execute on function public.claim_pending_events(integer) to service_role;
grant execute on function public.complete_event_delivery(uuid, boolean, integer, text, integer) to service_role;
