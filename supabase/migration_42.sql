-- v38: lead -> order -> agreement -> Won flow, purchase approval chain (GM -> Finance -> Admin),
--      best performer of the day, and the "DELETE requires a WHERE clause" fix. Run after migration_41.sql. Safe to re-run.

-- ============ 1. Fix: Supabase blocks DELETE without WHERE (hit when linking an order to a salesperson) ============
create or replace function refresh_commissions_for(p_sp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s commission_settings%rowtype;
begin
  if p_sp is null then return; end if;
  select * into s from commission_settings where id = 1;

  create temp table if not exists _comm_elig (order_id uuid, period_key text, val numeric, order_number text, customer_name text) on commit drop;
  delete from _comm_elig where true;
  insert into _comm_elig
  select o.id, commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period),
         commission_order_value(o.id, os.order_value), o.order_number, o.customer_name
  from order_sales os join orders o on o.id = os.order_id
  where os.salesperson_id = p_sp
    and (s.basis = 'confirmed' or o.status in ('Completed','Shipped'));

  -- pending rows that no longer qualify
  delete from sales_commissions c
   where c.salesperson_id = p_sp and c.status = 'Pending'
     and (c.order_id is null or not exists (
            select 1 from _comm_elig e
             where e.order_id = c.order_id and e.val > 0
               and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold));

  insert into sales_commissions (order_id, salesperson_id, period_key, order_number, customer_name, order_value, rate_pct, amount)
  select e.order_id, p_sp, e.period_key, e.order_number, e.customer_name, e.val, s.rate_pct, round(e.val * s.rate_pct / 100, 2)
    from _comm_elig e
   where e.val > 0 and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold
  on conflict (order_id) do update
     set period_key = excluded.period_key, order_number = excluded.order_number, customer_name = excluded.customer_name,
         order_value = excluded.order_value, rate_pct = excluded.rate_pct, amount = excluded.amount
   where sales_commissions.status = 'Pending' and sales_commissions.salesperson_id = p_sp;
end $$;

-- ============ 2. Lead -> Order -> Agreement -> Won ============
alter table sales_leads drop constraint if exists sales_leads_status_check;
alter table sales_leads add constraint sales_leads_status_check
  check (status in ('New','Contacted','Interested','Quotation Sent','Order Created','Won','Lost'));

-- the order created from a lead stays linked to it until the customer agrees
alter table orders add column if not exists lead_id uuid references sales_leads(id) on delete set null;
alter table orders add column if not exists sales_order_value numeric;
create index if not exists orders_lead_idx on orders (lead_id);

-- an activity must not pull an 'Order Created' lead back to an earlier stage
create or replace function lead_activity_roll_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_leads l set
    last_activity_at = now(),
    next_followup_date = case when new.kind = 'Note' then l.next_followup_date else new.next_followup_date end,
    quotation_value = coalesce(new.quotation_value, l.quotation_value),
    expected_order_date = coalesce(new.expected_order_date, l.expected_order_date),
    first_visit_date = coalesce(l.first_visit_date, case when new.kind = 'Visit' then new.activity_date end),
    status = case
      when l.status in ('Won','Lost','Order Created') then l.status
      when new.kind = 'Quotation' or new.quotation_value is not null then 'Quotation Sent'
      when l.status = 'New' and new.kind <> 'Note' then 'Contacted'
      else l.status end
  where l.id = new.lead_id;
  return null;
end $$;

-- next number in the Orders module sequence (same rule the Orders screen uses)
create or replace function next_order_number() returns text
language plpgsql stable security definer set search_path = public as $$
declare n int; onum text;
begin
  select count(*) + 1 into n from orders;
  loop
    onum := 'ORD-' || lpad(n::text, 4, '0');
    exit when not exists (select 1 from orders where order_number = onum);
    n := n + 1;
  end loop;
  return onum;
end $$;
grant execute on function next_order_number() to authenticated;

