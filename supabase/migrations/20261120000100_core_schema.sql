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
