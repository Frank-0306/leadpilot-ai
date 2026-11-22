-- End-to-end business flows and permission rules, exercised through the same
-- roles Supabase uses (anon, authenticated, service_role) with RLS active.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- ---------------------------------------------------------------------------
-- Fixtures: one admin, two agent logins linked to demo agents.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'admin@northstar.test', '{"full_name":"Avery Admin"}'),
  ('22222222-2222-4222-8222-222222222222', 'maya@northstar.test', '{"full_name":"Maya Thompson"}'),
  ('33333333-3333-4333-8333-333333333333', 'daniel@northstar.test', '{"full_name":"Daniel Brooks"}');

update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';
update public.agents set user_id = '22222222-2222-4222-8222-222222222222' where id = '0a6e5f10-0000-4000-8000-000000000001';
update public.agents set user_id = '33333333-3333-4333-8333-333333333333' where id = '0a6e5f10-0000-4000-8000-000000000002';

do $$ begin
  assert (select count(*) from public.profiles) = 3, 'signup trigger should create one profile per auth user';
  assert (select role from public.profiles where id = '22222222-2222-4222-8222-222222222222') = 'agent', 'new users default to agent';
  assert (select count(*) from public.leads where is_demo) >= 30, 'at least 30 demo leads';
  assert (select count(*) from public.agents where is_demo) = 5, 'five demo agents';
  assert (select count(*) from public.tasks where is_demo) > 30, 'demo tasks exist';
  assert (select count(*) from public.events) = 0, 'seeding must not emit outbound events';
  assert (select count(*) from public.leads where email not like '%@example.com') = 0, 'demo emails use example.com';
end $$;
\echo '  ok  fixtures, signup trigger and demo seed'

-- ---------------------------------------------------------------------------
-- 1. Public form → lead (service role only)
-- ---------------------------------------------------------------------------
set role anon;
do $$ begin
  begin
    perform public.submit_public_lead('Eve Visitor', 'eve@example.com', null, 'condo', null, null, null, null, 'ip', 'em');
    raise exception 'anon must not call submit_public_lead';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.leads limit 1;
    raise exception 'anon must not read leads';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo '  ok  anonymous visitors cannot call the intake RPC or read CRM tables'

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select (public.submit_public_lead(
  'Taylor Brooks', 'Taylor.Brooks@Example.com ', '(555) 019-4410', 'single_family',
  '3 bed near Lakeview schools', 'Lakeview', 525000, 'Can we tour this weekend?', 'ip-hash-A', 'email-hash-T'
) ->> 'lead_id') as public_lead_id \gset
select set_config('t.public_lead_id', :'public_lead_id', false);
reset role;

do $$
declare l public.leads;
begin
  select * into l from public.leads where id = current_setting('t.public_lead_id')::uuid;
  assert l.source = 'website', 'origin must be Website';
  assert l.status = 'new_lead', 'status must be New Lead';
  assert l.email = 'taylor.brooks@example.com', 'email is normalized';
  assert l.assigned_agent_id is null, 'public leads start unassigned';
  assert not l.is_demo, 'public submissions are real data';
  assert (select count(*) from public.events where type = 'lead.created' and aggregate_id = l.id and status = 'pending') = 1,
    'lead.created event queued in the outbox';
  assert (select count(*) from public.activities where lead_id = l.id and type = 'lead_created') = 1, 'history entry';
  assert (select count(*) from public.lead_notes where lead_id = l.id and author_label = 'Website form') = 1, 'message saved as note';
end $$;
\echo '  ok  1. public form creates a Website / New Lead lead + lead.created event'

-- Repeat submission (double click / second inquiry) → no second lead.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select public.submit_public_lead('Taylor Brooks', 'taylor.brooks@example.com', null, 'single_family',
  'Also open to townhouses', null, null, 'Following up', 'ip-hash-A', 'email-hash-T') ->> 'outcome' as outcome \gset
