-- migration_46.sql — v49 (offer-letter type, duplicate-expenditure review, alerts). Run after migration_45.sql. Safe to run twice.
alter table offer_letters add column if not exists letter_type text not null default 'staff';

-- ===== Duplicate expenditures: a Finance / Admin reviewer can mark an entry as genuine =====
alter table expenditures add column if not exists dup_cleared_at timestamptz;
alter table expenditures add column if not exists dup_cleared_by text;

-- If the fields that decide "duplicate" are edited afterwards, the entry must be reviewed again.
create or replace function reset_dup_review() returns trigger language plpgsql as $$
begin
  if (new.amount, new.expense_date, new.category, coalesce(new.vendor,''), coalesce(new.item,''))
     is distinct from (old.amount, old.expense_date, old.category, coalesce(old.vendor,''), coalesce(old.item,'')) then
    new.dup_cleared_at := null; new.dup_cleared_by := null;
  end if;
  return new;
end $$;
drop trigger if exists expenditures_reset_dup on expenditures;
create trigger expenditures_reset_dup before update on expenditures
  for each row execute procedure reset_dup_review();

-- ===== Alerts & escalations (Production Manager, General Manager, Admin) =====
alter table order_finance add column if not exists approved_estimate numeric default 0;   -- approved cost estimate for the order

