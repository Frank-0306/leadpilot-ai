-- LeadPilot AI — full database setup (all migrations in order).
-- Generated from supabase/migrations. Paste into Supabase → SQL Editor and run once on a NEW project.
-- Existing project from Phase 1? Run only the migrations you haven't run yet.

-- ======================================================================
-- 20261120000100_core_schema.sql
-- ======================================================================
-- LeadPilot AI — Phase 1 core schema
-- Tables, enums, helper functions and Row Level Security.
-- Run order: this file, then 20261120000200_events_and_triggers.sql,
-- then 20261120000300_rpc_and_metrics.sql, then 20261120000400_demo_data.sql.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'agent');

create type public.lead_status as enum (
  'new_lead', 'contacted', 'qualified', 'viewing_scheduled', 'negotiation', 'won', 'lost'
);

create type public.lead_source as enum (
  'website', 'referral', 'zillow', 'realtor_com', 'open_house', 'social_media', 'walk_in', 'phone', 'other'
);

create type public.property_type as enum (
  'single_family', 'condo', 'townhouse', 'multi_family', 'land', 'luxury', 'rental'
);

create type public.task_priority as enum ('low', 'normal', 'high');

create type public.activity_type as enum (
  'lead_created', 'lead_updated', 'status_changed', 'assigned', 'unassigned',
  'note_added', 'task_created', 'task_completed', 'task_reopened',
  'follow_up_scheduled', 'repeat_inquiry'
);

create type public.event_status as enum ('pending', 'processing', 'delivered', 'failed', 'dead', 'skipped');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True while seed/reset code runs, so triggers don't create duplicate history
-- or outbound events for synthetic demo rows.
create or replace function public.is_seeding()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('leadpilot.seeding', true), '') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user) and agents (sales team)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- An agent is a member of the sales team. Demo agents exist without a login;
-- an admin can link a real user to an agent row from Settings → Team.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  phone text,
  title text not null default 'Sales Agent',
  color text not null default '#3B6EF5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

-- Role helpers. SECURITY DEFINER so policies can call them without recursing
-- through RLS on profiles/agents.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.agents a
  where a.user_id = auth.uid() and a.is_active
  limit 1;
$$;

-- Admins, the server's secret key (service_role) and direct SQL sessions
-- without a user JWT (Supabase SQL editor, migrations, cron) may run
-- maintenance functions. Signed-in agents and anonymous visitors may not.
create or replace function public.is_privileged_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'));
$$;

-- Create a profile whenever someone signs up. New users are agents by default;
-- promote the first admin with the SQL in README → "Create your admin".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  email_normalized text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_digits text generated always as (
    nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
  ) stored,
  source public.lead_source not null default 'other',
  property_type public.property_type,
  property_interest text check (property_interest is null or char_length(property_interest) <= 300),
  preferred_area text check (preferred_area is null or char_length(preferred_area) <= 120),
  budget numeric(12, 0) check (budget is null or budget >= 0),
  status public.lead_status not null default 'new_lead',
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 300),
  assigned_agent_id uuid references public.agents (id) on delete set null,
  next_follow_up_at timestamptz,
  position double precision not null default (-extract(epoch from clock_timestamp())),
  revision integer not null default 0,
  status_changed_at timestamptz not null default now(),
  won_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_contact_required check (email is not null or phone is not null)
);

create index leads_status_position_idx on public.leads (status, position);
create index leads_assigned_idx on public.leads (assigned_agent_id);
create index leads_created_idx on public.leads (created_at desc);
create index leads_email_norm_idx on public.leads (email_normalized);
create index leads_phone_digits_idx on public.leads (phone_digits);
create index leads_follow_up_idx on public.leads (next_follow_up_at) where next_follow_up_at is not null;

-- Keep status timestamps and the revision counter consistent no matter which
-- client changes the row.
create or replace function public.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_seeding() then
      new.status_changed_at := now();
      new.won_at := case when new.status = 'won' then now() end;
      new.closed_at := case when new.status in ('won', 'lost') then now() end;
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
    return new;
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.is_demo := old.is_demo;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.won_at := case when new.status = 'won' then now() end;
    new.closed_at := case when new.status in ('won', 'lost') then now() end;
    if new.status <> 'lost' then
      new.lost_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_before_write before insert or update on public.leads
  for each row execute function public.leads_before_write();

-- ---------------------------------------------------------------------------
-- Notes, activity history and tasks
-- ---------------------------------------------------------------------------
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_label text,
  body text not null check (char_length(body) between 1 and 4000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  type public.activity_type not null,
  details jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index activities_lead_idx on public.activities (lead_id, created_at desc);
create index activities_created_idx on public.activities (created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  description text check (description is null or char_length(description) <= 2000),
  assigned_agent_id uuid references public.agents (id) on delete set null,
  priority public.task_priority not null default 'normal',
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_assigned_due_idx on public.tasks (assigned_agent_id, due_at) where completed_at is null;
create index tasks_lead_idx on public.tasks (lead_id);

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_seeding() then
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
    return new;
  end if;
  new.updated_at := now();
  new.created_at := old.created_at;
  new.is_demo := old.is_demo;
  if new.completed_at is not null and old.completed_at is null then
    new.completed_by := coalesce(new.completed_by, auth.uid());
  elsif new.completed_at is null then
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- ---------------------------------------------------------------------------
-- Public form abuse log (no direct access from clients)
-- ---------------------------------------------------------------------------
create table public.lead_submissions (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  email_hash text not null,
  outcome text not null check (outcome in ('created', 'duplicate', 'rate_limited')),
  lead_id uuid references public.leads (id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_submissions_ip_idx on public.lead_submissions (ip_hash, created_at desc);
create index lead_submissions_email_idx on public.lead_submissions (email_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.lead_submissions enable row level security;

-- Profiles: everyone signed in sees their own; admins see and manage all.
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: admin updates" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Agents: the team roster is visible to every signed-in user (needed to show
-- names and owners); only admins change it.
create policy "agents: read for team" on public.agents
  for select to authenticated using (true);

create policy "agents: admin insert" on public.agents
  for insert to authenticated with check (public.is_admin());

create policy "agents: admin update" on public.agents
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "agents: admin delete" on public.agents
  for delete to authenticated using (public.is_admin());

-- Leads: admins see everything; agents only their assigned leads and can
-- never hand a lead to someone else or delete it.
create policy "leads: read" on public.leads
  for select to authenticated
  using (public.is_admin() or assigned_agent_id = public.current_agent_id());

create policy "leads: insert" on public.leads
  for insert to authenticated
  with check (public.is_admin() or assigned_agent_id = public.current_agent_id());

create policy "leads: update" on public.leads
  for update to authenticated
  using (public.is_admin() or assigned_agent_id = public.current_agent_id())
  with check (public.is_admin() or assigned_agent_id = public.current_agent_id());

create policy "leads: admin delete" on public.leads
  for delete to authenticated
  using (public.is_admin());

-- Notes follow lead visibility. Authors are pinned to the signed-in user.
create policy "notes: read" on public.lead_notes
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

create policy "notes: insert" on public.lead_notes
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_id)
  );

create policy "notes: delete own or admin" on public.lead_notes
  for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());

-- Activity history is written only by triggers (SECURITY DEFINER).
create policy "activities: read" on public.activities
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

-- Tasks: admins manage all; agents manage tasks assigned to them.
create policy "tasks: read" on public.tasks
  for select to authenticated
  using (public.is_admin() or assigned_agent_id = public.current_agent_id());

create policy "tasks: insert" on public.tasks
  for insert to authenticated
  with check (
    (public.is_admin() or assigned_agent_id = public.current_agent_id())
    and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id))
  );

