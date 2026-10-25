-- v56: Order assignment (GM -> Production Manager -> Team Lead), today's production plan,
-- and the day-end report (generated at 6 PM IST or on demand by Admin / GM / Production Manager).
-- Run after migration_48.sql. Safe to re-run.

-- ============================================================ 1. Order assignments
create table if not exists order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_description text,                         -- null = the whole order
  work_date date not null,
  priority text not null default 'Normal' check (priority in ('Top','High','Normal','Low')),
  target_qty numeric not null default 0,
  instructions text,
  assigned_by text,
  assigned_by_role text,
  created_at timestamptz default now(),
  -- Production Manager step (assignments made by the GM wait here until the PM accepts)
  pm_status text not null default 'Accepted' check (pm_status in ('Pending PM','Accepted')),
  pm_by text, pm_at timestamptz,
  -- Team Lead step
  tl_employee_id uuid references employees(id) on delete set null,
  tl_status text not null default 'Not assigned' check (tl_status in ('Not assigned','Assigned','Accepted','In progress','Completed','Declined')),
  tl_assigned_by text, tl_assigned_at timestamptz,
  tl_accepted_at timestamptz, tl_started_at timestamptz, tl_completed_at timestamptz,
  completed_qty numeric,
  tl_note text
);
create index if not exists order_assignments_date_idx on order_assignments (work_date);
create index if not exists order_assignments_tl_idx on order_assignments (tl_employee_id);

create table if not exists assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references order_assignments(id) on delete cascade,
  at timestamptz default now(),
  by_name text,
  kind text not null,
  detail text
);
create index if not exists assignment_events_idx on assignment_events (assignment_id, at);

alter table order_assignments enable row level security;
alter table assignment_events enable row level security;
drop policy if exists "order_assignments_select" on order_assignments;
create policy "order_assignments_select" on order_assignments for select using (auth.role() = 'authenticated');
drop policy if exists "assignment_events_select" on assignment_events;
create policy "assignment_events_select" on assignment_events for select using (auth.role() = 'authenticated');
-- no write policies: everything goes through the functions below
do $$ begin alter publication supabase_realtime add table order_assignments; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table assignment_events; exception when others then null; end $$;

