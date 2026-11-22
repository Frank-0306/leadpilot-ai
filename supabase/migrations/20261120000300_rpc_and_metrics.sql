-- LeadPilot AI — public lead intake, duplicate detection and dashboard metrics

-- ---------------------------------------------------------------------------
-- Public form intake. Only the server (secret key) may call this: the Next.js
-- server action validates input with Zod, checks the honeypot and timing
-- token, hashes the visitor IP and then calls this function, which applies
-- persistent rate limits and de-duplicates repeat inquiries atomically.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_full_name text,
  p_email text,
  p_phone text,
  p_property_type public.property_type,
  p_property_interest text,
  p_preferred_area text,
  p_budget numeric,
  p_message text,
  p_ip_hash text,
  p_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
  v_recent_ip integer;
  v_recent_email integer;
  v_existing uuid;
  v_lead_id uuid;
begin
  if v_email is null or p_ip_hash is null or p_email_hash is null then
    raise exception 'missing required fields' using errcode = '22023';
  end if;

  -- Serialize concurrent submissions for the same email so a double click
  -- can never create two leads.
  perform pg_advisory_xact_lock(hashtextextended('public_lead:' || v_email, 0));

  select count(*) into v_recent_ip from public.lead_submissions
   where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
  select count(*) into v_recent_email from public.lead_submissions
   where email_hash = p_email_hash and created_at > now() - interval '1 hour';

  if v_recent_ip >= 5 or v_recent_email >= 3 then
    insert into public.lead_submissions (ip_hash, email_hash, outcome)
    values (p_ip_hash, p_email_hash, 'rate_limited');
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  -- Repeat inquiry from a lead that is still open → append to that lead.
  select id into v_existing from public.leads
   where email_normalized = v_email and status not in ('won', 'lost')
   order by created_at desc limit 1;

  if v_existing is not null then
    insert into public.activities (lead_id, actor_label, type, details)
    values (v_existing, 'Website form', 'repeat_inquiry', jsonb_build_object(
      'property_interest', left(p_property_interest, 300),
      'message', left(p_message, 2000)
    ));
    if nullif(btrim(coalesce(p_message, '')), '') is not null then
      insert into public.lead_notes (lead_id, author_label, body)
      values (v_existing, 'Website form', left(p_message, 4000));
    end if;
    insert into public.lead_submissions (ip_hash, email_hash, outcome, lead_id)
    values (p_ip_hash, p_email_hash, 'duplicate', v_existing);
    return jsonb_build_object('outcome', 'duplicate', 'lead_id', v_existing);
  end if;

  insert into public.leads (
    full_name, email, phone, source, property_type, property_interest,
    preferred_area, budget, status
  ) values (
    btrim(p_full_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), 'website', p_property_type,
    nullif(btrim(coalesce(p_property_interest, '')), ''), nullif(btrim(coalesce(p_preferred_area, '')), ''),
    p_budget, 'new_lead'
  ) returning id into v_lead_id;

  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    insert into public.lead_notes (lead_id, author_label, body)
    values (v_lead_id, 'Website form', left(p_message, 4000));
  end if;

  insert into public.lead_submissions (ip_hash, email_hash, outcome, lead_id)
  values (p_ip_hash, p_email_hash, 'created', v_lead_id);

  return jsonb_build_object('outcome', 'created', 'lead_id', v_lead_id);
end;
$$;

