-- LeadPilot AI — Phase 2, stage A: n8n automations
--
-- automations        registry of workflows (name, trigger, enabled, settings)
-- automation_runs    one row per (automation, event): status, n8n execution id,
--                    result or error — what the Automations page reports
-- tasks              gains origin columns and a unique dedupe key so that
--                    processing the same event twice can never create two tasks
--
-- Flow: lead.created (outbox) → LeadPilot dispatcher → n8n webhook (header
-- auth) → n8n calls /api/automations/callback (bearer secret) → this file's
-- automation_create_follow_up_task() creates the task idempotently.

create table public.automations (
  key text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  name text not null,
  description text not null,
  trigger_event text not null,
  webhook_path text not null check (webhook_path ~ '^[a-z0-9-]{3,80}$'),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger automations_updated_at before update on public.automations
  for each row execute function public.set_updated_at();

insert into public.automations (key, name, description, trigger_event, webhook_path, enabled, settings, sort_order) values
  ('new_lead_follow_up',
   'New Lead Automation',
   'When a lead is created, n8n validates the event and creates a follow-up task for the assigned agent, due after the configured delay.',
   'lead.created', 'leadpilot-new-lead', true, '{"follow_up_hours": 24}'::jsonb, 1);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null references public.automations (key) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  lead_id uuid references public.leads (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts integer not null default 0,
  external_execution_id text check (external_execution_id is null or char_length(external_execution_id) <= 100),
  result jsonb not null default '{}'::jsonb,
  error text,
  is_demo boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (automation_key, event_id)
);

create index automation_runs_lead_idx on public.automation_runs (lead_id, started_at desc);
create index automation_runs_key_idx on public.automation_runs (automation_key, started_at desc);

alter table public.tasks
  add column source text not null default 'manual' check (source in ('manual', 'automation')),
  add column automation_key text references public.automations (key) on delete set null,
  add column automation_dedupe_key text unique;

-- ---------------------------------------------------------------------------
-- RLS: admins see everything; agents see runs for leads they can see.
-- Only SECURITY DEFINER functions (service role / admin) write.
-- ---------------------------------------------------------------------------
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

create policy "automations: read for team" on public.automations
  for select to authenticated using (true);

create policy "automations: admin update" on public.automations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "automation_runs: read" on public.automation_runs
  for select to authenticated
  using (public.is_admin() or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id)));

revoke all on public.automations, public.automation_runs from anon;
grant select, update on public.automations to authenticated;
grant select on public.automation_runs to authenticated;
grant all on public.automations, public.automation_runs to service_role;

-- Settings are validated in the database too, not only in the UI.
create or replace function public.automations_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_hours numeric;
begin
  new.key := old.key;
  new.trigger_event := old.trigger_event;
  new.webhook_path := old.webhook_path;
  if new.key = 'new_lead_follow_up' then
    v_hours := (new.settings ->> 'follow_up_hours')::numeric;
    if v_hours is null or v_hours < 1 or v_hours > 720 or v_hours <> trunc(v_hours) then
      raise exception 'follow_up_hours must be a whole number between 1 and 720' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger automations_validate before update on public.automations
  for each row execute function public.automations_validate();

