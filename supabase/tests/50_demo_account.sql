-- Public demo account: admin-level reads, but no harm to the real workspace,
-- enforced in the database so the public credentials are safe to share.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0d0d0d0-0000-4000-8000-0000000000aa', 'owner@northstar.test', '{"full_name":"Olivia Owner"}'),
  ('d0d0d0d0-0000-4000-8000-0000000000dd', 'demo@northstar.test', '{"full_name":"Demo Visitor"}');
update public.profiles set role = 'admin' where id = 'd0d0d0d0-0000-4000-8000-0000000000aa';
update public.profiles set role = 'admin', is_demo = true where id = 'd0d0d0d0-0000-4000-8000-0000000000dd';

-- A real (non-demo) lead with a task and a note, created by the owner.
select set_config('request.jwt.claims', '{"sub":"d0d0d0d0-0000-4000-8000-0000000000aa","role":"authenticated"}', false);
set role authenticated;
insert into public.leads (full_name, email, source, status)
values ('Real Prospect', 'real.prospect@example.com', 'referral', 'new_lead')
returning id as real_lead_id \gset
insert into public.tasks (lead_id, title, due_at) values (:'real_lead_id', 'Call the real prospect', now() + interval '1 day') returning id as real_task_id \gset
insert into public.lead_notes (lead_id, author_id, body) values (:'real_lead_id', auth.uid(), 'Real note') returning id as real_note_id \gset
reset role;
select set_config('t.real_lead_id', :'real_lead_id', false);
select set_config('t.real_task_id', :'real_task_id', false);
select set_config('t.real_note_id', :'real_note_id', false);

do $$ begin
  assert not (select is_demo from public.leads where id = current_setting('t.real_lead_id')::uuid), 'owner leads are real';
end $$;

-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0d0d0d0-0000-4000-8000-0000000000dd","role":"authenticated"}', false);
set role authenticated;
do $$
declare v_id uuid; v_n int;
begin
  assert public.is_admin(), 'demo account reads as admin';
  assert public.is_demo_viewer(), 'demo account is detected';
  assert (select count(*) from public.leads where is_demo) >= 30, 'demo account sees the demo pipeline';
  assert (select count(*) from public.leads where id = current_setting('t.real_lead_id')::uuid) = 1, 'demo account can view real leads';

  -- Only its own profile is visible: other users' emails stay private.
  assert (select count(*) from public.profiles) = 1, 'demo account sees only its own profile';

  -- Configuration is read-only.
  begin
    update public.profiles set is_demo = false where id = auth.uid();
    raise exception 'demo account changed its own profile';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.agents set user_id = auth.uid() where id = '0a6e5f10-0000-4000-8000-000000000001';
    raise exception 'demo account linked an agent';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.automations set enabled = false where key = 'new_lead_follow_up';
    raise exception 'demo account paused an automation';
  exception when insufficient_privilege then null;
  end;

  -- Real records are untouchable.
  begin
    delete from public.leads where id = current_setting('t.real_lead_id')::uuid;
    raise exception 'demo account deleted a real lead';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leads set full_name = 'Vandalized' where id = current_setting('t.real_lead_id')::uuid;
    raise exception 'demo account edited a real lead';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.tasks where id = current_setting('t.real_task_id')::uuid;
    raise exception 'demo account deleted a real task';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.lead_notes where id = current_setting('t.real_note_id')::uuid;
    raise exception 'demo account deleted a real note';
  exception when insufficient_privilege then null;
  end;

  -- New records are demo records, editable and deletable.
  insert into public.leads (full_name, email, source, status)
  values ('Visitor Test Lead', 'visitor.test@example.com', 'referral', 'new_lead') returning id into v_id;
  assert (select is_demo from public.leads where id = v_id), 'leads created by the demo account are demo leads';
  update public.leads set status = 'contacted' where id = v_id;
  insert into public.tasks (lead_id, title, due_at) values (v_id, 'Visitor task', now() + interval '1 day');
  assert (select bool_and(is_demo) from public.tasks where lead_id = v_id), 'tasks created by the demo account are demo tasks';

  -- Demo leads can be moved and deleted.
  update public.leads set status = 'qualified'
   where id = (select id from public.leads where is_demo and status = 'new_lead' limit 1);
  delete from public.leads where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'demo account can delete demo leads';

  -- And the demo set can be reset.
  perform public.reset_demo_data();
end $$;
reset role;

do $$ begin
  assert (select full_name from public.leads where id = current_setting('t.real_lead_id')::uuid) = 'Real Prospect', 'real lead untouched';
  assert exists (select 1 from public.tasks where id = current_setting('t.real_task_id')::uuid), 'real task survives reset';
  assert exists (select 1 from public.lead_notes where id = current_setting('t.real_note_id')::uuid), 'real note survives reset';
  assert (select is_demo from public.profiles where id = 'd0d0d0d0-0000-4000-8000-0000000000dd'), 'demo flag still set';
  assert (select enabled from public.automations where key = 'new_lead_follow_up'), 'automation still enabled';
end $$;

-- A regular admin is unaffected.
select set_config('request.jwt.claims', '{"sub":"d0d0d0d0-0000-4000-8000-0000000000aa","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  assert not public.is_demo_viewer(), 'owner is not the demo account';
  assert (select count(*) from public.profiles) >= 2, 'regular admins still see every profile';
  update public.leads set full_name = 'Real Prospect Jr' where id = current_setting('t.real_lead_id')::uuid;
end $$;
reset role;
delete from public.leads where email = 'real.prospect@example.com';
select set_config('request.jwt.claims', '', false);

\o
\echo '  ok  demo account: admin reads, no config changes, real records protected, own records are demo'