revoke execute on function public.submit_public_lead(text, text, text, public.property_type, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_public_lead(text, text, text, public.property_type, text, text, numeric, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Duplicate detection for CRM users. SECURITY DEFINER so an agent learns that
-- a matching contact exists even if it belongs to a teammate, but only sees
-- the name and owner — never the full record — unless RLS lets them open it.
-- ---------------------------------------------------------------------------
create or replace function public.find_duplicate_leads(
  p_email text,
  p_phone text,
  p_exclude uuid default null
)
returns table (
  id uuid,
  full_name text,
  status public.lead_status,
  owner_name text,
  match_on text,
  can_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
           nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '') as phone
  )
  select l.id, l.full_name, l.status, a.full_name,
         case when l.email_normalized = i.email and l.phone_digits = i.phone then 'email+phone'
              when l.email_normalized = i.email then 'email'
              else 'phone' end,
         public.is_admin() or l.assigned_agent_id = public.current_agent_id()
    from public.leads l
    cross join input i
    left join public.agents a on a.id = l.assigned_agent_id
   where auth.uid() is not null
     and (p_exclude is null or l.id <> p_exclude)
     and ((i.email is not null and l.email_normalized = i.email)
       or (i.phone is not null and char_length(i.phone) >= 7 and l.phone_digits = i.phone))
   order by l.created_at desc
   limit 5;
$$;

revoke execute on function public.find_duplicate_leads(text, text, uuid) from public, anon;
grant execute on function public.find_duplicate_leads(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard metrics. SECURITY INVOKER: RLS decides which leads and tasks are
-- counted, so an agent automatically sees only their own numbers.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_agent uuid default null,
  p_time_zone text default 'UTC'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_span interval := p_to - p_from;
  v_result jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if p_to <= p_from or v_span > interval '400 days' then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  with scoped as (
    select * from public.leads where p_agent is null or assigned_agent_id = p_agent
  ),
  scoped_tasks as (
    select * from public.tasks where p_agent is null or assigned_agent_id = p_agent
  ),
  closed as (
    select * from scoped where closed_at >= p_from and closed_at < p_to
  ),
  days as (
    -- Calendar days in the brokerage's time zone.
    select d::date as day
      from generate_series((p_from at time zone p_time_zone)::date,
                           ((p_to - interval '1 second') at time zone p_time_zone)::date,
                           interval '1 day') d
  )
  select jsonb_build_object(
    'total_leads', (select count(*) from scoped),
    'new_leads', (select count(*) from scoped where created_at >= p_from and created_at < p_to),
    'new_leads_previous', (select count(*) from scoped where created_at >= p_from - v_span and created_at < p_from),
    'awaiting_first_contact', (select count(*) from scoped where status = 'new_lead'),
    'active_opportunities', (select count(*) from scoped where status in ('qualified', 'viewing_scheduled', 'negotiation')),
    'active_pipeline_value', (select coalesce(sum(budget), 0) from scoped where status in ('qualified', 'viewing_scheduled', 'negotiation')),
    'won', (select count(*) from closed where status = 'won'),
    'won_value', (select coalesce(sum(budget), 0) from closed where status = 'won'),
    'lost', (select count(*) from closed where status = 'lost'),
    'won_previous', (select count(*) from scoped where status = 'won' and won_at >= p_from - v_span and won_at < p_from),
    'pending_tasks', (select count(*) from scoped_tasks where completed_at is null),
    'overdue_tasks', (select count(*) from scoped_tasks where completed_at is null and due_at < now()),
    'follow_ups_due', (select count(*) from scoped where next_follow_up_at <= now() and status not in ('won', 'lost')),
    'pipeline', (
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', coalesce(c.n, 0), 'value', coalesce(c.v, 0)) order by s.ord)
      from unnest(enum_range(null::public.lead_status)) with ordinality as s(status, ord)
      left join (select status, count(*) n, sum(budget) v from scoped group by status) c on c.status = s.status
    ),
    'series', (
      select jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'created', (select count(*) from scoped l where (l.created_at at time zone p_time_zone)::date = d.day),
        'won', (select count(*) from scoped l where (l.won_at at time zone p_time_zone)::date = d.day)
      ) order by d.day)
      from days d
    ),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc), '[]'::jsonb)
      from (select source, count(*) n from scoped where created_at >= p_from and created_at < p_to group by source) x
    ),
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'full_name', a.full_name, 'color', a.color,
        'open', (select count(*) from scoped l where l.assigned_agent_id = a.id and l.status not in ('won', 'lost')),
        'won', (select count(*) from closed l where l.assigned_agent_id = a.id and l.status = 'won'),
        'closed', (select count(*) from closed l where l.assigned_agent_id = a.id)
      ) order by a.full_name), '[]'::jsonb)
      from public.agents a
      where a.is_active
        and (p_agent is null or a.id = p_agent)
        and exists (select 1 from scoped l where l.assigned_agent_id = a.id)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid, text) to authenticated;