create policy "tasks: update" on public.tasks
  for update to authenticated
  using (public.is_admin() or assigned_agent_id = public.current_agent_id())
  with check (public.is_admin() or assigned_agent_id = public.current_agent_id());

create policy "tasks: delete" on public.tasks
  for delete to authenticated
  using (public.is_admin() or (assigned_agent_id = public.current_agent_id() and created_by = auth.uid()));

-- lead_submissions: no policies → only the service role can touch it.

-- Anonymous visitors never read CRM tables directly; the public form goes
-- through a server action that uses the secret key.
revoke all on public.profiles, public.agents, public.leads, public.lead_notes,
  public.activities, public.tasks, public.lead_submissions from anon;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.current_agent_id() from public, anon;
revoke execute on function public.is_privileged_caller() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_agent_id() to authenticated;

-- ======================================================================
-- 20261120000200_events_and_triggers.sql
-- ======================================================================
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

-- ======================================================================
-- 20261120000300_rpc_and_metrics.sql
-- ======================================================================
-- LeadPilot AI — public lead intake, duplicate detection and dashboard metrics

-- ---------------------------------------------------------------------------
-- Public form intake. Only the server (secret key) may call this: the Next.js
-- server action validates input with Zod, checks the honeypot and timing
-- token, hashes the visitor IP and then calls this function, which applies
-- persistent rate limits and de-duplicates repeat inquiries atomically.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_full_name text,
  p_email text,
  p_phone text,
  p_property_type public.property_type,
  p_property_interest text,
  p_preferred_area text,
  p_budget numeric,
  p_message text,
  p_ip_hash text,
  p_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
  v_recent_ip integer;
  v_recent_email integer;
  v_existing uuid;
  v_lead_id uuid;
begin
  if v_email is null or p_ip_hash is null or p_email_hash is null then
    raise exception 'missing required fields' using errcode = '22023';
  end if;

  -- Serialize concurrent submissions for the same email so a double click
  -- can never create two leads.
  perform pg_advisory_xact_lock(hashtextextended('public_lead:' || v_email, 0));

  select count(*) into v_recent_ip from public.lead_submissions
   where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
  select count(*) into v_recent_email from public.lead_submissions
   where email_hash = p_email_hash and created_at > now() - interval '1 hour';

  if v_recent_ip >= 5 or v_recent_email >= 3 then
    insert into public.lead_submissions (ip_hash, email_hash, outcome)
    values (p_ip_hash, p_email_hash, 'rate_limited');
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  -- Repeat inquiry from a lead that is still open → append to that lead.
  select id into v_existing from public.leads
   where email_normalized = v_email and status not in ('won', 'lost')
   order by created_at desc limit 1;

  if v_existing is not null then
    insert into public.activities (lead_id, actor_label, type, details)
    values (v_existing, 'Website form', 'repeat_inquiry', jsonb_build_object(
      'property_interest', left(p_property_interest, 300),
      'message', left(p_message, 2000)
    ));
    if nullif(btrim(coalesce(p_message, '')), '') is not null then
      insert into public.lead_notes (lead_id, author_label, body)
      values (v_existing, 'Website form', left(p_message, 4000));
    end if;
    insert into public.lead_submissions (ip_hash, email_hash, outcome, lead_id)
    values (p_ip_hash, p_email_hash, 'duplicate', v_existing);
    return jsonb_build_object('outcome', 'duplicate', 'lead_id', v_existing);
  end if;

  insert into public.leads (
    full_name, email, phone, source, property_type, property_interest,
    preferred_area, budget, status
  ) values (
    btrim(p_full_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), 'website', p_property_type,
    nullif(btrim(coalesce(p_property_interest, '')), ''), nullif(btrim(coalesce(p_preferred_area, '')), ''),
    p_budget, 'new_lead'
  ) returning id into v_lead_id;

  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    insert into public.lead_notes (lead_id, author_label, body)
    values (v_lead_id, 'Website form', left(p_message, 4000));
  end if;

  insert into public.lead_submissions (ip_hash, email_hash, outcome, lead_id)
  values (p_ip_hash, p_email_hash, 'created', v_lead_id);

  return jsonb_build_object('outcome', 'created', 'lead_id', v_lead_id);
end;
$$;

