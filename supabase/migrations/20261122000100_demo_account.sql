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
