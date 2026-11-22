-- Phase 2 stage A: automation registry, idempotent follow-up tasks, run
-- bookkeeping, routing of events without subscribers, retries, permissions.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- A fresh website lead (service role, as the public form does).
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select (public.submit_public_lead('Nora Diaz', 'nora.diaz@example.com', null, 'condo', 'Condo downtown', 'Downtown',
  1250000, 'Looking to buy this spring', 'ip-auto', 'em-auto') ->> 'lead_id') as lead_id \gset
select set_config('t.lead_id', :'lead_id', false);
select id as event_id, idempotency_key as ikey from public.events
 where type = 'lead.created' and aggregate_id = :'lead_id'::uuid \gset
select set_config('t.event_id', :'event_id', false);
select set_config('t.ikey', :'ikey', false);

-- Dispatcher claims: only lead.created is routed (to the New Lead Automation);
-- events without a subscriber are skipped instead of retried forever.
select count(*) as claimed_count from public.claim_automation_events(100) where id = :'event_id'::uuid and webhook_path = 'leadpilot-new-lead' \gset
select set_config('t.claimed_count', :'claimed_count', false);
reset role;
do $$ begin
  assert current_setting('t.claimed_count')::int = 1, 'lead.created routed to the n8n webhook path';
  assert (select status from public.events where id = current_setting('t.event_id')::uuid) = 'processing', 'claimed';
  assert not exists (select 1 from public.events where type <> 'lead.created' and status in ('pending', 'failed')),
    'events without an enabled automation are skipped';
end $$;
\echo '  ok  events are routed to their automation; unsubscribed events are skipped'

-- n8n calls back: create the follow-up task. Twice — the second time is a
-- duplicate delivery and must not create a second task.
set role service_role;
select public.automation_create_follow_up_task(:'event_id'::uuid, :'ikey', 'exec-1') as first \gset
select set_config('t.first', :'first', false);
select public.automation_create_follow_up_task(:'event_id'::uuid, :'ikey', 'exec-2') as second \gset
select set_config('t.second', :'second', false);
reset role;
do $$
declare f jsonb := current_setting('t.first')::jsonb; s jsonb := current_setting('t.second')::jsonb;
        t public.tasks;
begin
  assert f ->> 'outcome' = 'created', 'first delivery creates the task';
  assert s ->> 'outcome' = 'duplicate' and s ->> 'task_id' = f ->> 'task_id', 'second delivery returns the same task';
  assert (select count(*) from public.tasks where lead_id = current_setting('t.lead_id')::uuid and source = 'automation') = 1,
    'exactly one automated task';
  select * into t from public.tasks where id = (f ->> 'task_id')::uuid;
  assert t.automation_key = 'new_lead_follow_up', 'task records which automation created it';
  assert t.priority = 'high', 'budget >= $1M gets high priority';
  assert t.due_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute', 'due after follow_up_hours (24)';
  assert (select status from public.automation_runs where event_id = current_setting('t.event_id')::uuid) = 'succeeded', 'run recorded';
  assert (select external_execution_id from public.automation_runs where event_id = current_setting('t.event_id')::uuid) = 'exec-2',
    'latest n8n execution id kept';
  assert (select actor_label from public.activities where lead_id = current_setting('t.lead_id')::uuid and type = 'task_created')
    = 'Automation: New Lead Automation', 'history shows the automation as the actor';
end $$;
\echo '  ok  follow-up task created once even when the event is processed twice'

-- Forged / mismatched callbacks are rejected.
set role service_role;
do $$ begin
  begin
    perform public.automation_create_follow_up_task(current_setting('t.event_id')::uuid, 'lead.created:forged', null);
    raise exception 'accepted a mismatched idempotency key';
  exception when no_data_found then null;
  end;
  begin
    perform public.automation_create_follow_up_task(gen_random_uuid(), 'x', null);
    raise exception 'accepted an unknown event';
  exception when no_data_found then null;
  end;
end $$;
reset role;
\echo '  ok  callbacks must reference a real event and its exact idempotency key'

-- A late failure report cannot overwrite a success.
set role service_role;
select public.record_automation_run(:'event_id'::uuid, 'failed', 'timeout after success', null, null);
reset role;
do $$ begin
  assert (select status from public.automation_runs where event_id = current_setting('t.event_id')::uuid) = 'succeeded';
