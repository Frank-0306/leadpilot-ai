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