select set_config('t.outcome', :'outcome', false);
reset role;
do $$ begin
  assert current_setting('t.outcome') = 'duplicate', 'repeat inquiry detected';
  assert (select count(*) from public.leads where email_normalized = 'taylor.brooks@example.com') = 1, 'no duplicate lead';
  assert (select count(*) from public.activities where lead_id = current_setting('t.public_lead_id')::uuid and type = 'repeat_inquiry') = 1, 'repeat inquiry logged';
  assert (select count(*) from public.events where type = 'lead.created') = 1, 'no second lead.created event';
end $$;
\echo '  ok  repeat submissions are merged into the existing lead'

-- Rate limit: 5 submissions per IP per 10 minutes.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select public.submit_public_lead('Spam One', 's1@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e1');
select public.submit_public_lead('Spam Two', 's2@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e2');
select public.submit_public_lead('Spam Three', 's3@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e3');
select public.submit_public_lead('Spam Four', 's4@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e4');
select public.submit_public_lead('Spam Five', 's5@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e5');
select public.submit_public_lead('Spam Six', 's6@example.com', null, null, null, null, null, null, 'ip-hash-B', 'e6') ->> 'outcome' as outcome \gset
select set_config('t.outcome', :'outcome', false);
reset role;
do $$ begin
  assert current_setting('t.outcome') = 'rate_limited', 'sixth submission from one IP is rejected';
  assert not exists (select 1 from public.leads where email = 's6@example.com'), 'rate-limited lead not stored';
end $$;
delete from public.leads where email like 's_@example.com';
\echo '  ok  per-IP rate limit blocks bursts'

-- ---------------------------------------------------------------------------
-- 2. Admin sees the new lead; agents do not (it is unassigned)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.leads where id = current_setting('t.public_lead_id')::uuid) = 1, 'admin sees public lead';
  assert (select count(*) from public.leads) = (select count(*) from public.leads), 'sanity';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.leads where id = current_setting('t.public_lead_id')::uuid) = 0, 'agent cannot see unassigned lead';
end $$;
reset role;
\echo '  ok  2. lead visible in the CRM to admins'

-- ---------------------------------------------------------------------------
-- 4. Admin assigns the lead to Maya
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
update public.leads set assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000001' where id = :'public_lead_id';
reset role;
do $$ begin
  assert (select count(*) from public.events where type = 'lead.assigned' and aggregate_id = current_setting('t.public_lead_id')::uuid) = 1, 'lead.assigned event';
  assert (select actor_label from public.activities where lead_id = current_setting('t.public_lead_id')::uuid and type = 'assigned') = 'Avery Admin',
    'history records who assigned it';
end $$;
\echo '  ok  4. assignment emits lead.assigned and is recorded in history'

-- ---------------------------------------------------------------------------
-- 3. Maya moves it through the pipeline (Kanban)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.leads where id = current_setting('t.public_lead_id')::uuid) = 1, 'assigned agent now sees the lead';
end $$;
update public.leads set status = 'contacted', position = 0.5 where id = :'public_lead_id';
update public.leads set status = 'qualified' where id = :'public_lead_id';
update public.leads set position = 3 where id = :'public_lead_id';  -- reorder only: no status event
reset role;
do $$ begin
  assert (select status from public.leads where id = current_setting('t.public_lead_id')::uuid) = 'qualified', 'status persisted';
  assert (select count(*) from public.events where type = 'lead.status_changed' and aggregate_id = current_setting('t.public_lead_id')::uuid) = 2,
    'one lead.status_changed per transition, none for reordering';
  assert (select count(distinct idempotency_key) from public.events where aggregate_id = current_setting('t.public_lead_id')::uuid) =
         (select count(*) from public.events where aggregate_id = current_setting('t.public_lead_id')::uuid), 'idempotency keys are unique';
  assert (select count(*) from public.activities where lead_id = current_setting('t.public_lead_id')::uuid and type = 'status_changed') = 2, 'history';
end $$;
\echo '  ok  3. Kanban status changes persist and emit lead.status_changed'