end $$;

-- Assigning the lead hands the automated task to the agent.
update public.leads set assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000001' where id = :'lead_id'::uuid;
do $$ begin
  assert (select assigned_agent_id from public.tasks where lead_id = current_setting('t.lead_id')::uuid and source = 'automation')
    = '0a6e5f10-0000-4000-8000-000000000001', 'automated task follows the lead owner';
end $$;
\echo '  ok  automated tasks follow the lead when it is assigned'

-- Failure path: n8n unreachable → event failed with backoff, run failed with error, lead intact.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select (public.submit_public_lead('Omar Reyes', 'omar.reyes@example.com', null, null, null, null, null, null, 'ip-auto2', 'em-auto2') ->> 'lead_id') as lead2 \gset
select set_config('t.lead2', :'lead2', false);
select id as event2 from public.claim_automation_events(100) where type = 'lead.created' limit 1 \gset
select set_config('t.event2', :'event2', false);
select public.complete_event_delivery(:'event2'::uuid, false, null, 'connect ECONNREFUSED 127.0.0.1:5678', 12);
select public.record_automation_run(:'event2'::uuid, 'failed', 'connect ECONNREFUSED 127.0.0.1:5678', null, null);
reset role;
do $$ begin
  assert exists (select 1 from public.leads where id = current_setting('t.lead2')::uuid), 'lead stays saved when n8n is down';
  assert (select status from public.events where id = current_setting('t.event2')::uuid) = 'failed', 'event marked failed';
  assert (select error from public.automation_runs where event_id = current_setting('t.event2')::uuid) like '%ECONNREFUSED%', 'error recorded';
end $$;
\echo '  ok  connection failures keep the lead and record the error'

-- Retry: admins only.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  begin
    perform public.retry_event(current_setting('t.event2')::uuid);
    raise exception 'agent retried an event';
  exception when insufficient_privilege then null;
  end;
  -- agents never see the automation registry settings change
  update public.automations set enabled = false where key = 'new_lead_follow_up';
  assert (select enabled from public.automations where key = 'new_lead_follow_up'), 'agent cannot disable automations';
  -- agents see runs only for their own leads
  assert (select count(*) from public.automation_runs where lead_id = current_setting('t.lead_id')::uuid) = 1, 'own lead run visible';
  assert (select count(*) from public.automation_runs where lead_id = current_setting('t.lead2')::uuid) = 0, 'unassigned lead run hidden';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.retry_event(:'event2'::uuid);
do $$ begin
  assert (select status from public.events where id = current_setting('t.event2')::uuid) = 'pending', 'retry re-queues';
  assert (select next_attempt_at from public.events where id = current_setting('t.event2')::uuid) <= now(), 'retry is immediate';
  assert (select status from public.automation_runs where event_id = current_setting('t.event2')::uuid) = 'queued', 'run re-queued';
  begin
    update public.automations set settings = '{"follow_up_hours": 0}' where key = 'new_lead_follow_up';
    raise exception 'invalid delay accepted';
  exception when check_violation then null;
  end;
end $$;
update public.automations set settings = '{"follow_up_hours": 4}' where key = 'new_lead_follow_up';
reset role;
do $$ begin
  assert (select settings ->> 'follow_up_hours' from public.automations where key = 'new_lead_follow_up') = '4', 'admin can change the delay';
end $$;
\echo '  ok  retries and settings are admin-only and validated'

-- Disabled automation: events are skipped, no task is created.
update public.automations set enabled = false where key = 'new_lead_follow_up';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select count(*) as n from public.claim_automation_events(100) \gset
select set_config('t.n', :'n', false);
reset role;
do $$ begin
  assert current_setting('t.n')::int = 0, 'nothing claimed while disabled';
  assert (select status from public.events where id = current_setting('t.event2')::uuid) = 'skipped', 'pending event skipped';
end $$;
update public.automations set enabled = true where key = 'new_lead_follow_up';
\echo '  ok  disabling an automation stops it cleanly'

-- Events without a subscriber never wait in "pending".
do $$ begin
  assert not exists (select 1 from public.events where type = 'task.created' and status = 'pending'),
    'task.created events are skipped immediately';
  assert (select status from public.events where type = 'task.created' order by created_at desc limit 1) = 'skipped';
end $$;
\echo '  ok  events with no automation are recorded as skipped immediately'