revoke execute on function public.submit_public_lead(text, text, text, public.property_type, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_public_lead(text, text, text, public.property_type, text, text, numeric, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Duplicate detection for CRM users. SECURITY DEFINER so an agent learns that
-- a matching contact exists even if it belongs to a teammate, but only sees
-- the name and owner — never the full record — unless RLS lets them open it.
-- ---------------------------------------------------------------------------
create or replace function public.find_duplicate_leads(
  p_email text,
  p_phone text,
  p_exclude uuid default null
)
returns table (
  id uuid,
  full_name text,
  status public.lead_status,
  owner_name text,
  match_on text,
  can_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
           nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '') as phone
  )
  select l.id, l.full_name, l.status, a.full_name,
         case when l.email_normalized = i.email and l.phone_digits = i.phone then 'email+phone'
              when l.email_normalized = i.email then 'email'
              else 'phone' end,
         public.is_admin() or l.assigned_agent_id = public.current_agent_id()
    from public.leads l
    cross join input i
    left join public.agents a on a.id = l.assigned_agent_id
   where auth.uid() is not null
     and (p_exclude is null or l.id <> p_exclude)
     and ((i.email is not null and l.email_normalized = i.email)
       or (i.phone is not null and char_length(i.phone) >= 7 and l.phone_digits = i.phone))
   order by l.created_at desc
   limit 5;
$$;

revoke execute on function public.find_duplicate_leads(text, text, uuid) from public, anon;
grant execute on function public.find_duplicate_leads(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard metrics. SECURITY INVOKER: RLS decides which leads and tasks are
-- counted, so an agent automatically sees only their own numbers.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_agent uuid default null,
  p_time_zone text default 'UTC'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_span interval := p_to - p_from;
  v_result jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if p_to <= p_from or v_span > interval '400 days' then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  with scoped as (
    select * from public.leads where p_agent is null or assigned_agent_id = p_agent
  ),
  scoped_tasks as (
    select * from public.tasks where p_agent is null or assigned_agent_id = p_agent
  ),
  closed as (
    select * from scoped where closed_at >= p_from and closed_at < p_to
  ),
  days as (
    -- Calendar days in the brokerage's time zone.
    select d::date as day
      from generate_series((p_from at time zone p_time_zone)::date,
                           ((p_to - interval '1 second') at time zone p_time_zone)::date,
                           interval '1 day') d
  )
  select jsonb_build_object(
    'total_leads', (select count(*) from scoped),
    'new_leads', (select count(*) from scoped where created_at >= p_from and created_at < p_to),
    'new_leads_previous', (select count(*) from scoped where created_at >= p_from - v_span and created_at < p_from),
    'awaiting_first_contact', (select count(*) from scoped where status = 'new_lead'),
    'active_opportunities', (select count(*) from scoped where status in ('qualified', 'viewing_scheduled', 'negotiation')),
    'active_pipeline_value', (select coalesce(sum(budget), 0) from scoped where status in ('qualified', 'viewing_scheduled', 'negotiation')),
    'won', (select count(*) from closed where status = 'won'),
    'won_value', (select coalesce(sum(budget), 0) from closed where status = 'won'),
    'lost', (select count(*) from closed where status = 'lost'),
    'won_previous', (select count(*) from scoped where status = 'won' and won_at >= p_from - v_span and won_at < p_from),
    'pending_tasks', (select count(*) from scoped_tasks where completed_at is null),
    'overdue_tasks', (select count(*) from scoped_tasks where completed_at is null and due_at < now()),
    'follow_ups_due', (select count(*) from scoped where next_follow_up_at <= now() and status not in ('won', 'lost')),
    'pipeline', (
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', coalesce(c.n, 0), 'value', coalesce(c.v, 0)) order by s.ord)
      from unnest(enum_range(null::public.lead_status)) with ordinality as s(status, ord)
      left join (select status, count(*) n, sum(budget) v from scoped group by status) c on c.status = s.status
    ),
    'series', (
      select jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'created', (select count(*) from scoped l where (l.created_at at time zone p_time_zone)::date = d.day),
        'won', (select count(*) from scoped l where (l.won_at at time zone p_time_zone)::date = d.day)
      ) order by d.day)
      from days d
    ),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc), '[]'::jsonb)
      from (select source, count(*) n from scoped where created_at >= p_from and created_at < p_to group by source) x
    ),
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'full_name', a.full_name, 'color', a.color,
        'open', (select count(*) from scoped l where l.assigned_agent_id = a.id and l.status not in ('won', 'lost')),
        'won', (select count(*) from closed l where l.assigned_agent_id = a.id and l.status = 'won'),
        'closed', (select count(*) from closed l where l.assigned_agent_id = a.id)
      ) order by a.full_name), '[]'::jsonb)
      from public.agents a
      where a.is_active
        and (p_agent is null or a.id = p_agent)
        and exists (select 1 from scoped l where l.assigned_agent_id = a.id)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid, text) to authenticated;

-- ======================================================================
-- 20261120000400_demo_data.sql
-- ======================================================================
-- LeadPilot AI — demo data for the fictional brokerage Northstar Realty.
--
-- Every row created here has is_demo = true. All people, emails and phone
-- numbers are invented (example.com addresses and 555-01xx numbers, which
-- are reserved for fiction). reset_demo_data() deletes ONLY demo rows and
-- recreates them; real users, profiles and non-demo leads are never touched.

create or replace function public.seed_demo_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agents uuid[] := array[
    '0a6e5f10-0000-4000-8000-000000000001',
    '0a6e5f10-0000-4000-8000-000000000002',
    '0a6e5f10-0000-4000-8000-000000000003',
    '0a6e5f10-0000-4000-8000-000000000004',
    '0a6e5f10-0000-4000-8000-000000000005'
  ]::uuid[];
  v_path public.lead_status[];
  v_lead_id uuid;
  v_created timestamptz;
  v_step_at timestamptz;
  v_i integer := 0;
  v_j integer;
  v_count integer := 0;
  r record;
