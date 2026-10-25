-- v59: employee roles & departments, the Cutting login role, names taken from the employee's role.
-- Run after migration_51.sql. Safe to re-run.

-- ============================================================ 1. Cutting login role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance','qc','ironing','sales_manager','cutting'));

create or replace function is_cutting_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('cutting_master','cutting','pm'));
$$ language sql security definer stable;

-- cutters correct / delete their own un-approved counts, like the cutting master
do $$
declare f text; def text;
begin
  foreach f in array array['delete_cutting_entry', 'resubmit_cutting'] loop
    for def in select pg_get_functiondef(p.oid) from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace loop
      if def like '%my_role() = ''cutting_master''%' then
        execute replace(def, 'my_role() = ''cutting_master''', 'my_role() in (''cutting_master'',''cutting'')');
      end if;
    end loop;
  end loop;
end $$;

-- ============================================================ 2. Sales access follows the new employee roles
create or replace function is_sales_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'sales_manager') or exists (
    select 1 from profiles p
    join employees e on e.id = p.employee_id
    where p.id = auth.uid() and e.role in ('Sales','Sales Executive','Sales Manager')
  );
$$ language sql security definer stable;

-- ============================================================ 3. Team Leads are the employees whose Role is Team Lead
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
  if p_tl is not null and not exists (select 1 from employees where id = p_tl and coalesce(status,'Active') <> 'Inactive' and role = 'Team Lead') and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
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

create or replace function assign_team_lead(p_id uuid, p_tl uuid)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can assign a Team Lead'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.tl_status = 'Completed' then return json_build_object('ok', false, 'error', 'This work is already completed'); end if;
  if p_tl is not null and not exists (select 1 from employees where id = p_tl and coalesce(status,'Active') <> 'Inactive' and role = 'Team Lead') and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
    return json_build_object('ok', false, 'error', 'Choose a Team Lead');
  end if;
  update order_assignments set tl_employee_id = p_tl, tl_status = case when p_tl is null then 'Not assigned' else 'Assigned' end,
    tl_assigned_by = case when p_tl is null then null else asg_who() end, tl_assigned_at = case when p_tl is null then null else now() end,
    tl_accepted_at = null, tl_started_at = null where id = p_id;
  perform asg_log(p_id, 'Team Lead', case when p_tl is null then 'Team Lead removed' else 'Assigned to ' || (select name from employees where id = p_tl) end);
  return json_build_object('ok', true);
end $$;

-- ============================================================ 4. Day report: operators by department / role
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
    select x.id, x.name, case when x.department in ('Production','Ironing & Packing','Cutting') or x.role in ('Production','Ironing','Operator','Team Lead','Cutter','Cutting Master') then 'operators' else 'staff' end as grp,
           (a.status in ('Present','Half Day')) as present
      from employees x left join attendance a on a.employee_id = x.id and a.date = d
     where coalesce(x.status,'Active') <> 'Inactive' and x.role not in ('Sales','Sales Executive','Sales Manager') and coalesce(x.department,'') <> 'Sales'
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
           coalesce((select ao.output from assignment_outputs(d) ao where ao.assignment_id = a.id), 0) as output
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

-- ============================================================ 5. Move existing employees to the new roles and departments
-- (1) people who already have a login take the matching role
update employees e set role = case p.role
    when 'gm' then 'General Manager' when 'pm' then 'Production Manager' when 'tl' then 'Team Lead'
    when 'cutting_master' then 'Cutting Master' when 'cutting' then 'Cutter' when 'sales_manager' then 'Sales Manager'
    when 'quality_manager' then 'Quality Manager' when 'qc' then 'Quality Executive' when 'ironing' then 'Ironing' when 'hr' then 'HR Manager' end
  from profiles p
 where p.employee_id = e.id
   and p.role in ('gm','pm','tl','cutting_master','cutting','sales_manager','quality_manager','qc','ironing','hr')
   and e.role in ('Production','Manager','Admin','Ironing','Sales');
-- (2) the old generic roles
update employees set role = 'Operator' where role = 'Production';
update employees set role = 'Sales Executive' where role = 'Sales';
-- (3) departments that are not one of the standard ones
update employees set department = case role
    when 'General Manager' then 'Management' when 'Production Manager' then 'Management' when 'Manager' then 'Management' when 'Admin' then 'Management'
    when 'Team Lead' then 'Production' when 'Operator' then 'Production' when 'Quality Manager' then 'Production' when 'Quality Executive' then 'Production'
    when 'Cutting Master' then 'Cutting' when 'Cutter' then 'Cutting' when 'Sales Manager' then 'Sales' when 'Sales Executive' then 'Sales'
    when 'HR Manager' then 'HR' when 'HR Executive' then 'HR' when 'Accountant' then 'Finance' when 'Ironing' then 'Ironing & Packing'
    else department end
 where department is null or department not in ('Production','Ironing & Packing','Cutting','Sales','Management','Staff','Information Technology','Finance','HR');
