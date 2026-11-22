-- Runs in a NEW database session after 10_flows_and_permissions.sql, the same
-- way a page reload opens a new request: everything must still be there.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

do $$
declare l public.leads;
begin
  select * into l from public.leads where email_normalized = 'taylor.brooks@example.com';
  assert l.id is not null, 'public lead persisted';
  assert l.status = 'won' and l.won_at is not null, 'pipeline status persisted';
  assert l.assigned_agent_id = '0a6e5f10-0000-4000-8000-000000000001', 'assignment persisted';
  assert (select count(*) from public.tasks where lead_id = l.id and completed_at is not null) = 1, 'completed task persisted';
  assert (select count(*) from public.activities where lead_id = l.id) >= 8, 'full history persisted';
end $$;
\echo '  ok  8. data persists across sessions (reload)'

-- Admin resets demo data: demo rows are rebuilt, real data is untouched.
select count(*) as real_before from public.leads where not is_demo \gset
select set_config('t.real_before', :'real_before', false);
select count(*) as profiles_before from public.profiles \gset
select set_config('t.profiles_before', :'profiles_before', false);

-- Make a change to a demo lead so we can see the reset undo it.
update public.leads set status = 'lost' where email = 'olivia.bennett@example.com';

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.reset_demo_data() as reset_result \gset
select set_config('t.reset_result', :'reset_result', false);
reset role;

do $$
declare r jsonb := current_setting('t.reset_result')::jsonb;
begin
  assert (r ->> 'seeded_leads')::int >= 30, 'demo leads recreated';
  assert (select count(*) from public.leads where not is_demo) = current_setting('t.real_before')::int, 'real leads untouched';
  assert exists (select 1 from public.leads where email_normalized = 'taylor.brooks@example.com'), 'public lead survives reset';
  assert (select count(*) from public.profiles) = current_setting('t.profiles_before')::int, 'users untouched';
  assert (select user_id from public.agents where id = '0a6e5f10-0000-4000-8000-000000000001') = '22222222-2222-4222-8222-222222222222',
    'linked agent login survives reset';
  assert (select status from public.leads where email = 'olivia.bennett@example.com') = 'new_lead', 'demo changes reverted';
  assert (select count(*) from public.leads where email = 'olivia.bennett@example.com') = 1, 'no duplicated demo rows';
  assert (select count(*) from public.events where is_demo) = 0, 'demo events cleared, real events kept';
  assert (select count(*) from public.events where not is_demo) > 0, 'real events kept';
end $$;
\echo '  ok  demo reset rebuilds demo rows only'