-- ---------------------------------------------------------------------------
-- 7. Agent permission boundaries
-- ---------------------------------------------------------------------------
set role authenticated;  -- still Maya
do $$
declare n integer;
begin
  -- cannot see a teammate's leads
  assert (select count(*) from public.leads where assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000002') = 0,
    'agent cannot read teammate leads';
  assert (select count(*) from public.leads) = (select count(*) from public.leads where assigned_agent_id = public.current_agent_id()),
    'agent sees only own leads';

  -- cannot hand a lead to someone else
  begin
    update public.leads set assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000002' where id = current_setting('t.public_lead_id')::uuid;
    raise exception 'agent reassigned a lead';
  exception when insufficient_privilege then null;
  end;

  -- cannot delete (RLS hides the row from DELETE)
  delete from public.leads where id = current_setting('t.public_lead_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'agent cannot delete leads';

  -- cannot modify a teammate's lead
  update public.leads set status = 'lost' where assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'agent cannot update teammate leads';

  -- cannot promote themselves
  update public.profiles set role = 'admin' where id = auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'agent cannot change roles';

  -- cannot read the event log or forge history
  assert (select count(*) from public.events) = 0, 'events hidden from agents';
  begin
    insert into public.activities (lead_id, type) values (current_setting('t.public_lead_id')::uuid, 'note_added');
    raise exception 'agent wrote history directly';
  exception when insufficient_privilege then null;
  end;

  -- cannot run admin / service operations
  begin
    perform public.reset_demo_data();
    raise exception 'agent reset demo data';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.claim_pending_events(1);
    raise exception 'agent claimed events';
  exception when insufficient_privilege then null;
  end;

  -- cannot create tasks for a teammate
  begin
    insert into public.tasks (title, assigned_agent_id, due_at)
    values ('Not mine', '0a6e5f10-0000-4000-8000-000000000002', now() + interval '1 day');
    raise exception 'agent created a task for a teammate';
  exception when insufficient_privilege then null;
  end;

  -- the roster is readable
  assert (select count(*) from public.agents) >= 5, 'agents roster visible';
end $$;
reset role;
\echo '  ok  7. agents are limited to their own records; admin/service actions are blocked'

-- Duplicate detection tells an agent a contact exists without exposing it.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
do $$
declare d record;
begin
  select * into d from public.find_duplicate_leads('Chloe.Fisher@example.com', null);
  assert d.full_name = 'Chloe Fisher' and d.match_on = 'email', 'duplicate found by email (case-insensitive)';
  assert d.can_open, 'Maya owns Chloe';
  select * into d from public.find_duplicate_leads(null, '555-019-4410');
  assert d.id = current_setting('t.public_lead_id')::uuid and d.match_on = 'phone', 'duplicate found by phone digits';
  select * into d from public.find_duplicate_leads('ethan.morales@example.com', null);
  assert d.full_name = 'Ethan Morales' and not d.can_open, 'teammate''s contact flagged but not openable';
end $$;
reset role;
\echo '  ok  duplicate detection by email/phone respects ownership'

-- ---------------------------------------------------------------------------
-- 5. Tasks: create and complete
-- ---------------------------------------------------------------------------
set role authenticated;  -- Maya
insert into public.tasks (lead_id, title, assigned_agent_id, due_at, priority)
values (:'public_lead_id', 'Send Taylor three Lakeview listings', public.current_agent_id(), now() + interval '1 day', 'high')
returning id as task_id \gset
select set_config('t.task_id', :'task_id', false);
update public.tasks set completed_at = now() where id = :'task_id';
reset role;
do $$ begin
  assert (select completed_by from public.tasks where id = current_setting('t.task_id')::uuid) = '22222222-2222-4222-8222-222222222222', 'completed_by stamped';
  assert (select count(*) from public.events where type = 'task.created' and aggregate_id = current_setting('t.task_id')::uuid) = 1, 'task.created event';
  assert (select count(*) from public.activities where lead_id = current_setting('t.public_lead_id')::uuid and type in ('task_created', 'task_completed')) = 2,
    'task history on the lead';
end $$;
\echo '  ok  5. tasks can be created, assigned and completed'

-- ---------------------------------------------------------------------------
-- 6. Indicators react to the data
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.dashboard_metrics(now() - interval '30 days', now() + interval '1 minute', null, 'America/Chicago') as before_json \gset
select set_config('t.before_json', :'before_json', false);
update public.leads set status = 'won' where id = :'public_lead_id';
select public.dashboard_metrics(now() - interval '30 days', now() + interval '1 minute', null, 'America/Chicago') as after_json \gset
select set_config('t.after_json', :'after_json', false);
reset role;
do $$
declare b jsonb := current_setting('t.before_json'); a jsonb := current_setting('t.after_json');
begin
  assert (a ->> 'total_leads')::int = (select count(*) from public.leads), 'total matches table';
  assert (a ->> 'won')::int = (b ->> 'won')::int + 1, 'won count increments after a deal closes';
  assert (a ->> 'active_opportunities')::int = (b ->> 'active_opportunities')::int - 1, 'active opportunities decrease';
  assert (a ->> 'won_value')::numeric = (b ->> 'won_value')::numeric + 525000, 'won value includes the budget';
  assert jsonb_array_length(a -> 'pipeline') = 7, 'all seven stages present';
  assert jsonb_array_length(a -> 'series') between 30 and 32, 'one point per day';
end $$;

-- An agent's dashboard only counts their own leads.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.dashboard_metrics(now() - interval '30 days', now() + interval '1 minute', null, 'America/Chicago') ->> 'total_leads' as agent_total \gset
select set_config('t.agent_total', :'agent_total', false);
reset role;
do $$ begin
  assert current_setting('t.agent_total')::int = (select count(*) from public.leads where assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000001'),
    'agent metrics scoped by RLS';
  assert current_setting('t.agent_total')::int < (select count(*) from public.leads), 'agent sees fewer than admin';
end $$;
\echo '  ok  6. dashboard metrics are computed from stored data and scoped by role'

-- ---------------------------------------------------------------------------
-- task.overdue + dispatcher primitives (idempotency and retries)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select public.emit_overdue_task_events() as first_run \gset
select set_config('t.first_run', :'first_run', false);
select public.emit_overdue_task_events() as second_run \gset
select set_config('t.second_run', :'second_run', false);
reset role;
do $$ begin
  assert current_setting('t.first_run')::int > 0, 'overdue tasks produce events';
  assert current_setting('t.second_run')::int = 0, 'running the overdue job again emits nothing new';
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select array_agg(id) as claimed from public.claim_pending_events(3) \gset
select set_config('t.claimed', :'claimed', false);
reset role;
do $$
declare ids uuid[] := current_setting('t.claimed');
begin
  assert array_length(ids, 1) = 3, 'claims a batch';
  assert (select count(*) from public.events where id = any(ids) and status = 'processing' and attempts = 1) = 3, 'locked';
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select public.complete_event_delivery((:'claimed'::uuid[])[1], true, 200, null, 42);
select public.complete_event_delivery((:'claimed'::uuid[])[2], false, 500, 'n8n returned 500', 80);
select count(*) as reclaimed from public.claim_pending_events(100) where id = any(:'claimed'::uuid[]) \gset
select set_config('t.reclaimed', :'reclaimed', false);
reset role;
do $$
declare ids uuid[] := current_setting('t.claimed');
begin
  assert (select status from public.events where id = ids[1]) = 'delivered', 'success marks delivered';
  assert (select status from public.events where id = ids[2]) = 'failed', 'failure marks failed';
  assert (select next_attempt_at from public.events where id = ids[2]) > now(), 'failed event waits for backoff';
  assert current_setting('t.reclaimed')::int = 0, 'delivered, backing-off and in-flight events are not claimed again';
  assert (select count(*) from public.event_deliveries) = 2, 'each attempt is logged';
end $$;
\echo '  ok  task.overdue is idempotent; outbox claim/ack/backoff works'