begin
  perform set_config('leadpilot.seeding', 'on', true);

  -- Demo agents use fixed ids so a real login linked to one survives resets.
  insert into public.agents (id, full_name, email, phone, title, color, is_demo) values
    (v_agents[1], 'Maya Thompson',  'maya.thompson@example.com',  '(555) 010-1101', 'Senior Agent',        '#3B6EF5', true),
    (v_agents[2], 'Daniel Brooks',  'daniel.brooks@example.com',  '(555) 010-1102', 'Buyer''s Agent',      '#0E9F9A', true),
    (v_agents[3], 'Priya Raman',    'priya.raman@example.com',    '(555) 010-1103', 'Listing Specialist',  '#C2770E', true),
    (v_agents[4], 'Marcus Reed',    'marcus.reed@example.com',    '(555) 010-1104', 'Sales Agent',         '#7C4DDB', true),
    (v_agents[5], 'Elena Vasquez',  'elena.vasquez@example.com',  '(555) 010-1105', 'Luxury Specialist',   '#D3457A', true)
  on conflict (id) do update set
    full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
    title = excluded.title, color = excluded.color, is_demo = true, is_active = true;

  for r in
    select * from (values
      -- first, last, source, type, interest, area, budget, status, agent, days_ago, follow_up_in_days
      ('Olivia',   'Bennett',   'website',      'single_family', '3 bed, fenced yard, near good schools',        'Maple Heights', 485000,  'new_lead',          0, 1,  1),
      ('James',    'Carter',    'zillow',       'condo',         'Downtown condo with parking and gym',          'Downtown',      320000,  'new_lead',          1, 2,  0),
      ('Sophia',   'Nguyen',    'website',      'townhouse',     'End-unit townhouse, 2+ car garage',            'Westbrook',     410000,  'new_lead',          0, 0,  null),
      ('Ethan',    'Morales',   'social_media', 'single_family', 'First home, open to light updates',            'Riverside',     365000,  'new_lead',          2, 3,  -1),
      ('Ava',      'Patel',     'referral',     'luxury',        'Waterfront home with dock access',             'Harbor Point',  1850000, 'new_lead',          5, 1,  1),
      ('Noah',     'Kim',       'realtor_com',  'rental',        '2BR rental for 12-month lease, pet friendly',  'Old Town',      2400,    'new_lead',          4, 4,  -2),
      ('Isabella', 'Russo',     'website',      'condo',         'Low-HOA condo close to the light rail',        'Lakeview',      295000,  'new_lead',          0, 2,  null),
      ('Liam',     'Foster',    'open_house',   'single_family', 'Saw 14 Elm Ct open house, wants similar',      'Pine Ridge',    540000,  'new_lead',          3, 5,  0),
      ('Mia',      'Hughes',    'zillow',       'townhouse',     'Townhouse with home office space',             'Westbrook',     435000,  'contacted',         1, 8,  2),
      ('Lucas',    'Ortiz',     'phone',        'multi_family',  'Duplex to live in one side and rent the other','Riverside',     610000,  'contacted',         4, 10, -1),
      ('Charlotte','Price',     'website',      'single_family', 'Single-story home for downsizing',             'Maple Heights', 455000,  'contacted',         2, 6,  1),
      ('Benjamin', 'Ward',      'referral',     'land',          'Half-acre lot to build a custom home',         'Pine Ridge',    180000,  'contacted',         3, 12, 3),
      ('Amelia',   'Coleman',   'social_media', 'condo',         'Top-floor condo with city views',              'Downtown',      375000,  'contacted',         1, 9,  0),
      ('Henry',    'Jenkins',   'walk_in',      'single_family', 'Relocating for work, needs to move by spring', 'Lakeview',      520000,  'contacted',         5, 7,  -3),
      ('Harper',   'Simmons',   'realtor_com',  'townhouse',     'Townhouse near the medical center',            'Old Town',      389000,  'contacted',         2, 11, 2),
      ('Alexander','Gray',      'website',      'luxury',        'Modern home with pool and guest suite',        'Harbor Point',  2250000, 'qualified',         5, 18, 1),
      ('Evelyn',   'Murphy',    'zillow',       'single_family', '4 bed, finished basement',                     'Maple Heights', 615000,  'qualified',         1, 21, -2),
      ('Daniel',   'Flores',    'referral',     'condo',         'Investment condo near the university',         'Downtown',      260000,  'qualified',         4, 16, 2),
      ('Abigail',  'Sanders',   'open_house',   'single_family', 'Craftsman-style home with porch',              'Old Town',      495000,  'qualified',         3, 25, 0),
      ('Michael',  'Perry',     'website',      'townhouse',     'Townhouse, walkable to shops and cafes',       'Westbrook',     445000,  'qualified',         2, 19, 4),
      ('Emily',    'Long',      'social_media', 'single_family', 'Starter home with garage',                     'Riverside',     340000,  'qualified',         1, 23, -1),
      ('Matthew',  'Powell',    'zillow',       'single_family', 'Corner lot, 3 bed / 2 bath',                   'Lakeview',      505000,  'viewing_scheduled', 3, 30, 1),
      ('Ella',     'Butler',    'website',      'condo',         'Condo with in-unit laundry',                   'Lakeview',      310000,  'viewing_scheduled', 4, 27, 2),
      ('Samuel',   'Barnes',    'referral',     'luxury',        'Gated estate, minimum 5 bedrooms',             'Harbor Point',  3100000, 'viewing_scheduled', 5, 35, 3),
      ('Grace',    'Ross',      'realtor_com',  'townhouse',     'Newer-construction townhouse',                 'Pine Ridge',    470000,  'viewing_scheduled', 2, 29, 0),
      ('David',    'Henderson', 'phone',        'multi_family',  'Fourplex with existing tenants',               'Riverside',     890000,  'viewing_scheduled', 1, 33, -1),
      ('Chloe',    'Fisher',    'website',      'single_family', 'Family home near the new elementary school',   'Maple Heights', 575000,  'negotiation',       1, 42, 1),
      ('Joseph',   'Graham',    'zillow',       'condo',         'Penthouse condo, two parking spaces',          'Downtown',      720000,  'negotiation',       5, 47, 0),
      ('Victoria', 'Wallace',   'open_house',   'single_family', 'Ranch home with large backyard',               'Pine Ridge',    530000,  'negotiation',       3, 39, 2),
      ('Andrew',   'Cole',      'referral',     'townhouse',     'Townhouse close to the commuter train',        'Westbrook',     425000,  'negotiation',       2, 44, -1),
      ('Scarlett', 'West',      'website',      'single_family', 'Updated kitchen, 3 bed',                       'Lakeview',      498000,  'won',               1, 64, null),
      ('Jack',     'Hayes',     'referral',     'luxury',        'Lake house with private beach',                'Harbor Point',  1675000, 'won',               5, 80, null),
      ('Lily',     'Myers',     'zillow',       'condo',         'Condo near the riverfront trail',              'Riverside',     289000,  'won',               4, 52, null),
      ('Owen',     'Ford',      'open_house',   'townhouse',     'Townhouse with rooftop deck',                  'Old Town',      465000,  'won',               3, 71, null),
      ('Zoe',      'Hamilton',  'social_media', 'single_family', 'Wanted 4 bed under $450k',                     'Maple Heights', 450000,  'lost',              2, 58, null),
      ('Wyatt',    'Graham',    'phone',        'land',          'Rural acreage for a small farm',               'Pine Ridge',    240000,  'lost',              4, 66, null)
    ) as t(first, last, source, ptype, interest, area, budget, status, agent, days_ago, follow_up)
  loop
    v_i := v_i + 1;
    v_created := date_trunc('hour', now()) - make_interval(days => r.days_ago, hours => (v_i * 7) % 11);

    v_path := case r.status
      when 'new_lead' then array['new_lead']
      when 'contacted' then array['new_lead', 'contacted']
      when 'qualified' then array['new_lead', 'contacted', 'qualified']
      when 'viewing_scheduled' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled']
      when 'negotiation' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled', 'negotiation']
      when 'won' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled', 'negotiation', 'won']
      else array['new_lead', 'contacted', 'qualified', 'lost']
    end::public.lead_status[];

    -- Each pipeline step happens a few days after the previous one.
    v_step_at := v_created + make_interval(days => greatest(array_length(v_path, 1) - 1, 0) * greatest(r.days_ago / 6, 1));
    if v_step_at > now() then v_step_at := now() - interval '2 hours'; end if;

    insert into public.leads (
      full_name, email, phone, source, property_type, property_interest, preferred_area,
      budget, status, lost_reason, assigned_agent_id, next_follow_up_at, position,
      status_changed_at, won_at, closed_at, is_demo, created_at, updated_at
    ) values (
      r.first || ' ' || r.last,
      lower(r.first || '.' || r.last) || '@example.com',
      '(555) 01' || lpad(((v_i % 10))::text, 1, '0') || '-' || lpad((2000 + v_i)::text, 4, '0'),
      r.source::public.lead_source,
      r.ptype::public.property_type,
      r.interest,
      r.area,
      r.budget,
      r.status::public.lead_status,
      case when r.status = 'lost' then
        case when v_i % 2 = 0 then 'Bought with another brokerage' else 'Paused search — financing fell through' end
      end,
      case when r.agent = 0 then null else v_agents[r.agent] end,
      case when r.follow_up is null then null
           else date_trunc('hour', now()) + make_interval(days => r.follow_up, hours => 10) end,
      v_i,
      v_step_at,
      case when r.status = 'won' then v_step_at end,
      case when r.status in ('won', 'lost') then v_step_at end,
      true,
      v_created,
      v_step_at
    ) returning id into v_lead_id;

    -- History: created → assigned → each status step.
    insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
    values (v_lead_id, case when r.source = 'website' then 'Website form' else 'Demo data' end,
            'lead_created', jsonb_build_object('source', r.source, 'status', 'new_lead'), true, v_created);

    if r.agent <> 0 then
      insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'assigned', jsonb_build_object('to_agent_id', v_agents[r.agent]), true,
              v_created + interval '25 minutes');
    end if;

    for v_j in 2 .. coalesce(array_length(v_path, 1), 1) loop
      insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'status_changed',
              jsonb_build_object('from', v_path[v_j - 1], 'to', v_path[v_j]), true,
              v_created + (v_step_at - v_created) * ((v_j - 1)::numeric / greatest(array_length(v_path, 1) - 1, 1)));
    end loop;

    -- One or two internal notes per lead.
    insert into public.lead_notes (lead_id, author_label, body, is_demo, created_at)
    values (v_lead_id, 'Demo data',
      case r.status
        when 'new_lead' then 'Inquiry received. Prefers text messages before 6 pm.'
        when 'contacted' then 'Intro call done. Wants to see 3–4 options before committing to tours.'
        when 'qualified' then 'Pre-approval letter received. Flexible on closing date.'
        when 'viewing_scheduled' then 'Tour route planned; bring comps for the neighborhood.'
        when 'negotiation' then 'Seller countered. Client willing to move on price if inspection is clean.'
        when 'won' then 'Closed. Send a thank-you gift and ask for a review in 30 days.'
        else 'Closed lost. Keep in the quarterly market-update list.'
      end, true, v_created + interval '1 hour');

    if v_i % 3 = 0 then
      insert into public.lead_notes (lead_id, author_label, body, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'Spouse joins all tours; schedule on weekends when possible.', true,
              v_created + interval '2 days');
    end if;

    -- Follow-up tasks: open leads get an upcoming or overdue task; closed
    -- leads keep their completed history.
    if r.status not in ('won', 'lost') then
      insert into public.tasks (lead_id, title, assigned_agent_id, priority, due_at, is_demo, created_at)
      values (v_lead_id,
        case r.status
          when 'new_lead' then 'Call ' || r.first || ' to introduce Northstar'
          when 'contacted' then 'Send ' || r.first || ' matching listings'
          when 'qualified' then 'Confirm financing details with ' || r.first
          when 'viewing_scheduled' then 'Prepare tour packet for ' || r.first
          else 'Review counteroffer with ' || r.first
        end,
        case when r.agent = 0 then null else v_agents[r.agent] end,
        (case when r.status in ('negotiation', 'viewing_scheduled') then 'high' when v_i % 4 = 0 then 'low' else 'normal' end)::public.task_priority,
        date_trunc('hour', now()) + make_interval(days => (v_i % 7) - 2, hours => 9 + (v_i % 6)),
        true, v_created + interval '30 minutes');
    end if;

    if r.status <> 'new_lead' then
      insert into public.tasks (lead_id, title, assigned_agent_id, priority, due_at, completed_at, is_demo, created_at)
      values (v_lead_id, 'Discovery call with ' || r.first,
        case when r.agent = 0 then null else v_agents[r.agent] end, 'normal',
        v_created + interval '1 day', v_created + interval '20 hours', true, v_created + interval '1 hour');
    end if;

    v_count := v_count + 1;
  end loop;

  -- A few team tasks not tied to a lead.
  insert into public.tasks (title, description, assigned_agent_id, priority, due_at, completed_at, is_demo) values
    ('Update Harbor Point market report', 'Refresh comps for the monthly luxury newsletter.', v_agents[5], 'normal', now() + interval '3 days', null, true),
    ('Plan Saturday open house at 22 Birch Ln', 'Signage, sign-in sheet and refreshments.', v_agents[3], 'high', now() + interval '1 day', null, true),
    ('Renew MLS photo package', null, v_agents[1], 'low', now() - interval '2 days', null, true),
    ('Team pipeline review', 'Weekly 30-minute review of stalled deals.', v_agents[2], 'normal', now() - interval '5 days', now() - interval '5 days', true);

  perform set_config('leadpilot.seeding', 'off', true);
  return v_count;