create table if not exists alert_settings (
  id int primary key default 1 check (id = 1),
  defect_limit_pct numeric not null default 5,        -- approved defect limit (% of inspected pieces)
  cost_overrun_pct numeric not null default 0,        -- tolerance above the approved estimate
  target_shortfall_pct numeric not null default 20,   -- how far below the pro-rated daily target before alerting
  low_stock_qty numeric not null default 20,          -- accessories at or below this are "insufficient"
  escalate_after_hours numeric not null default 24,   -- an alert still open after this is shown as ESCALATED
  updated_by text,
  updated_at timestamptz default now()
);
insert into alert_settings (id) values (1) on conflict do nothing;
alter table alert_settings enable row level security;
drop policy if exists "alert_settings_select" on alert_settings;
drop policy if exists "alert_settings_admin_write" on alert_settings;
create policy "alert_settings_select" on alert_settings for select using (my_role() in ('admin','gm','pm'));
create policy "alert_settings_admin_write" on alert_settings for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Remembers when each alert first appeared so that old, unresolved ones can be escalated.
create table if not exists alert_state (
  key text primary key,
  kind text not null,
  severity text not null,
  message text not null,
  order_number text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table alert_state enable row level security;
drop policy if exists "alert_state_select" on alert_state;
create policy "alert_state_select" on alert_state for select using (my_role() in ('admin','gm','pm'));

-- Every alert is computed live from the current data, so it clears itself once the problem is fixed.
create or replace function factory_alerts() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s alert_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_clock numeric := extract(hour from (now() at time zone 'Asia/Kolkata')) + extract(minute from (now() at time zone 'Asia/Kolkata')) / 60.0;
  v_frac numeric;
  v_dow int := extract(dow from (now() at time zone 'Asia/Kolkata'));
  v_cur jsonb;
  v_need numeric; v_stock numeric; v_global numeric;
begin
  if coalesce(my_role(), '') not in ('admin','gm','pm') then return '[]'::jsonb; end if;
  select * into s from alert_settings where id = 1;
  v_frac := greatest(0, least(1, (v_clock - 9) / 9.0));   -- share of the 9:00-18:00 shift that has passed

  -- fabric needed for the next working day (daily target, else recent pace, capped at pieces left) vs stock
  select coalesce(sum(cp.k), 0) / nullif(coalesce(sum(cp.p), 0), 0) into v_global from (
    select sum(c.fabric_kg_used) k, sum((select coalesce(sum(x.value::numeric), 0) from jsonb_each_text(c.sizes) x)) p
    from cutting_entries c where c.status = 'Approved') cp;
  select coalesce(sum(least(plan, remaining) * coalesce(rate, v_global, 0)), 0) into v_need from (
    select
      greatest(o.qty - coalesce(pr.done, 0), 0) as remaining,
      case when coalesce(o.daily_target, 0) > 0 then o.daily_target
           when coalesce(pr.days14, 0) > 0 then pr.q14 / pr.days14 else 0 end as plan,
      (select sum(c.fabric_kg_used) / nullif(sum((select coalesce(sum(x.value::numeric), 0) from jsonb_each_text(c.sizes) x)), 0)
         from cutting_entries c where c.order_id = o.id and c.status = 'Approved') as rate
    from (select oo.*, (select coalesce(sum((i->>'quantity')::numeric), 0) from jsonb_array_elements(coalesce(oo.items, '[]'::jsonb)) i) qty
          from orders oo where oo.status not in ('Shipped','Completed')) o
    left join (select order_id, sum(quantity) done,
                      sum(quantity) filter (where date >= v_today - 13) q14,
                      count(distinct date) filter (where date >= v_today - 13 and quantity > 0) days14
               from order_progress group by order_id) pr on pr.order_id = o.id) t;
  select coalesce(sum(stock_kg), 0) into v_stock from inventory_fabric;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_cur from (
    with ord as (
      select o.id, o.order_number, o.customer_name, o.due_date, o.status, coalesce(o.daily_target, 0) target,
             (select coalesce(sum((i->>'quantity')::numeric), 0) from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) i) qty
      from orders o where o.status not in ('Shipped','Completed')),
    pr as (select order_id, sum(quantity) done,
                  sum(quantity) filter (where date = v_today) today_done,
                  sum(quantity) filter (where date >= v_today - 13) q14,
                  count(distinct date) filter (where date >= v_today - 13 and quantity > 0) days14
           from order_progress group by order_id),
    m as (select ord.*, coalesce(pr.done, 0) done, coalesce(pr.today_done, 0) today_done,
                 greatest(ord.qty - coalesce(pr.done, 0), 0) remaining,
                 case when ord.target > 0 then ord.target when coalesce(pr.days14, 0) > 0 then pr.q14 / pr.days14 else 0 end rate
          from ord left join pr on pr.order_id = ord.id)

    -- 1. delivery date at risk
    select 'delivery:' || id as key, 'delivery' as kind, 'critical' as severity, order_number,
           order_number || ' (' || coalesce(customer_name, '') || ') is ' || (v_today - due_date) || ' day(s) past its delivery date of ' || due_date || ' and is not shipped yet.' as message
    from m where due_date is not null and due_date < v_today
    union all
    select 'delivery:' || id, 'delivery', 'high', order_number,
           order_number || ' (' || coalesce(customer_name, '') || ') is likely to miss its delivery date ' || due_date || ': ' || round(remaining) || ' pcs left, '
           || case when rate > 0 then 'needs about ' || ceil(remaining / rate) || ' working day(s) at ' || round(rate) || ' pcs/day' else 'no production pace yet' end
           || ', ' || (due_date - v_today) || ' day(s) left.'
    from m where due_date is not null and due_date >= v_today and remaining > 0
      and ((rate > 0 and ceil(remaining / rate) > floor((due_date - v_today) * 6 / 7.0))
           or (rate = 0 and due_date - v_today <= 3 and status = 'Not Started'))

    -- 2. production below planned target (checked once half the shift has passed; not on Sundays)
    union all
    select 'target:' || id, 'target', 'high', order_number,
           order_number || ': ' || round(today_done) || ' pcs done today against a daily target of ' || round(target) || ' (about ' || round(target * v_frac) || ' expected by now).'
    from m where v_dow <> 0 and v_frac >= 0.5 and target > 0 and status in ('Cutting','Stitching','Finishing','Ironing')
      and today_done < target * v_frac * (1 - s.target_shortfall_pct / 100.0)

    -- 3a. fabric short for tomorrow's plan
    union all
    select 'fabric', 'material', 'high', null,
           'Fabric may be insufficient: the next working day needs about ' || round(v_need, 1) || ' kg but only ' || round(v_stock, 1) || ' kg is in stock (short by ' || round(v_need - v_stock, 1) || ' kg).'
    where v_need > v_stock and v_need > 0

    -- 3b. accessories at or below the limit
    union all
    select 'accessories', 'material', 'high', null,
           'Accessories running low (at or below ' || s.low_stock_qty || '): ' ||
           (select string_agg(name || ' (' || quantity || ' ' || coalesce(unit, 'pcs') || ')', ', ' order by quantity)
              from (select * from inventory_items where quantity <= s.low_stock_qty order by quantity limit 6) z) || '.'
    where exists (select 1 from inventory_items where quantity <= s.low_stock_qty)

    -- 4. quality defects above the approved limit (latest inspection that recorded a sample)
    union all
    select 'quality:' || o.id, 'quality', 'critical', o.order_number,
           o.order_number || ': defect rate ' || round(li.defective_qty / li.inspected_qty * 100, 1) || '% (' || li.defective_qty || ' of ' || li.inspected_qty
           || ' inspected) is above the approved limit of ' || s.defect_limit_pct || '%.'
    from ord o
    join lateral (select qi.inspected_qty, qi.defective_qty from quality_inspections qi
                  where qi.order_id = o.id and coalesce(qi.inspected_qty, 0) > 0
                  order by qi.created_at desc limit 1) li on true
    where li.defective_qty / li.inspected_qty * 100 > s.defect_limit_pct

    -- 5. machine breakdown while orders are in production
    union all
    select 'machines', 'machine',
           case when down * 5 >= total then 'critical' else 'high' end, null,
           'Machine breakdown: ' || down || ' of ' || total || ' machine(s) are not running (' || detail || '), while '
           || (select count(*) from ord where status in ('Cutting','Stitching','Finishing','Ironing')) || ' order(s) are in production.'
    from (select coalesce(sum(quantity) filter (where working_condition in ('Under repair','Not working')), 0) down,
                 coalesce(sum(quantity), 0) total,
                 string_agg(coalesce(nullif(model_other, ''), model) || ' ' || machine_type || ' ×' || quantity || ' ' || working_condition, '; ')
                   filter (where working_condition in ('Under repair','Not working')) detail
          from inventory_machines) mm
    where down > 0 and exists (select 1 from ord where status in ('Cutting','Stitching','Finishing','Ironing'))

    -- 6. actual cost above the approved estimate
    union all
    select 'cost:' || o.id, 'cost', 'critical', o.order_number,
           o.order_number || ': actual cost ₹' || round(c.actual) || ' is above the approved estimate of ₹' || round(f.approved_estimate)
           || ' (+' || round((c.actual - f.approved_estimate) / f.approved_estimate * 100, 1) || '%).'
    from ord o
    join order_finance f on f.order_id = o.id and coalesce(f.approved_estimate, 0) > 0
    cross join lateral (select coalesce((order_actual_cost_internal(o.id)->'totals'->>'total')::numeric, 0) actual) c
    where c.actual > f.approved_estimate * (1 + s.cost_overrun_pct / 100.0)
  ) a;

  -- remember / resolve
  insert into alert_state (key, kind, severity, message, order_number, first_seen_at, last_seen_at, resolved_at)
  select r.key, r.kind, r.severity, r.message, r.order_number, now(), now(), null
  from jsonb_to_recordset(v_cur) as r(key text, kind text, severity text, message text, order_number text)
  on conflict (key) do update
    set severity = excluded.severity, message = excluded.message, order_number = excluded.order_number, last_seen_at = now(),
        first_seen_at = case when alert_state.resolved_at is not null then now() else alert_state.first_seen_at end,
        resolved_at = null;
  update alert_state set resolved_at = now()
   where resolved_at is null and key not in (select r.key from jsonb_to_recordset(v_cur) as r(key text));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', st.key, 'kind', st.kind, 'severity', st.severity, 'message', st.message, 'order_number', st.order_number,
             'first_seen_at', st.first_seen_at,
             'age_hours', round(extract(epoch from (now() - st.first_seen_at)) / 3600.0, 1),
             'escalated', extract(epoch from (now() - st.first_seen_at)) / 3600.0 >= s.escalate_after_hours)
           order by case st.severity when 'critical' then 0 else 1 end, st.first_seen_at)
    from alert_state st
    where st.resolved_at is null and st.key in (select r.key from jsonb_to_recordset(v_cur) as r(key text))), '[]'::jsonb);
end $$;
grant execute on function factory_alerts() to authenticated;
