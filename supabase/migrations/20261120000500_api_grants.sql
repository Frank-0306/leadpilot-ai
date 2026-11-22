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
