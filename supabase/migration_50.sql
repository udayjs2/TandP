-- v57: output is credited to the right Team Lead; Ironing role.
-- Run after migration_49.sql. Safe to re-run.

-- ============================================================ 1. Ironing login role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance','qc','ironing'));

-- ============================================================ 2. Who gets the pieces?
-- For every hourly-progress line of a day:
--   1. Assignments of that order for that day (accepted by the PM) compete; one for the exact item beats one for the whole order.
--   2. If several Team Leads hold the same level, the line goes to the Team Lead who logged it (updated_by = their name);
--   3. otherwise it is shared by team size - people who worked that order that day (Manpower) and report to each Team Lead (employees.reporting_manager_id);
--   4. with no team information it is shared equally.
-- Assignments with no Team Lead only receive pieces that no Team Lead covers.
create or replace function assignment_outputs(p_from date, p_to date default null)
returns table (assignment_id uuid, output numeric)
language plpgsql stable security definer set search_path = public as $$
declare p record; ids uuid[]; w numeric[]; m numeric[]; tot numeric; i int; n int; share numeric; got numeric; spec int; tl_mode int;
        c record; res jsonb := '{}'; hc numeric; hit boolean;
begin
  for p in
    select order_id, date as d, item_description as item, coalesce(updated_by, '') as ub, sum(quantity) as q
      from order_progress where date between p_from and coalesce(p_to, p_from)
     group by 1, 2, 3, 4 having sum(quantity) <> 0
  loop
    ids := '{}';
    foreach tl_mode in array array[1,0] loop            -- 1 = assignments that have a Team Lead, 0 = those that do not
      foreach spec in array array[2,1] loop             -- exact item first, then the whole order
        ids := '{}';
        for c in select a.id from order_assignments a
                  where a.order_id = p.order_id and a.work_date = p.d and a.pm_status = 'Accepted' and a.tl_status <> 'Declined'
                    and ((tl_mode = 1 and a.tl_employee_id is not null) or (tl_mode = 0 and a.tl_employee_id is null))
                    and ((spec = 2 and a.item_description = p.item) or (spec = 1 and a.item_description is null))
                  order by a.created_at, a.id
        loop ids := ids || c.id; end loop;
        exit when coalesce(array_length(ids, 1), 0) > 0;
      end loop;
      exit when coalesce(array_length(ids, 1), 0) > 0;
    end loop;
    n := coalesce(array_length(ids, 1), 0);
    if n = 0 then continue; end if;

    w := array_fill(1::numeric, array[n]);
    if n > 1 then
      -- the Team Lead who logged the line
      m := array_fill(0::numeric, array[n]); hit := false;
      for i in 1..n loop
        if exists (select 1 from order_assignments a
                    left join employees e on e.id = a.tl_employee_id
                    left join profiles pr on pr.employee_id = a.tl_employee_id
                   where a.id = ids[i] and p.ub <> '' and (lower(e.name) = lower(p.ub) or lower(pr.name) = lower(p.ub))) then
          m[i] := 1; hit := true;
        end if;
      end loop;
      if hit then w := m;
      else
        -- team size
        m := array_fill(0::numeric, array[n]); tot := 0;
        for i in 1..n loop
          select count(distinct l.employee_id) into hc from order_labor l
           join order_assignments a on a.id = ids[i]
           where l.order_id = p.order_id and l.work_date = p.d and a.tl_employee_id is not null
             and (l.employee_id = a.tl_employee_id
                  or exists (select 1 from employees e where e.id = l.employee_id and e.reporting_manager_id = a.tl_employee_id));
          m[i] := coalesce(hc, 0); tot := tot + coalesce(hc, 0);
        end loop;
        if tot > 0 then w := m; end if;
      end if;
    end if;

    tot := 0; for i in 1..n loop tot := tot + w[i]; end loop;
    got := 0; for i in 1..n loop
      if w[i] > 0 then
        share := case when p.q = floor(p.q) then floor(p.q * w[i] / tot) else round(p.q * w[i] / tot, 2) end;
        got := got + share;
        res := jsonb_set(res, array[ids[i]::text], to_jsonb(coalesce((res ->> ids[i]::text)::numeric, 0) + share));
      end if;
    end loop;
    -- whatever is left after rounding goes to the first Team Lead with a share
    if p.q - got <> 0 then
      for i in 1..n loop
        if w[i] > 0 then
          res := jsonb_set(res, array[ids[i]::text], to_jsonb(coalesce((res ->> ids[i]::text)::numeric, 0) + (p.q - got)));
          exit;
        end if;
      end loop;
    end if;
  end loop;

  return query
    select a.id, coalesce((res ->> a.id::text)::numeric, 0)
      from order_assignments a
     where a.work_date between p_from and coalesce(p_to, p_from);
end $$;

-- ============================================================ 3. Day report uses the same rule (and counts Ironing as operators)
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
    select x.id, x.name, case when x.role in ('Production','Ironing') then 'operators' else 'staff' end as grp,
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