-- Convert: creates the order in Orders (Production Management), linked to the lead. The lead moves to
-- 'Order Created'. It becomes Won, and the order appears in Sales Orders, only when the customer agrees.
create or replace function convert_lead_to_order(p_lead uuid, p_items jsonb, p_order_value numeric, p_due_date date, p_order_number text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; oid uuid; onum text; today date := (now() at time zone 'Asia/Kolkata')::date; who text;
begin
  select * into l from sales_leads where id = p_lead for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Lead not found.'); end if;
  if not (is_sales_manager() or l.salesperson_id = my_employee_id()) then
    return jsonb_build_object('ok', false, 'error', 'You can only convert your own leads.');
  end if;
  if l.status = 'Lost' then return jsonb_build_object('ok', false, 'error', 'This lead is marked Lost. Re-open it first.'); end if;
  if l.status not in ('Interested','Quotation Sent','Order Created','Won') then
    return jsonb_build_object('ok', false, 'error', 'Move the lead to Interested before converting it to an order.');
  end if;
  if l.salesperson_id is null then return jsonb_build_object('ok', false, 'error', 'Assign a salesperson to the lead first, so the order and commission are linked to someone.'); end if;
  if coalesce(p_order_value, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter the order value.'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Add at least one item to the order.');
  end if;

  if p_order_number is not null and length(trim(p_order_number)) > 0 then
    onum := trim(p_order_number);
    if exists (select 1 from orders where order_number = onum) then return jsonb_build_object('ok', false, 'error', 'Order number ' || onum || ' already exists.'); end if;
  else
    onum := next_order_number();
  end if;

  insert into orders (order_number, customer_name, items, order_date, due_date, status, lead_id, sales_order_value)
  values (onum, l.company_name, p_items, today, p_due_date, 'Not Started', l.id, p_order_value)
  returning id into oid;

  if l.status <> 'Won' then
    update sales_leads set status = 'Order Created', lost_reason = null, next_followup_date = null where id = l.id;
  end if;
  select name into who from profiles where id = auth.uid();
  insert into lead_activities (lead_id, kind, activity_date, notes, quotation_value, logged_by)
  values (l.id, 'Note', today, 'Order ' || onum || ' created in Orders for ' || p_order_value::text || '. Waiting for the customer to agree.', null, who);
  return jsonb_build_object('ok', true, 'order_id', oid, 'order_number', onum);
end $$;
grant execute on function convert_lead_to_order(uuid, jsonb, numeric, date, text) to authenticated;

-- Open the agreement for the customer (also usable by the lead's salesperson, who cannot edit Orders directly)
create or replace function send_order_agreement(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Order not found.'); end if;
  if not (is_pm_or_admin() or my_role() = 'gm' or is_sales_manager()
          or exists (select 1 from sales_leads l where l.id = o.lead_id and l.salesperson_id = my_employee_id())) then
    return jsonb_build_object('ok', false, 'error', 'Not allowed.');
  end if;
  update orders set agreement_status = 'Sent', agreement_sent_at = now(), agreement_responded_at = null,
         agreement_responder = null, agreement_comment = null where id = p_order;
  return jsonb_build_object('ok', true, 'tracking_code', o.tracking_code);
end $$;
grant execute on function send_order_agreement(uuid) to authenticated;

-- Customer answer -> lead status. Agreed: customer is created, the order is added to Sales Orders
-- (commission starts counting) and the lead is Won. Disagreed: noted on the lead, which stays 'Order Created'.
create or replace function trg_order_agreement_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; cid uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.lead_id is null or new.agreement_status is not distinct from old.agreement_status then return null; end if;
  select * into l from sales_leads where id = new.lead_id for update;
  if not found then return null; end if;

  if new.agreement_status = 'Agreed' then
    cid := l.customer_id;
    if cid is null then
      insert into sales_customers (name, location, contact_person, contact_number, notes, created_by)
      values (l.company_name, l.address, l.contact_person, l.phone, 'From lead ' || l.lead_number, l.created_by)
      returning id into cid;
    end if;
    insert into order_sales (order_id, lead_id, customer_id, salesperson_id, order_value)
    values (new.id, l.id, cid, l.salesperson_id, coalesce(new.sales_order_value, 0))
    on conflict (order_id) do nothing;
    update sales_leads set status = 'Won', customer_id = cid, lost_reason = null, next_followup_date = null where id = l.id;
    insert into lead_activities (lead_id, kind, activity_date, notes, logged_by)
    values (l.id, 'Note', today, 'Customer agreed to order ' || new.order_number || '. Lead won; order added to Sales Orders.', coalesce(new.agreement_responder, 'Customer'));
  elsif new.agreement_status = 'Disagreed' then
    insert into lead_activities (lead_id, kind, activity_date, notes, logged_by)
    values (l.id, 'Note', today, 'Customer did not agree to order ' || new.order_number || coalesce(': ' || new.agreement_comment, '.'), coalesce(new.agreement_responder, 'Customer'));
  end if;
  return null;
end $$;
drop trigger if exists orders_agreement_lead on orders;
create trigger orders_agreement_lead after update of agreement_status on orders
  for each row execute function trg_order_agreement_lead();

-- ============ 3. Purchase requests: GM -> Finance -> Admin ============
alter table purchase_requests add column if not exists finance_approved_by text;
alter table purchase_requests add column if not exists finance_approved_at timestamptz;
-- requests already fully or admin-approved before this change count as Finance-approved
update purchase_requests set finance_approved_by = coalesce(admin_approved_by, 'earlier approval'), finance_approved_at = admin_approved_at
 where admin_approved_at is not null and finance_approved_at is null;

drop policy if exists "pr_select" on purchase_requests;
create policy "pr_select" on purchase_requests for select using (is_gm_pm_or_admin() or my_role() = 'finance');

create or replace function approve_purchase_request(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; r purchase_requests%rowtype; v_exp uuid; v_cat text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Pending' then return json_build_object('ok', false, 'error', 'Request is already ' || r.status); end if;

  if v_role = 'gm' then
    if r.gm_approved_at is not null then return json_build_object('ok', false, 'error', 'The General Manager has already approved'); end if;
    update purchase_requests set gm_approved_by = v_name, gm_approved_at = now() where id = p_id;
  elsif v_role = 'finance' then
    if r.gm_approved_at is null then return json_build_object('ok', false, 'error', 'The General Manager must approve first'); end if;
    if r.finance_approved_at is not null then return json_build_object('ok', false, 'error', 'Finance has already approved'); end if;
    update purchase_requests set finance_approved_by = v_name, finance_approved_at = now() where id = p_id;
  elsif v_role in ('admin','hr') then
    if r.finance_approved_at is null then return json_build_object('ok', false, 'error', 'Finance must approve before the Admin'); end if;
    if r.admin_approved_at is not null then return json_build_object('ok', false, 'error', 'The Admin has already approved'); end if;
    update purchase_requests set admin_approved_by = v_name, admin_approved_at = now() where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Only the General Manager, Finance or an Admin can approve');
  end if;

  select * into r from purchase_requests where id = p_id;
  if r.gm_approved_at is not null and r.finance_approved_at is not null and r.admin_approved_at is not null then
    v_cat := case r.category when 'Machine' then 'Machinery' when 'Spare Parts' then 'Maintenance'
                             when 'Fabric' then 'Raw Material' when 'Accessories' then 'Raw Material' else 'Other' end;
    insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, investor_id)
    values (v_cat,
            r.category || ' — ' || r.item || case when r.quantity is not null then ' (' || r.quantity || coalesce(' ' || r.unit, '') || ')' else '' end,
            r.vendor, r.amount, (now() at time zone 'Asia/Kolkata')::date,
            coalesce(r.notes,'') || ' [Purchase request approved by ' || r.gm_approved_by || ', ' || r.finance_approved_by || ' & ' || r.admin_approved_by || ']',
            r.order_id, r.investor_id)
    returning id into v_exp;
    update purchase_requests set status = 'Approved', expenditure_id = v_exp where id = p_id;
  end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function approve_purchase_request(uuid) to authenticated;

create or replace function reject_purchase_request(p_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  if v_role not in ('gm','finance','admin','hr') then
    return json_build_object('ok', false, 'error', 'Only the General Manager, Finance or an Admin can reject');
  end if;
  update purchase_requests set status = 'Rejected', rejected_by = v_name, reject_reason = p_reason
  where id = p_id and status = 'Pending';
  return json_build_object('ok', true);
end;
$$;
grant execute on function reject_purchase_request(uuid, text) to authenticated;

-- ============ 4. Best performer of the day (floor display) ============
-- Top operators by pieces logged in Production -> Output for the day. Callable by anyone signed in,
-- because the floor display is open to every role.
create or replace function best_performer_today(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.pieces desc, x.name) from (
      select e.name, sum(o.quantity) as pieces, count(distinct o.operation) as operations
        from operation_output o join employees e on e.id = o.employee_id
       where o.work_date = d and o.quantity > 0
       group by e.id, e.name
       order by sum(o.quantity) desc, e.name limit 3) x
  ), '[]'::jsonb);
end $$;
grant execute on function best_performer_today(date) to authenticated;
