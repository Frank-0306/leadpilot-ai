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