end;
$$;

-- Admin-only: wipe and recreate demo rows. Real data is never touched because
-- every delete is filtered on is_demo = true, and auth users/profiles are not
-- part of the demo set at all.
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
  if not (public.is_privileged_caller()) then
    raise exception 'Only admins can reset demo data' using errcode = '42501';
  end if;

  perform set_config('leadpilot.seeding', 'on', true);

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

revoke execute on function public.seed_demo_data() from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon;
grant execute on function public.reset_demo_data() to authenticated, service_role;

-- Load the demo set once when the migration runs.
select public.seed_demo_data();

-- ======================================================================
-- 20261120000500_api_grants.sql
-- ======================================================================
-- Explicit table privileges for the Supabase Data API.
-- Some Supabase projects no longer grant new public tables to API roles
-- automatically, so we grant exactly what the app needs. Row Level Security
-- still decides WHICH rows each user can touch.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.agents, public.leads, public.lead_notes, public.tasks
to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.activities, public.events, public.event_deliveries to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Anonymous visitors get nothing: the public form goes through the server.
revoke all on all tables in schema public from anon;

-- ======================================================================
-- 20261121000100_automations.sql
-- ======================================================================
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

-- ======================================================================
-- 20261121000200_automation_polish.sql
-- ======================================================================
-- LeadPilot AI — Phase 2, stage A polish
-- Events that no enabled automation handles are recorded as "skipped" right
-- away instead of sitting in "pending" until the next dispatch run.

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
  v_subscribed boolean;