create or replace function asg_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from profiles where id = auth.uid()), 'System')
$$;
create or replace function asg_log(p_id uuid, p_kind text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into assignment_events (assignment_id, by_name, kind, detail) values (p_id, asg_who(), p_kind, p_detail)
$$;
create or replace function asg_manager() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','hr','gm','pm'), false)
$$;
create or replace function asg_pm_or_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','hr','pm'), false)
$$;

-- Create an assignment. GM-made assignments wait for the Production Manager to accept.
create or replace function create_assignment(
  p_order_id uuid, p_item text, p_date date, p_priority text default 'Normal',
  p_target numeric default 0, p_instructions text default null, p_tl uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_id uuid; v_item text := nullif(trim(coalesce(p_item,'')), ''); v_role text := my_role(); v_pm text;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can assign work'); end if;
  select * into o from orders where id = p_order_id;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status in ('Shipped','Completed','Rejected by Customer') then return json_build_object('ok', false, 'error', 'This order is already shipped or completed'); end if;
  if p_date is null then return json_build_object('ok', false, 'error', 'Choose the work date'); end if;
  if coalesce(p_priority,'Normal') not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if v_item is not null and not exists (select 1 from jsonb_array_elements(o.items) x where x->>'description' = v_item) then
    return json_build_object('ok', false, 'error', format('"%s" is not an item of this order', v_item));
  end if;
  if coalesce(p_target,0) < 0 or coalesce(p_target,0) <> floor(coalesce(p_target,0)) then return json_build_object('ok', false, 'error', 'Target must be a whole number'); end if;
  if p_tl is not null and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
    return json_build_object('ok', false, 'error', 'Choose a Team Lead');
  end if;
  v_pm := case when v_role = 'gm' then 'Pending PM' else 'Accepted' end;
  insert into order_assignments (order_id, item_description, work_date, priority, target_qty, instructions, assigned_by, assigned_by_role,
                                 pm_status, pm_by, pm_at, tl_employee_id, tl_status, tl_assigned_by, tl_assigned_at)
  values (p_order_id, v_item, p_date, coalesce(p_priority,'Normal'), coalesce(p_target,0), nullif(trim(coalesce(p_instructions,'')),''), asg_who(), v_role,
          v_pm, case when v_pm = 'Accepted' then asg_who() end, case when v_pm = 'Accepted' then now() end,
          p_tl, case when p_tl is null then 'Not assigned' else 'Assigned' end, case when p_tl is null then null else asg_who() end, case when p_tl is null then null else now() end)
  returning id into v_id;
  perform asg_log(v_id, 'Created', format('%s priority for %s%s%s', coalesce(p_priority,'Normal'), p_date, case when v_item is null then '' else ' — ' || v_item end,
                  case when v_pm = 'Pending PM' then ' (waiting for the Production Manager)' else '' end));
  if p_tl is not null then perform asg_log(v_id, 'Team Lead', 'Assigned to ' || (select name from employees where id = p_tl)); end if;
  return json_build_object('ok', true, 'id', v_id, 'pm_status', v_pm);
end $$;

-- Change priority / date / target / notes. After the PM has accepted, a priority or date change needs a reason.
create or replace function update_assignment(
  p_id uuid, p_priority text default null, p_date date default null, p_target numeric default null,
  p_instructions text default null, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; chg text := ''; v_role text := my_role(); pc boolean; dc boolean;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can change an assignment'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.tl_status = 'Completed' then return json_build_object('ok', false, 'error', 'This work is already completed'); end if;
  if p_priority is not null and p_priority not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if p_target is not null and (p_target < 0 or p_target <> floor(p_target)) then return json_build_object('ok', false, 'error', 'Target must be a whole number'); end if;
  pc := p_priority is not null and p_priority <> a.priority;
  dc := p_date is not null and p_date <> a.work_date;
  if (pc or dc) and a.pm_status = 'Accepted' and length(trim(coalesce(p_reason,''))) < 3 then
    return json_build_object('ok', false, 'error', 'Write the reason for changing the priority or date');
  end if;
  if pc then chg := chg || format('priority %s → %s; ', a.priority, p_priority); end if;
  if dc then chg := chg || format('date %s → %s; ', a.work_date, p_date); end if;
  if p_target is not null and p_target <> a.target_qty then chg := chg || format('target %s → %s; ', a.target_qty, p_target); end if;
  update order_assignments set
    priority = coalesce(p_priority, priority),
    work_date = coalesce(p_date, work_date),
    target_qty = coalesce(p_target, target_qty),
    instructions = case when p_instructions is null then instructions else nullif(trim(p_instructions),'') end,
    -- a GM change on a PM-accepted plan goes back to the PM; a date change asks the Team Lead to accept again
    pm_status = case when v_role = 'gm' and (pc or dc) and pm_status = 'Accepted' then 'Pending PM' else pm_status end,
    tl_status = case when dc and tl_status in ('Accepted','In progress') then 'Assigned' else tl_status end
  where id = p_id;
  if chg <> '' or p_instructions is not null then
    perform asg_log(p_id, case when pc or dc then 'Changed' else 'Edited' end, trim(chg) || case when length(trim(coalesce(p_reason,''))) > 0 then ' Reason: ' || trim(p_reason) else '' end);
  end if;
  return json_build_object('ok', true);
end $$;

-- The Production Manager accepts what the GM assigned, optionally changing priority / date.
create or replace function pm_accept_assignment(p_id uuid, p_priority text default null, p_date date default null, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; chg text := '';
begin
  if not asg_pm_or_admin() then return json_build_object('ok', false, 'error', 'Only the Production Manager can accept this'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.pm_status = 'Accepted' then return json_build_object('ok', false, 'error', 'Already accepted'); end if;
  if p_priority is not null and p_priority not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if (p_priority is not null and p_priority <> a.priority) or (p_date is not null and p_date <> a.work_date) then
    if length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for changing the priority or date'); end if;
    if p_priority is not null and p_priority <> a.priority then chg := chg || format('priority %s → %s; ', a.priority, p_priority); end if;
    if p_date is not null and p_date <> a.work_date then chg := chg || format('date %s → %s; ', a.work_date, p_date); end if;
  end if;
  update order_assignments set priority = coalesce(p_priority, priority), work_date = coalesce(p_date, work_date),
    pm_status = 'Accepted', pm_by = asg_who(), pm_at = now() where id = p_id;
  perform asg_log(p_id, 'PM accepted', trim(chg) || case when chg <> '' then ' Reason: ' || trim(p_reason) else '' end);
  return json_build_object('ok', true);
end $$;

-- Choose (or clear) the Team Lead.
create or replace function assign_team_lead(p_id uuid, p_tl uuid)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can assign a Team Lead'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.tl_status = 'Completed' then return json_build_object('ok', false, 'error', 'This work is already completed'); end if;
  if p_tl is not null and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
    return json_build_object('ok', false, 'error', 'Choose a Team Lead');
  end if;
  update order_assignments set tl_employee_id = p_tl, tl_status = case when p_tl is null then 'Not assigned' else 'Assigned' end,
    tl_assigned_by = case when p_tl is null then null else asg_who() end, tl_assigned_at = case when p_tl is null then null else now() end,
    tl_accepted_at = null, tl_started_at = null where id = p_id;
  perform asg_log(p_id, 'Team Lead', case when p_tl is null then 'Team Lead removed' else 'Assigned to ' || (select name from employees where id = p_tl) end);
  return json_build_object('ok', true);
end $$;

-- The Team Lead's own actions: accept, decline, start, complete.
create or replace function tl_update_assignment(p_id uuid, p_action text, p_qty numeric default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; mine boolean;
begin
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  mine := a.tl_employee_id is not null and a.tl_employee_id = my_employee_id();
  if not (mine or asg_pm_or_admin()) then return json_build_object('ok', false, 'error', 'This work is not assigned to you'); end if;
  if a.pm_status <> 'Accepted' then return json_build_object('ok', false, 'error', 'Waiting for the Production Manager to accept this plan'); end if;
  if p_action = 'accept' then
    if a.tl_status <> 'Assigned' then return json_build_object('ok', false, 'error', 'Nothing to accept'); end if;
    update order_assignments set tl_status = 'Accepted', tl_accepted_at = now() where id = p_id;
    perform asg_log(p_id, 'TL accepted', null);
  elsif p_action = 'decline' then
    if a.tl_status not in ('Assigned','Accepted') then return json_build_object('ok', false, 'error', 'Cannot decline now'); end if;
    if length(trim(coalesce(p_note,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason'); end if;
    update order_assignments set tl_status = 'Declined', tl_note = trim(p_note) where id = p_id;
    perform asg_log(p_id, 'TL declined', trim(p_note));
  elsif p_action = 'start' then
    if a.tl_status <> 'Accepted' then return json_build_object('ok', false, 'error', 'Accept the work first'); end if;
    update order_assignments set tl_status = 'In progress', tl_started_at = now() where id = p_id;
    perform asg_log(p_id, 'Started', null);
  elsif p_action = 'complete' then
    if a.tl_status not in ('Accepted','In progress') then return json_build_object('ok', false, 'error', 'Accept the work first'); end if;
    if p_qty is not null and (p_qty < 0 or p_qty <> floor(p_qty)) then return json_build_object('ok', false, 'error', 'Pieces must be a whole number'); end if;
    update order_assignments set tl_status = 'Completed', tl_completed_at = now(), completed_qty = p_qty,
      tl_note = coalesce(nullif(trim(coalesce(p_note,'')),''), tl_note) where id = p_id;
    perform asg_log(p_id, 'Completed', coalesce(p_qty::text || ' pcs. ', '') || coalesce(trim(p_note), ''));
  else
    return json_build_object('ok', false, 'error', 'Unknown action');
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function delete_assignment(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can remove an assignment'); end if;
  if exists (select 1 from order_assignments where id = p_id and tl_status in ('In progress','Completed')) then
    return json_build_object('ok', false, 'error', 'Work that has started cannot be removed');
  end if;
  delete from order_assignments where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ============================================================ 2. Day-end report
create table if not exists day_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  data jsonb not null default '{}',
  generated_by text,
  generated_at timestamptz default now(),
  auto boolean not null default false
);
alter table day_reports enable row level security;
drop policy if exists "day_reports_select" on day_reports;
create policy "day_reports_select" on day_reports for select using (auth.role() = 'authenticated');
do $$ begin alter publication supabase_realtime add table day_reports; exception when others then null; end $$;

-- Builds the day's report from attendance, hourly progress, assignments, approved/submitted cutting and sales activity.
-- Admin / HR / GM / PM can run it; the 6 PM schedule runs it with no user (auth.uid() is null).
create or replace function generate_day_report(p_date date default null, p_auto boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
        att jsonb; teams jsonb; unplanned jsonb; byitem jsonb; cut jsonb; sales jsonb; res jsonb; total_out numeric; v_id uuid;
begin
  if auth.uid() is not null and not asg_manager() then
    return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can generate the day report');
  end if;

  -- attendance: operators = employees with role Production; staff = everyone else except Sales
  with e as (
    select x.id, x.name, case when x.role = 'Production' then 'operators' else 'staff' end as grp,
           (a.status in ('Present','Half Day')) as present
      from employees x left join attendance a on a.employee_id = x.id and a.date = d
     where coalesce(x.status,'Active') <> 'Inactive' and x.role <> 'Sales'
  )
  select jsonb_build_object(
    'operators', jsonb_build_object('total', count(*) filter (where grp='operators'), 'present', count(*) filter (where grp='operators' and present),
                  'absent', coalesce(jsonb_agg(name order by name) filter (where grp='operators' and not coalesce(present,false)), '[]')),
    'staff', jsonb_build_object('total', count(*) filter (where grp='staff'), 'present', count(*) filter (where grp='staff' and present),
                  'absent', coalesce(jsonb_agg(name order by name) filter (where grp='staff' and not coalesce(present,false)), '[]')))
  into att from e;

  select coalesce(sum(quantity),0) into total_out from order_progress where date = d;

  select coalesce(jsonb_agg(jsonb_build_object('team_lead', t.tl, 'order_number', t.order_number, 'customer_name', t.customer_name, 'item', t.item,
           'priority', t.priority, 'status', t.tl_status, 'target', t.target_qty, 'output', t.output) order by t.tl nulls last, t.order_number), '[]')
  into teams from (
    select e.name as tl, o.order_number, o.customer_name, a.item_description as item, a.priority, a.tl_status, a.target_qty,
           (select coalesce(sum(p.quantity),0) from order_progress p where p.order_id = a.order_id and p.date = d
               and (a.item_description is null or p.item_description = a.item_description)) as output
      from order_assignments a join orders o on o.id = a.order_id left join employees e on e.id = a.tl_employee_id
     where a.work_date = d and a.pm_status = 'Accepted') t;

  -- output on orders that were not in the day's plan
  select coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'item', p.item_description, 'output', p.q) order by o.order_number), '[]')
  into unplanned from (select order_id, item_description, sum(quantity) q from order_progress where date = d group by 1,2 having sum(quantity) > 0) p
  join orders o on o.id = p.order_id
  where not exists (select 1 from order_assignments a where a.order_id = p.order_id and a.work_date = d and a.pm_status = 'Accepted'
                      and (a.item_description is null or a.item_description = p.item_description));

  select coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'item', p.item_description, 'output', p.q) order by o.order_number, p.item_description), '[]')
  into byitem from (select order_id, item_description, sum(quantity) q from order_progress where date = d group by 1,2 having sum(quantity) > 0) p
  join orders o on o.id = p.order_id;

  select coalesce(jsonb_agg(jsonb_build_object('by', c.submitted_by, 'order_number', o.order_number, 'customer_name', o.customer_name, 'item', c.item_description,
           'sizes', c.sizes, 'kg', coalesce(c.fabric_kg_used,0), 'meters', coalesce(c.fabric_meters_used,0), 'status', c.status) order by c.created_at), '[]')
  into cut from cutting_entries c left join orders o on o.id = c.order_id where c.cut_date = d and c.status <> 'Rejected';

  select jsonb_build_object(
    'activities', coalesce((select jsonb_agg(jsonb_build_object('kind', la.kind, 'company', sl.company_name, 'location', la.location, 'contact', la.contact_person,
                   'by', la.logged_by, 'response', la.customer_response, 'next', la.next_followup_date) order by la.created_at)
                   from lead_activities la join sales_leads sl on sl.id = la.lead_id where la.activity_date = d), '[]'),
    'new_leads', coalesce((select jsonb_agg(jsonb_build_object('company', sl.company_name, 'type', sl.lead_type, 'by', e.name, 'status', sl.status) order by sl.created_at)
                   from sales_leads sl left join employees e on e.id = sl.salesperson_id
                  where (sl.created_at at time zone 'Asia/Kolkata')::date = d), '[]'),
    'customer_visits', coalesce((select jsonb_agg(jsonb_build_object('customer', c.name, 'by', v.logged_by, 'notes', v.notes) order by v.created_at)
                   from customer_visits v join sales_customers c on c.id = v.customer_id where v.visit_date = d), '[]'),
    'followups_due', (select count(*) from sales_leads where next_followup_date = d))
  into sales;

  res := jsonb_build_object('date', d, 'attendance', att, 'teams', teams, 'unplanned', unplanned, 'by_item', byitem,
                            'total_output', total_out, 'cutting', cut, 'sales', sales);
  insert into day_reports (report_date, data, generated_by, generated_at, auto)
  values (d, res, case when auth.uid() is null then 'Auto (6 PM)' else asg_who() end, now(), p_auto and auth.uid() is null)
  on conflict (report_date) do update set data = excluded.data, generated_by = excluded.generated_by, generated_at = now(), auto = excluded.auto
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- Ask Supabase to run it every day at 6 PM IST (12:30 UTC). Needs the pg_cron extension (Database -> Extensions).
-- If it is not available the app still creates the report the first time Admin / GM / PM opens the dashboard after 6 PM.
do $$
begin
  create extension if not exists pg_cron;
  begin perform cron.unschedule('tp-day-report'); exception when others then null; end;
  perform cron.schedule('tp-day-report', '30 12 * * *', 'select generate_day_report(null, true)');
exception when others then
  raise notice 'pg_cron is not available - the 6 PM report will be created from the app instead (%).', sqlerrm;
end $$;