-- ---------------------------------------------------------------------------
-- Run bookkeeping (called by the dispatcher with the secret key).
-- ---------------------------------------------------------------------------
create or replace function public.record_automation_run(
  p_event_id uuid,
  p_status text,
  p_error text default null,
  p_execution_id text default null,
  p_result jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_key text;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then return; end if;
  select key into v_key from public.automations where trigger_event = v_event.type order by sort_order limit 1;
  if v_key is null then return; end if;

  insert into public.automation_runs (automation_key, event_id, lead_id, status, attempts, error, external_execution_id, result, is_demo, finished_at)
  values (
    v_key, v_event.id,
    case when v_event.aggregate_type = 'lead' then v_event.aggregate_id
         else nullif(v_event.payload #>> '{data,lead_id}', '')::uuid end,
    p_status, greatest(v_event.attempts, 1), left(p_error, 1000), p_execution_id, coalesce(p_result, '{}'::jsonb), v_event.is_demo,
    case when p_status in ('succeeded', 'failed', 'skipped') then now() end
  )
  on conflict (automation_key, event_id) do update set
    -- a late failure report must never overwrite a confirmed success
    status = case when public.automation_runs.status = 'succeeded' and excluded.status <> 'succeeded'
                  then 'succeeded' else excluded.status end,
    attempts = greatest(public.automation_runs.attempts, excluded.attempts),
    error = case when excluded.status = 'succeeded' then null
                 when public.automation_runs.status = 'succeeded' then public.automation_runs.error
                 else excluded.error end,
    external_execution_id = coalesce(excluded.external_execution_id, public.automation_runs.external_execution_id),
    result = case when excluded.result = '{}'::jsonb then public.automation_runs.result else excluded.result end,
    finished_at = case when public.automation_runs.status = 'succeeded' then public.automation_runs.finished_at
                       else excluded.finished_at end,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim: events nobody subscribes to (or whose automation is disabled) are
-- marked "skipped" so they never block the queue; the rest are claimed with
-- FOR UPDATE SKIP LOCKED and returned with their webhook path.
-- ---------------------------------------------------------------------------
create or replace function public.claim_automation_events(p_limit integer default 25)
returns table (
  id uuid,
  type text,
  idempotency_key text,
  attempts integer,
  payload jsonb,
  automation_key text,
  webhook_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.events e
     set status = 'skipped', last_error = 'No enabled automation for this event type', locked_at = null
   where e.status in ('pending', 'failed')
     and not exists (select 1 from public.automations a where a.trigger_event = e.type and a.enabled);

  update public.events e
     set status = 'failed', locked_at = null, last_error = coalesce(e.last_error, 'lock expired')
   where e.status = 'processing' and e.locked_at < now() - interval '5 minutes';

  return query
  with picked as (
    select ev.id from public.events ev
     where ev.status in ('pending', 'failed') and ev.next_attempt_at <= now()
     order by ev.created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update public.events e
       set status = 'processing', locked_at = now(), attempts = e.attempts + 1
      from picked
     where e.id = picked.id
    returning e.*
  )
  select c.id, c.type, c.idempotency_key, c.attempts, c.payload, a.key, a.webhook_path
    from claimed c
    join lateral (
      select au.key, au.webhook_path from public.automations au
       where au.trigger_event = c.type and au.enabled
       order by au.sort_order limit 1
    ) a on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The action n8n asks for. Idempotent: the dedupe key is derived from the
-- event, so re-delivering the same event returns the task created the first
-- time instead of creating another one.
-- ---------------------------------------------------------------------------
create or replace function public.automation_create_follow_up_task(
  p_event_id uuid,
  p_idempotency_key text,
  p_execution_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_automation public.automations;
  v_lead public.leads;
  v_hours integer;
  v_dedupe text;
  v_task_id uuid;
  v_created boolean := false;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.idempotency_key is distinct from p_idempotency_key then
    raise exception 'unknown event' using errcode = 'P0002';
  end if;
  if v_event.type <> 'lead.created' then
    raise exception 'event type % is not handled by this automation', v_event.type using errcode = '22023';
  end if;

  select * into v_automation from public.automations where key = 'new_lead_follow_up';
  if not v_automation.enabled then
    perform public.record_automation_run(p_event_id, 'skipped', 'Automation is disabled', p_execution_id, null);
    return jsonb_build_object('outcome', 'skipped', 'reason', 'automation_disabled');
  end if;

  select * into v_lead from public.leads where id = v_event.aggregate_id;
  if not found then
    perform public.record_automation_run(p_event_id, 'skipped', 'Lead no longer exists', p_execution_id, null);
    return jsonb_build_object('outcome', 'skipped', 'reason', 'lead_deleted');
  end if;

  v_hours := coalesce((v_automation.settings ->> 'follow_up_hours')::integer, 24);
  v_dedupe := 'new_lead_follow_up:' || v_event.id;

  -- Serialize concurrent deliveries of the same event.
  perform pg_advisory_xact_lock(hashtextextended(v_dedupe, 0));

  select id into v_task_id from public.tasks where automation_dedupe_key = v_dedupe;
  if v_task_id is null then
    insert into public.tasks (
      lead_id, title, description, assigned_agent_id, priority, due_at,
      source, automation_key, automation_dedupe_key, is_demo
    ) values (
      v_lead.id,
      left('Follow up with ' || v_lead.full_name || ' (new ' ||
        case v_lead.source when 'website' then 'website' else replace(v_lead.source::text, '_', ' ') end || ' lead)', 160),
      'Created automatically by the New Lead Automation (n8n). Reach out and confirm what they are looking for.',
      v_lead.assigned_agent_id,
      case when v_lead.budget >= 1000000 then 'high'::public.task_priority else 'normal'::public.task_priority end,
      now() + make_interval(hours => v_hours),
      'automation', 'new_lead_follow_up', v_dedupe, v_lead.is_demo
    ) returning id into v_task_id;
    v_created := true;
  end if;

  perform public.record_automation_run(
    p_event_id, 'succeeded', null, p_execution_id,
    jsonb_build_object('task_id', v_task_id, 'task_created', v_created, 'follow_up_hours', v_hours)
  );

  return jsonb_build_object('outcome', case when v_created then 'created' else 'duplicate' end,
                            'task_id', v_task_id, 'lead_id', v_lead.id);
end;
$$;

-- Admin: put a failed / dead / skipped event back in the queue.
create or replace function public.retry_event(p_event_id uuid)
returns public.event_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  if not public.is_privileged_caller() then
    raise exception 'Only admins can retry events' using errcode = '42501';
  end if;

  update public.events
     set status = 'pending', next_attempt_at = now(), locked_at = null,
         -- dead events get a fresh retry budget
         attempts = case when status = 'dead' then 0 else attempts end
   where id = p_event_id and status in ('failed', 'dead', 'skipped')
  returning status into v_status;

  if v_status is null then
    raise exception 'Only failed, dead or skipped events can be retried' using errcode = '22023';
  end if;

  update public.automation_runs set status = 'queued', updated_at = now()
   where event_id = p_event_id and status <> 'succeeded';
  return v_status;
end;
$$;

-- Activity label for tasks created by automations.
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
  v_automation text;
begin
  select coalesce(nullif(p.full_name, ''), p.email) into v_label
  from public.profiles p where p.id = auth.uid();

  if v_label is null and p_details ? 'task_id' then
    select a.name into v_automation
      from public.tasks t join public.automations a on a.key = t.automation_key
     where t.id = (p_details ->> 'task_id')::uuid;
    if v_automation is not null then v_label := 'Automation: ' || v_automation; end if;
  end if;

  insert into public.activities (lead_id, actor_id, actor_label, type, details, is_demo)
  values (p_lead_id, auth.uid(), coalesce(v_label, 'System'), p_type, coalesce(p_details, '{}'::jsonb), p_is_demo);
end;
$$;

revoke execute on function public.record_automation_run(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_automation_events(integer) from public, anon, authenticated;
revoke execute on function public.automation_create_follow_up_task(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.retry_event(uuid) from public, anon;
revoke execute on function public.log_activity(uuid, public.activity_type, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_automation_run(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.claim_automation_events(integer) to service_role;
grant execute on function public.automation_create_follow_up_task(uuid, text, text) to service_role;
grant execute on function public.retry_event(uuid) to authenticated, service_role;

-- Demo reset must also clear demo automation runs.
create or replace function public.reset_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_leads integer;
  v_seeded integer;
begin
  if not public.is_privileged_caller() then
    raise exception 'Only admins can reset demo data' using errcode = '42501';
  end if;

  perform set_config('leadpilot.seeding', 'on', true);

  delete from public.automation_runs where is_demo;
  delete from public.events where is_demo;
  delete from public.tasks where is_demo;
  delete from public.activities where is_demo;
  delete from public.lead_notes where is_demo;
  with d as (delete from public.leads where is_demo returning 1)
  select count(*) into v_deleted_leads from d;

  v_seeded := public.seed_demo_data();

  return jsonb_build_object('deleted_leads', v_deleted_leads, 'seeded_leads', v_seeded);
end;
$$;

-- Website leads arrive unassigned, so their automated follow-up task is
-- unassigned too. When an admin assigns the lead, hand the open automated
-- tasks to the same agent.
create or replace function public.leads_reassign_automation_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_agent_id is not null and new.assigned_agent_id is distinct from old.assigned_agent_id then
    update public.tasks
       set assigned_agent_id = new.assigned_agent_id
     where lead_id = new.id and source = 'automation' and completed_at is null
       and (assigned_agent_id is null or assigned_agent_id = old.assigned_agent_id);
  end if;
  return new;
end;
$$;

create trigger leads_reassign_automation_tasks after update of assigned_agent_id on public.leads
  for each row execute function public.leads_reassign_automation_tasks();

revoke execute on function public.leads_reassign_automation_tasks() from public, anon, authenticated;
