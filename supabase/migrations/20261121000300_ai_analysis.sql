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
