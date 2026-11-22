-- LeadPilot AI — demo data for the fictional brokerage Northstar Realty.
--
-- Every row created here has is_demo = true. All people, emails and phone
-- numbers are invented (example.com addresses and 555-01xx numbers, which
-- are reserved for fiction). reset_demo_data() deletes ONLY demo rows and
-- recreates them; real users, profiles and non-demo leads are never touched.

create or replace function public.seed_demo_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agents uuid[] := array[
    '0a6e5f10-0000-4000-8000-000000000001',
    '0a6e5f10-0000-4000-8000-000000000002',
    '0a6e5f10-0000-4000-8000-000000000003',
    '0a6e5f10-0000-4000-8000-000000000004',
    '0a6e5f10-0000-4000-8000-000000000005'
  ]::uuid[];
  v_path public.lead_status[];
  v_lead_id uuid;
  v_created timestamptz;
  v_step_at timestamptz;
  v_i integer := 0;
  v_j integer;
  v_count integer := 0;
  r record;
begin
  perform set_config('leadpilot.seeding', 'on', true);

  -- Demo agents use fixed ids so a real login linked to one survives resets.
  insert into public.agents (id, full_name, email, phone, title, color, is_demo) values
    (v_agents[1], 'Maya Thompson',  'maya.thompson@example.com',  '(555) 010-1101', 'Senior Agent',        '#3B6EF5', true),
    (v_agents[2], 'Daniel Brooks',  'daniel.brooks@example.com',  '(555) 010-1102', 'Buyer''s Agent',      '#0E9F9A', true),
    (v_agents[3], 'Priya Raman',    'priya.raman@example.com',    '(555) 010-1103', 'Listing Specialist',  '#C2770E', true),
    (v_agents[4], 'Marcus Reed',    'marcus.reed@example.com',    '(555) 010-1104', 'Sales Agent',         '#7C4DDB', true),
    (v_agents[5], 'Elena Vasquez',  'elena.vasquez@example.com',  '(555) 010-1105', 'Luxury Specialist',   '#D3457A', true)
  on conflict (id) do update set
    full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
    title = excluded.title, color = excluded.color, is_demo = true, is_active = true;

  for r in
    select * from (values
      -- first, last, source, type, interest, area, budget, status, agent, days_ago, follow_up_in_days
      ('Olivia',   'Bennett',   'website',      'single_family', '3 bed, fenced yard, near good schools',        'Maple Heights', 485000,  'new_lead',          0, 1,  1),
      ('James',    'Carter',    'zillow',       'condo',         'Downtown condo with parking and gym',          'Downtown',      320000,  'new_lead',          1, 2,  0),
      ('Sophia',   'Nguyen',    'website',      'townhouse',     'End-unit townhouse, 2+ car garage',            'Westbrook',     410000,  'new_lead',          0, 0,  null),
      ('Ethan',    'Morales',   'social_media', 'single_family', 'First home, open to light updates',            'Riverside',     365000,  'new_lead',          2, 3,  -1),
      ('Ava',      'Patel',     'referral',     'luxury',        'Waterfront home with dock access',             'Harbor Point',  1850000, 'new_lead',          5, 1,  1),
      ('Noah',     'Kim',       'realtor_com',  'rental',        '2BR rental for 12-month lease, pet friendly',  'Old Town',      2400,    'new_lead',          4, 4,  -2),
      ('Isabella', 'Russo',     'website',      'condo',         'Low-HOA condo close to the light rail',        'Lakeview',      295000,  'new_lead',          0, 2,  null),
      ('Liam',     'Foster',    'open_house',   'single_family', 'Saw 14 Elm Ct open house, wants similar',      'Pine Ridge',    540000,  'new_lead',          3, 5,  0),
      ('Mia',      'Hughes',    'zillow',       'townhouse',     'Townhouse with home office space',             'Westbrook',     435000,  'contacted',         1, 8,  2),
      ('Lucas',    'Ortiz',     'phone',        'multi_family',  'Duplex to live in one side and rent the other','Riverside',     610000,  'contacted',         4, 10, -1),
      ('Charlotte','Price',     'website',      'single_family', 'Single-story home for downsizing',             'Maple Heights', 455000,  'contacted',         2, 6,  1),
      ('Benjamin', 'Ward',      'referral',     'land',          'Half-acre lot to build a custom home',         'Pine Ridge',    180000,  'contacted',         3, 12, 3),
      ('Amelia',   'Coleman',   'social_media', 'condo',         'Top-floor condo with city views',              'Downtown',      375000,  'contacted',         1, 9,  0),
      ('Henry',    'Jenkins',   'walk_in',      'single_family', 'Relocating for work, needs to move by spring', 'Lakeview',      520000,  'contacted',         5, 7,  -3),
      ('Harper',   'Simmons',   'realtor_com',  'townhouse',     'Townhouse near the medical center',            'Old Town',      389000,  'contacted',         2, 11, 2),
      ('Alexander','Gray',      'website',      'luxury',        'Modern home with pool and guest suite',        'Harbor Point',  2250000, 'qualified',         5, 18, 1),
      ('Evelyn',   'Murphy',    'zillow',       'single_family', '4 bed, finished basement',                     'Maple Heights', 615000,  'qualified',         1, 21, -2),
      ('Daniel',   'Flores',    'referral',     'condo',         'Investment condo near the university',         'Downtown',      260000,  'qualified',         4, 16, 2),
      ('Abigail',  'Sanders',   'open_house',   'single_family', 'Craftsman-style home with porch',              'Old Town',      495000,  'qualified',         3, 25, 0),
      ('Michael',  'Perry',     'website',      'townhouse',     'Townhouse, walkable to shops and cafes',       'Westbrook',     445000,  'qualified',         2, 19, 4),
      ('Emily',    'Long',      'social_media', 'single_family', 'Starter home with garage',                     'Riverside',     340000,  'qualified',         1, 23, -1),
      ('Matthew',  'Powell',    'zillow',       'single_family', 'Corner lot, 3 bed / 2 bath',                   'Lakeview',      505000,  'viewing_scheduled', 3, 30, 1),
      ('Ella',     'Butler',    'website',      'condo',         'Condo with in-unit laundry',                   'Lakeview',      310000,  'viewing_scheduled', 4, 27, 2),
      ('Samuel',   'Barnes',    'referral',     'luxury',        'Gated estate, minimum 5 bedrooms',             'Harbor Point',  3100000, 'viewing_scheduled', 5, 35, 3),
      ('Grace',    'Ross',      'realtor_com',  'townhouse',     'Newer-construction townhouse',                 'Pine Ridge',    470000,  'viewing_scheduled', 2, 29, 0),
      ('David',    'Henderson', 'phone',        'multi_family',  'Fourplex with existing tenants',               'Riverside',     890000,  'viewing_scheduled', 1, 33, -1),
      ('Chloe',    'Fisher',    'website',      'single_family', 'Family home near the new elementary school',   'Maple Heights', 575000,  'negotiation',       1, 42, 1),
      ('Joseph',   'Graham',    'zillow',       'condo',         'Penthouse condo, two parking spaces',          'Downtown',      720000,  'negotiation',       5, 47, 0),
      ('Victoria', 'Wallace',   'open_house',   'single_family', 'Ranch home with large backyard',               'Pine Ridge',    530000,  'negotiation',       3, 39, 2),
      ('Andrew',   'Cole',      'referral',     'townhouse',     'Townhouse close to the commuter train',        'Westbrook',     425000,  'negotiation',       2, 44, -1),
      ('Scarlett', 'West',      'website',      'single_family', 'Updated kitchen, 3 bed',                       'Lakeview',      498000,  'won',               1, 64, null),
      ('Jack',     'Hayes',     'referral',     'luxury',        'Lake house with private beach',                'Harbor Point',  1675000, 'won',               5, 80, null),
      ('Lily',     'Myers',     'zillow',       'condo',         'Condo near the riverfront trail',              'Riverside',     289000,  'won',               4, 52, null),
      ('Owen',     'Ford',      'open_house',   'townhouse',     'Townhouse with rooftop deck',                  'Old Town',      465000,  'won',               3, 71, null),
      ('Zoe',      'Hamilton',  'social_media', 'single_family', 'Wanted 4 bed under $450k',                     'Maple Heights', 450000,  'lost',              2, 58, null),
      ('Wyatt',    'Graham',    'phone',        'land',          'Rural acreage for a small farm',               'Pine Ridge',    240000,  'lost',              4, 66, null)
    ) as t(first, last, source, ptype, interest, area, budget, status, agent, days_ago, follow_up)
  loop
    v_i := v_i + 1;
    v_created := date_trunc('hour', now()) - make_interval(days => r.days_ago, hours => (v_i * 7) % 11);

    v_path := case r.status
      when 'new_lead' then array['new_lead']
      when 'contacted' then array['new_lead', 'contacted']
      when 'qualified' then array['new_lead', 'contacted', 'qualified']
      when 'viewing_scheduled' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled']
      when 'negotiation' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled', 'negotiation']
      when 'won' then array['new_lead', 'contacted', 'qualified', 'viewing_scheduled', 'negotiation', 'won']
      else array['new_lead', 'contacted', 'qualified', 'lost']
    end::public.lead_status[];

    -- Each pipeline step happens a few days after the previous one.
    v_step_at := v_created + make_interval(days => greatest(array_length(v_path, 1) - 1, 0) * greatest(r.days_ago / 6, 1));
    if v_step_at > now() then v_step_at := now() - interval '2 hours'; end if;

    insert into public.leads (
      full_name, email, phone, source, property_type, property_interest, preferred_area,
      budget, status, lost_reason, assigned_agent_id, next_follow_up_at, position,
      status_changed_at, won_at, closed_at, is_demo, created_at, updated_at
    ) values (
      r.first || ' ' || r.last,
      lower(r.first || '.' || r.last) || '@example.com',
      '(555) 01' || lpad(((v_i % 10))::text, 1, '0') || '-' || lpad((2000 + v_i)::text, 4, '0'),
      r.source::public.lead_source,
      r.ptype::public.property_type,
      r.interest,
      r.area,
      r.budget,
      r.status::public.lead_status,
      case when r.status = 'lost' then
        case when v_i % 2 = 0 then 'Bought with another brokerage' else 'Paused search — financing fell through' end
      end,
      case when r.agent = 0 then null else v_agents[r.agent] end,
      case when r.follow_up is null then null
           else date_trunc('hour', now()) + make_interval(days => r.follow_up, hours => 10) end,
      v_i,
      v_step_at,
      case when r.status = 'won' then v_step_at end,
      case when r.status in ('won', 'lost') then v_step_at end,
      true,
      v_created,
      v_step_at
    ) returning id into v_lead_id;

    -- History: created → assigned → each status step.
    insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
    values (v_lead_id, case when r.source = 'website' then 'Website form' else 'Demo data' end,
            'lead_created', jsonb_build_object('source', r.source, 'status', 'new_lead'), true, v_created);

    if r.agent <> 0 then
      insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'assigned', jsonb_build_object('to_agent_id', v_agents[r.agent]), true,
              v_created + interval '25 minutes');
    end if;

    for v_j in 2 .. coalesce(array_length(v_path, 1), 1) loop
      insert into public.activities (lead_id, actor_label, type, details, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'status_changed',
              jsonb_build_object('from', v_path[v_j - 1], 'to', v_path[v_j]), true,
              v_created + (v_step_at - v_created) * ((v_j - 1)::numeric / greatest(array_length(v_path, 1) - 1, 1)));
    end loop;

    -- One or two internal notes per lead.
    insert into public.lead_notes (lead_id, author_label, body, is_demo, created_at)
    values (v_lead_id, 'Demo data',
      case r.status
        when 'new_lead' then 'Inquiry received. Prefers text messages before 6 pm.'
        when 'contacted' then 'Intro call done. Wants to see 3–4 options before committing to tours.'
        when 'qualified' then 'Pre-approval letter received. Flexible on closing date.'
        when 'viewing_scheduled' then 'Tour route planned; bring comps for the neighborhood.'
        when 'negotiation' then 'Seller countered. Client willing to move on price if inspection is clean.'
        when 'won' then 'Closed. Send a thank-you gift and ask for a review in 30 days.'
        else 'Closed lost. Keep in the quarterly market-update list.'
      end, true, v_created + interval '1 hour');

    if v_i % 3 = 0 then
      insert into public.lead_notes (lead_id, author_label, body, is_demo, created_at)
      values (v_lead_id, 'Demo data', 'Spouse joins all tours; schedule on weekends when possible.', true,
              v_created + interval '2 days');
    end if;

    -- Follow-up tasks: open leads get an upcoming or overdue task; closed
    -- leads keep their completed history.
    if r.status not in ('won', 'lost') then
      insert into public.tasks (lead_id, title, assigned_agent_id, priority, due_at, is_demo, created_at)
      values (v_lead_id,
        case r.status
          when 'new_lead' then 'Call ' || r.first || ' to introduce Northstar'
          when 'contacted' then 'Send ' || r.first || ' matching listings'
          when 'qualified' then 'Confirm financing details with ' || r.first
          when 'viewing_scheduled' then 'Prepare tour packet for ' || r.first
          else 'Review counteroffer with ' || r.first
        end,
        case when r.agent = 0 then null else v_agents[r.agent] end,
        (case when r.status in ('negotiation', 'viewing_scheduled') then 'high' when v_i % 4 = 0 then 'low' else 'normal' end)::public.task_priority,
        date_trunc('hour', now()) + make_interval(days => (v_i % 7) - 2, hours => 9 + (v_i % 6)),
        true, v_created + interval '30 minutes');
    end if;

    if r.status <> 'new_lead' then
      insert into public.tasks (lead_id, title, assigned_agent_id, priority, due_at, completed_at, is_demo, created_at)
      values (v_lead_id, 'Discovery call with ' || r.first,
        case when r.agent = 0 then null else v_agents[r.agent] end, 'normal',
        v_created + interval '1 day', v_created + interval '20 hours', true, v_created + interval '1 hour');
    end if;

    v_count := v_count + 1;
  end loop;

  -- A few team tasks not tied to a lead.
  insert into public.tasks (title, description, assigned_agent_id, priority, due_at, completed_at, is_demo) values
    ('Update Harbor Point market report', 'Refresh comps for the monthly luxury newsletter.', v_agents[5], 'normal', now() + interval '3 days', null, true),
    ('Plan Saturday open house at 22 Birch Ln', 'Signage, sign-in sheet and refreshments.', v_agents[3], 'high', now() + interval '1 day', null, true),
    ('Renew MLS photo package', null, v_agents[1], 'low', now() - interval '2 days', null, true),
    ('Team pipeline review', 'Weekly 30-minute review of stalled deals.', v_agents[2], 'normal', now() - interval '5 days', now() - interval '5 days', true);

  perform set_config('leadpilot.seeding', 'off', true);
  return v_count;
end;
$$;

-- Admin-only: wipe and recreate demo rows. Real data is never touched because
-- every delete is filtered on is_demo = true, and auth users/profiles are not
-- part of the demo set at all.
create or replace function public.reset_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_leads integer;
  v_seeded integer;
begin
  if not (public.is_privileged_caller()) then
    raise exception 'Only admins can reset demo data' using errcode = '42501';
  end if;

  perform set_config('leadpilot.seeding', 'on', true);

  delete from public.events where is_demo;
  delete from public.tasks where is_demo;
  delete from public.activities where is_demo;
  delete from public.lead_notes where is_demo;
  with d as (delete from public.leads where is_demo returning 1)
  select count(*) into v_deleted_leads from d;

  v_seeded := public.seed_demo_data();

  return jsonb_build_object('deleted_leads', v_deleted_leads, 'seeded_leads', v_seeded);
end;
$$;

revoke execute on function public.seed_demo_data() from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon;
grant execute on function public.reset_demo_data() to authenticated, service_role;

-- Load the demo set once when the migration runs.
select public.seed_demo_data();