begin
  select exists (select 1 from public.automations a where a.trigger_event = p_type and a.enabled)
    into v_subscribed;

  insert into public.events (type, aggregate_type, aggregate_id, idempotency_key, payload, is_demo, status, last_error)
  values (
    p_type, p_aggregate_type, p_aggregate_id, p_idempotency_key,
    jsonb_build_object(
      'event', p_type,
      'occurred_at', now(),
      'idempotency_key', p_idempotency_key,
      'data', p_payload
    ),
    p_is_demo,
    case when v_subscribed then 'pending'::public.event_status else 'skipped'::public.event_status end,
    case when v_subscribed then null else 'No enabled automation for this event type' end
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.emit_event(text, text, uuid, text, jsonb, boolean) from public, anon, authenticated;

-- Tidy up events already waiting with no subscriber.
update public.events e
   set status = 'skipped', last_error = 'No enabled automation for this event type'
 where e.status = 'pending'
   and not exists (select 1 from public.automations a where a.trigger_event = e.type and a.enabled);

-- ======================================================================
-- 20261121000300_ai_analysis.sql
-- ======================================================================
-- LeadPilot AI — Phase 2, stage B: AI lead analysis (via n8n + Google Gemini)
--
-- Flow (all server-side):
--   1. An agent clicks "Generate analysis" → request_ai_analysis() checks
--      access + usage limits and creates a request row (status "requested").
--   2. LeadPilot calls the n8n workflow with ONLY {request_id, lead_id}.
--   3. n8n fetches the minimum commercial context with ai_analysis_context()
--      (only for a fresh, still-open request) and calls Gemini.
--   4. n8n posts the model output back; LeadPilot validates it (Zod) and
--      stores it with complete_ai_analysis(). First result wins.
--   5. The follow-up email is a DRAFT. Nothing is sent; an agent must review
--      and approve it (approve_ai_draft) and send it themselves.

alter type public.activity_type add value if not exists 'ai_analysis_generated';
alter type public.activity_type add value if not exists 'ai_draft_approved';

insert into public.automations (key, name, description, trigger_event, webhook_path, enabled, settings, sort_order) values
  ('ai_lead_analysis',
   'AI Lead Analysis',
   'On request, n8n sends the lead''s commercial details to Google Gemini and returns an interest level, summary, next action and a follow-up email draft for an agent to review.',
   'manual.ai_analysis', 'leadpilot-ai-analysis', false, '{}'::jsonb, 2)
on conflict (key) do nothing;

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  run_id uuid references public.automation_runs (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'succeeded', 'failed', 'invalid_output')),
  interest_level text check (interest_level in ('High', 'Medium', 'Low')),
  summary text check (summary is null or char_length(summary) <= 800),
  reasons jsonb check (reasons is null or (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) between 1 and 5)),
  next_action text check (next_action is null or char_length(next_action) <= 400),
  email_subject text check (email_subject is null or char_length(email_subject) <= 150),
  email_body text check (email_body is null or char_length(email_body) <= 3000),
  model text check (model is null or char_length(model) <= 100),
  external_execution_id text check (external_execution_id is null or char_length(external_execution_id) <= 100),
  error text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  approved_subject text check (approved_subject is null or char_length(approved_subject) <= 150),
  approved_body text check (approved_body is null or char_length(approved_body) <= 3000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_analyses_success_complete check (
    status <> 'succeeded'
    or (interest_level is not null and summary is not null and reasons is not null
        and next_action is not null and email_subject is not null and email_body is not null)
  )
);

create index ai_analyses_lead_idx on public.ai_analyses (lead_id, created_at desc);
create index ai_analyses_user_idx on public.ai_analyses (requested_by, created_at desc);
create index ai_analyses_created_idx on public.ai_analyses (created_at desc);

alter table public.ai_analyses enable row level security;

create policy "ai_analyses: read with lead" on public.ai_analyses
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

revoke all on public.ai_analyses from anon;
grant select on public.ai_analyses to authenticated;
grant all on public.ai_analyses to service_role;

-- ---------------------------------------------------------------------------
-- Usage limits (free-tier friendly). Change here if needed.
--   per user:  20 analyses / hour
--   per lead:  one in flight at a time, and at most 1 every 30 seconds
--   whole app: 200 analyses / 24 h
-- ---------------------------------------------------------------------------
create or replace function public.request_ai_analysis(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads;
  v_enabled boolean;
  v_request uuid;
  v_run uuid;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found or not (public.is_admin() or v_lead.assigned_agent_id = public.current_agent_id()) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  select enabled into v_enabled from public.automations where key = 'ai_lead_analysis';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('outcome', 'not_configured');
  end if;

  -- Requests that never came back are closed after 3 minutes.
  update public.ai_analyses
     set status = 'failed', error = 'Timed out waiting for the AI workflow', completed_at = now()
   where status = 'requested' and created_at < now() - interval '3 minutes';

  perform pg_advisory_xact_lock(hashtextextended('ai_analysis:' || p_lead_id, 0));

  if exists (select 1 from public.ai_analyses where lead_id = p_lead_id and status = 'requested') then
    return jsonb_build_object('outcome', 'in_progress');
  end if;
  if exists (select 1 from public.ai_analyses where lead_id = p_lead_id and created_at > now() - interval '30 seconds') then
    return jsonb_build_object('outcome', 'too_soon');
  end if;
  if (select count(*) from public.ai_analyses where requested_by = v_uid and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('outcome', 'rate_limited');
  end if;
  if (select count(*) from public.ai_analyses where created_at > now() - interval '24 hours') >= 200 then
    return jsonb_build_object('outcome', 'daily_limit');
  end if;

  insert into public.automation_runs (automation_key, lead_id, status, attempts, is_demo)
  values ('ai_lead_analysis', p_lead_id, 'running', 1, v_lead.is_demo)
  returning id into v_run;

  insert into public.ai_analyses (lead_id, run_id, requested_by, is_demo)
  values (p_lead_id, v_run, v_uid, v_lead.is_demo)
  returning request_id into v_request;

  return jsonb_build_object('outcome', 'requested', 'request_id', v_request);
end;
$$;

-- ---------------------------------------------------------------------------
-- Minimum context for the model. Only for an open request less than 3
-- minutes old, so n8n can't be used to read arbitrary leads. Deliberately
-- excluded: last name, email, phone, agent notes, assignment details.
-- Prospect-written text is returned as data, clearly labelled.
-- ---------------------------------------------------------------------------
create or replace function public.ai_analysis_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.ai_analyses;
  v_lead public.leads;
  v_agent_first text;
  v_messages jsonb;
begin
  select * into v_req from public.ai_analyses where request_id = p_request_id;
  if not found or v_req.status <> 'requested' or v_req.created_at < now() - interval '3 minutes' then
    raise exception 'unknown or expired request' using errcode = 'P0002';
  end if;

  select * into v_lead from public.leads where id = v_req.lead_id;
  select split_part(a.full_name, ' ', 1) into v_agent_first from public.agents a where a.id = v_lead.assigned_agent_id;

  -- Only what the prospect wrote (website form messages / repeat inquiries).
  select coalesce(jsonb_agg(m.body order by m.created_at desc), '[]'::jsonb) into v_messages
    from (
      select left(n.body, 1000) as body, n.created_at from public.lead_notes n
       where n.lead_id = v_lead.id and n.author_id is null and n.author_label = 'Website form'
      union all
      select left(a.details ->> 'message', 1000), a.created_at from public.activities a
       where a.lead_id = v_lead.id and a.type = 'repeat_inquiry' and coalesce(a.details ->> 'message', '') <> ''
      order by 2 desc
      limit 3
    ) m;

  return jsonb_build_object(
    'request_id', v_req.request_id,
    'lead', jsonb_build_object(
      'first_name', split_part(btrim(v_lead.full_name), ' ', 1),
      'source', v_lead.source,
      'pipeline_stage', v_lead.status,
      'property_type', v_lead.property_type,
      'property_interest', v_lead.property_interest,
      'preferred_area', v_lead.preferred_area,
      'budget_usd', v_lead.budget,
      'days_since_inquiry', greatest(0, extract(day from now() - v_lead.created_at))::int,
      'has_follow_up_scheduled', v_lead.next_follow_up_at is not null,
      'prospect_messages', v_messages
    ),
    'brokerage', jsonb_build_object('name', 'Northstar Realty', 'agent_first_name', coalesce(v_agent_first, 'the Northstar team'))
  );
end;
$$;

-- First valid result wins; later deliveries for the same request are ignored.
create or replace function public.complete_ai_analysis(
  p_request_id uuid,
  p_status text,
  p_result jsonb default null,
  p_model text default null,
  p_error text default null,
  p_execution_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.ai_analyses;
begin
  if p_status not in ('succeeded', 'failed', 'invalid_output') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select * into v_req from public.ai_analyses where request_id = p_request_id for update;
  if not found then
    raise exception 'unknown request' using errcode = 'P0002';
  end if;
  if v_req.status <> 'requested' then
    return jsonb_build_object('outcome', 'already_completed', 'status', v_req.status, 'analysis_id', v_req.id);
  end if;

  update public.ai_analyses set
    status = p_status,
    interest_level = case when p_status = 'succeeded' then p_result ->> 'interest_level' end,
    summary = case when p_status = 'succeeded' then p_result ->> 'summary' end,
    reasons = case when p_status = 'succeeded' then p_result -> 'reasons' end,
    next_action = case when p_status = 'succeeded' then p_result ->> 'next_action' end,
    email_subject = case when p_status = 'succeeded' then p_result ->> 'email_subject' end,
    email_body = case when p_status = 'succeeded' then p_result ->> 'email_body' end,
    model = left(p_model, 100),
    external_execution_id = left(p_execution_id, 100),
    error = case when p_status = 'succeeded' then null else left(coalesce(p_error, 'Unknown error'), 1000) end,
    completed_at = now()
  where id = v_req.id;

  update public.automation_runs set
    status = case when p_status = 'succeeded' then 'succeeded' else 'failed' end,
    external_execution_id = left(p_execution_id, 100),
    error = case when p_status = 'succeeded' then null else left(coalesce(p_error, 'Unknown error'), 1000) end,
    result = jsonb_build_object('analysis_id', v_req.id, 'interest_level', p_result ->> 'interest_level', 'model', p_model),
    finished_at = now(), updated_at = now()
  where id = v_req.run_id;

  if p_status = 'succeeded' then
    insert into public.activities (lead_id, actor_label, type, details, is_demo)
    values (v_req.lead_id, 'AI (n8n + Gemini)', 'ai_analysis_generated',
            jsonb_build_object('analysis_id', v_req.id, 'interest_level', p_result ->> 'interest_level'), v_req.is_demo);
  end if;

  return jsonb_build_object('outcome', 'stored', 'status', p_status, 'analysis_id', v_req.id);
end;
$$;

-- Human approval of the email draft. Nothing is sent by LeadPilot.
create or replace function public.approve_ai_draft(p_analysis_id uuid, p_subject text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ai_analyses;
  v_lead public.leads;
begin
  select * into v_row from public.ai_analyses where id = p_analysis_id for update;
  if not found then raise exception 'analysis not found' using errcode = 'P0002'; end if;
  select * into v_lead from public.leads where id = v_row.lead_id;
  if auth.uid() is null or not (public.is_admin() or v_lead.assigned_agent_id = public.current_agent_id()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_row.status <> 'succeeded' then
    raise exception 'only successful analyses have a draft' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 or char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'subject and body are required' using errcode = '22023';
  end if;

  update public.ai_analyses
     set approved_by = auth.uid(), approved_at = now(),
         approved_subject = left(btrim(p_subject), 150), approved_body = left(btrim(p_body), 3000)
   where id = p_analysis_id;

  perform public.log_activity(v_row.lead_id, 'ai_draft_approved',
    jsonb_build_object('analysis_id', v_row.id, 'subject', left(btrim(p_subject), 150)), v_row.is_demo);
end;
$$;

revoke execute on function public.request_ai_analysis(uuid) from public, anon;
revoke execute on function public.ai_analysis_context(uuid) from public, anon, authenticated;
revoke execute on function public.complete_ai_analysis(uuid, text, jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.approve_ai_draft(uuid, text, text) from public, anon;
grant execute on function public.request_ai_analysis(uuid) to authenticated;
grant execute on function public.ai_analysis_context(uuid) to service_role;
grant execute on function public.complete_ai_analysis(uuid, text, jsonb, text, text, text) to service_role;
grant execute on function public.approve_ai_draft(uuid, text, text) to authenticated;

-- ======================================================================
-- 20261121000400_ai_polish.sql
-- ======================================================================
-- LeadPilot AI — Phase 2, stage B polish
-- Capitalize all-lowercase first names typed into the public form and use a
-- properly capitalized signature when a lead has no agent yet.

create or replace function public.ai_analysis_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.ai_analyses;
  v_lead public.leads;
  v_agent_first text;
  v_messages jsonb;
begin
  select * into v_req from public.ai_analyses where request_id = p_request_id;
  if not found or v_req.status <> 'requested' or v_req.created_at < now() - interval '3 minutes' then
    raise exception 'unknown or expired request' using errcode = 'P0002';
  end if;

  select * into v_lead from public.leads where id = v_req.lead_id;
  select split_part(a.full_name, ' ', 1) into v_agent_first from public.agents a where a.id = v_lead.assigned_agent_id;

  -- Only what the prospect wrote (website form messages / repeat inquiries).
  select coalesce(jsonb_agg(m.body order by m.created_at desc), '[]'::jsonb) into v_messages
    from (
      select left(n.body, 1000) as body, n.created_at from public.lead_notes n
       where n.lead_id = v_lead.id and n.author_id is null and n.author_label = 'Website form'
      union all
      select left(a.details ->> 'message', 1000), a.created_at from public.activities a
       where a.lead_id = v_lead.id and a.type = 'repeat_inquiry' and coalesce(a.details ->> 'message', '') <> ''
      order by 2 desc
      limit 3
    ) m;

  return jsonb_build_object(
    'request_id', v_req.request_id,
    'lead', jsonb_build_object(
      'first_name', case when split_part(btrim(v_lead.full_name), ' ', 1) = lower(split_part(btrim(v_lead.full_name), ' ', 1))
                         then initcap(split_part(btrim(v_lead.full_name), ' ', 1))
                         else split_part(btrim(v_lead.full_name), ' ', 1) end,
      'source', v_lead.source,
      'pipeline_stage', v_lead.status,
      'property_type', v_lead.property_type,
      'property_interest', v_lead.property_interest,
      'preferred_area', v_lead.preferred_area,
      'budget_usd', v_lead.budget,
      'days_since_inquiry', greatest(0, extract(day from now() - v_lead.created_at))::int,
      'has_follow_up_scheduled', v_lead.next_follow_up_at is not null,
      'prospect_messages', v_messages
    ),
    'brokerage', jsonb_build_object('name', 'Northstar Realty', 'agent_first_name', coalesce(v_agent_first, 'The Northstar team'))
  );
end;
$$;

revoke execute on function public.ai_analysis_context(uuid) from public, anon, authenticated;
grant execute on function public.ai_analysis_context(uuid) to service_role;

-- ======================================================================
-- 20261122000100_demo_account.sql
-- ======================================================================
-- Public demo account.
--
-- A login whose profile has is_demo = true can explore the CRM as an admin,
-- but the database (not just the UI) stops it from doing anything that would
-- harm the real workspace, even if someone uses the public credentials
-- directly against the Supabase API:
--   * it cannot change profiles (roles), the team roster or automations;
--   * it only sees its own profile, so other users' emails stay private;
--   * leads, tasks and notes it creates are marked is_demo, so "Reset demo
--     data" removes them;
--   * it can edit or delete demo rows only, never real ones.
--
-- Mark the demo login once in the SQL editor (see README → "Public demo account"):
--   update public.profiles set role = 'admin', is_demo = true where email = 'demo@…';

alter table public.profiles add column if not exists is_demo boolean not null default false;

create or replace function public.is_demo_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_demo
  );
$$;

grant execute on function public.is_demo_viewer() to authenticated, service_role;

-- Settings: the demo account sees only itself.
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (public.is_admin() and not public.is_demo_viewer()));

-- Workspace configuration is read-only for the demo account.
create or replace function public.demo_block_config_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- reset_demo_data (admin-only) re-seeds the demo agents.
  if public.is_demo_viewer() and not public.is_seeding() then
    raise exception 'The demo account can''t change %.', replace(tg_table_name, '_', ' ')
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger profiles_demo_guard before update or delete on public.profiles
  for each row execute function public.demo_block_config_writes();
create trigger agents_demo_guard before insert or update or delete on public.agents
  for each row execute function public.demo_block_config_writes();
create trigger automations_demo_guard before insert or update or delete on public.automations
  for each row execute function public.demo_block_config_writes();

-- CRM records: the demo account works inside the demo set only.
create or replace function public.demo_scope_records()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_demo_viewer() or public.is_seeding() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    new.is_demo := true;
    return new;
  end if;
  if not old.is_demo then
    raise exception 'The demo account can only change demo records.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger leads_demo_scope before insert or update or delete on public.leads
  for each row execute function public.demo_scope_records();
create trigger tasks_demo_scope before insert or update or delete on public.tasks
  for each row execute function public.demo_scope_records();
create trigger lead_notes_demo_scope before insert or update or delete on public.lead_notes
  for each row execute function public.demo_scope_records();

revoke execute on function public.demo_block_config_writes() from public, anon, authenticated;
revoke execute on function public.demo_scope_records() from public, anon, authenticated;
