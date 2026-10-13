-- Migration 30 — run in Supabase SQL Editor AFTER migration_29.sql
--
--  1. Production Manager (PM) gets full write access to the Orders module
--  2. Fabric usage at cutting time, deducted from Inventory -> Fabric
--  3. Admin-only "delete user account"
--  4. Approved leave is marked as "Leave" in Attendance
--  5. Machine spare parts / purchase details
--  6. Purchase requests (GM + Admin approval -> becomes an order expenditure)

-- ---------- 1. PM full access to Orders ----------
create or replace function is_pm_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'pm');
$$ language sql security definer stable;

drop policy if exists "orders_admin_write" on orders;
drop policy if exists "orders_admin_update" on orders;
drop policy if exists "orders_admin_delete" on orders;
create policy "orders_admin_write"  on orders for insert with check (is_pm_or_admin());
create policy "orders_admin_update" on orders for update using (is_pm_or_admin());
create policy "orders_admin_delete" on orders for delete using (is_pm_or_admin());

drop policy if exists "order_progress_admin_write" on order_progress;
drop policy if exists "order_progress_admin_update" on order_progress;
drop policy if exists "order_progress_admin_delete" on order_progress;
create policy "order_progress_admin_write"  on order_progress for insert with check (is_pm_or_admin());
create policy "order_progress_admin_update" on order_progress for update using (is_pm_or_admin());
create policy "order_progress_admin_delete" on order_progress for delete using (is_pm_or_admin());

drop policy if exists "order_deliveries_admin_write" on order_deliveries;
drop policy if exists "order_deliveries_admin_update" on order_deliveries;
drop policy if exists "order_deliveries_admin_delete" on order_deliveries;
create policy "order_deliveries_admin_write"  on order_deliveries for insert with check (is_pm_or_admin());
create policy "order_deliveries_admin_update" on order_deliveries for update using (is_pm_or_admin());
create policy "order_deliveries_admin_delete" on order_deliveries for delete using (is_pm_or_admin());

drop policy if exists "order_agreements_admin_only" on order_agreements;
create policy "order_agreements_admin_only" on order_agreements for all using (is_pm_or_admin()) with check (is_pm_or_admin());

-- ---------- 2. Fabric usage ----------
alter table cutting_entries add column if not exists fabric_id uuid references inventory_fabric(id) on delete set null;
alter table cutting_entries add column if not exists fabric_kg_used numeric default 0;
alter table cutting_entries add column if not exists fabric_meters_used numeric default 0;

create table if not exists fabric_usage (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid references inventory_fabric(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  cutting_entry_id uuid references cutting_entries(id) on delete cascade,
  kg_used numeric default 0,
  meters_used numeric default 0,
  used_by text,
  restored boolean default false,
  created_at timestamptz default now()
);
alter table fabric_usage enable row level security;
drop policy if exists "fabric_usage_select" on fabric_usage;
create policy "fabric_usage_select" on fabric_usage for select using (auth.role() = 'authenticated');

-- Cutting master can't edit inventory directly, so the deduction runs inside
-- this function. It refuses the cutting entry if the stock isn't there.
create or replace function submit_cutting(
  p_order_id uuid, p_item text, p_cut_date date, p_sizes jsonb,
  p_fabric_id uuid, p_kg numeric, p_meters numeric, p_submitted_by text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fabric inventory_fabric%rowtype;
  v_id uuid;
begin
  if not (is_cutting_or_admin() or is_gm_pm_or_admin()) then
    raise exception 'Not allowed to log cutting';
  end if;
  if p_fabric_id is null then
    raise exception 'Select the fabric used before logging cutting';
  end if;
  if coalesce(p_kg,0) <= 0 and coalesce(p_meters,0) <= 0 then
    raise exception 'Enter the fabric used (kg or meters)';
  end if;

  select * into v_fabric from inventory_fabric where id = p_fabric_id for update;
  if not found then raise exception 'Fabric not found in inventory'; end if;
  if coalesce(p_kg,0) > coalesce(v_fabric.stock_kg,0) then
    raise exception 'Only % kg available for this fabric', coalesce(v_fabric.stock_kg,0);
  end if;
  if coalesce(p_meters,0) > coalesce(v_fabric.stock_meters,0) then
    raise exception 'Only % m available for this fabric', coalesce(v_fabric.stock_meters,0);
  end if;

  insert into cutting_entries (order_id, item_description, cut_date, sizes, submitted_by, fabric_id, fabric_kg_used, fabric_meters_used)
  values (p_order_id, p_item, p_cut_date, p_sizes, p_submitted_by, p_fabric_id, coalesce(p_kg,0), coalesce(p_meters,0))
  returning id into v_id;

  update inventory_fabric
  set stock_kg = coalesce(stock_kg,0) - coalesce(p_kg,0),
      stock_meters = coalesce(stock_meters,0) - coalesce(p_meters,0)
  where id = p_fabric_id;

  insert into fabric_usage (fabric_id, order_id, cutting_entry_id, kg_used, meters_used, used_by)
  values (p_fabric_id, p_order_id, v_id, coalesce(p_kg,0), coalesce(p_meters,0), p_submitted_by);

  return v_id;
end;
$$;
grant execute on function submit_cutting(uuid, text, date, jsonb, uuid, numeric, numeric, text) to authenticated;

-- If a cutting entry is rejected, its fabric goes back into stock.
create or replace function restore_fabric_on_reject()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Rejected' and old.status is distinct from 'Rejected' then
    update inventory_fabric f
    set stock_kg = coalesce(f.stock_kg,0) + u.kg_used,
        stock_meters = coalesce(f.stock_meters,0) + u.meters_used
    from fabric_usage u
    where u.cutting_entry_id = new.id and u.restored = false and f.id = u.fabric_id;
    update fabric_usage set restored = true where cutting_entry_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_cutting_rejected on cutting_entries;
create trigger on_cutting_rejected after update on cutting_entries
  for each row execute procedure restore_fabric_on_reject();

-- ---------- 3. Delete user account (Admin only, not HR) ----------
create or replace function delete_user_account(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    return json_build_object('ok', false, 'error', 'Only an Admin can delete accounts');
  end if;
  if p_user_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot delete your own account');
  end if;
  delete from auth.users where id = p_user_id;   -- profiles row cascades
  return json_build_object('ok', true);
end;
$$;
grant execute on function delete_user_account(uuid) to authenticated;

-- ---------- 4. Approved leave -> Attendance "Leave" ----------
create or replace function sync_leave_to_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    insert into attendance (employee_id, date, status)
    select new.employee_id, d::date, 'Leave'
    from generate_series(new.start_date, new.end_date, interval '1 day') d
    on conflict (employee_id, date) do update set status = 'Leave'
      where attendance.check_in is null;      -- never overwrite a real punch
  elsif old.status = 'Approved' and new.status is distinct from 'Approved' then
    delete from attendance
    where employee_id = new.employee_id and date between new.start_date and new.end_date
      and status = 'Leave' and check_in is null;
  end if;
  return new;
end;
$$;
drop trigger if exists on_leave_status_change on leave_requests;
create trigger on_leave_status_change after update on leave_requests
  for each row execute procedure sync_leave_to_attendance();

-- Back-fill leave that was already approved
insert into attendance (employee_id, date, status)
select l.employee_id, d::date, 'Leave'
from leave_requests l, generate_series(l.start_date, l.end_date, interval '1 day') d
where l.status = 'Approved'
on conflict (employee_id, date) do nothing;

-- ---------- 5. Machine spare parts ----------
create table if not exists inventory_spare_parts (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid references inventory_machines(id) on delete cascade,
  part_name text not null,
  quantity numeric not null default 1,
  status text not null default 'Needed' check (status in ('Needed','Ordered','Purchased')),
  supplier text,
  amount numeric,
  purchase_date date,
  notes text,
  created_at timestamptz default now()
);
alter table inventory_spare_parts enable row level security;
drop policy if exists "inv_parts_select" on inventory_spare_parts;
drop policy if exists "inv_parts_write" on inventory_spare_parts;
create policy "inv_parts_select" on inventory_spare_parts for select using (auth.role() = 'authenticated');
create policy "inv_parts_write" on inventory_spare_parts for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());

-- ---------- 6. Purchase requests ----------
create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Fabric','Machine','Spare Parts','Accessories','Other')),
  item text not null,
  quantity numeric default 1,
  unit text,
  amount numeric not null default 0,
  vendor text,
  order_id uuid references orders(id) on delete set null,
  investor_id uuid references investors(id) on delete set null,
  notes text,
  requested_by uuid references profiles(id) on delete set null,
  requested_by_name text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  gm_approved_by text, gm_approved_at timestamptz,
  admin_approved_by text, admin_approved_at timestamptz,
  rejected_by text, reject_reason text,
  expenditure_id uuid references expenditures(id) on delete set null,
  created_at timestamptz default now()
);
alter table purchase_requests enable row level security;
drop policy if exists "pr_select" on purchase_requests;
drop policy if exists "pr_insert" on purchase_requests;
drop policy if exists "pr_delete" on purchase_requests;
create policy "pr_select" on purchase_requests for select using (is_gm_pm_or_admin());
create policy "pr_insert" on purchase_requests for insert with check (is_gm_pm_or_admin() and requested_by = auth.uid());
create policy "pr_delete" on purchase_requests for delete using (
  is_admin() or (requested_by = auth.uid() and status = 'Pending'));

-- Approval: GM approves once, and any one Admin/HR approves once. When both
-- are in, the request becomes Approved and is added to Expenditures against
-- the chosen order, funded by the chosen investor.
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
    update purchase_requests set gm_approved_by = v_name, gm_approved_at = now() where id = p_id;
  elsif v_role in ('admin','hr') then
    update purchase_requests set admin_approved_by = v_name, admin_approved_at = now() where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Only the General Manager or an Admin can approve');
  end if;

  select * into r from purchase_requests where id = p_id;
  if r.gm_approved_at is not null and r.admin_approved_at is not null then
    v_cat := case r.category when 'Machine' then 'Machinery' when 'Spare Parts' then 'Maintenance'
                             when 'Fabric' then 'Raw Material' when 'Accessories' then 'Raw Material' else 'Other' end;
    insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, investor_id)
    values (v_cat,
            r.category || ' — ' || r.item || case when r.quantity is not null then ' (' || r.quantity || coalesce(' ' || r.unit, '') || ')' else '' end,
            r.vendor, r.amount, (now() at time zone 'Asia/Kolkata')::date,
            coalesce(r.notes,'') || ' [Purchase request approved by ' || r.gm_approved_by || ' & ' || r.admin_approved_by || ']',
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
  if v_role not in ('gm','admin','hr') then
    return json_build_object('ok', false, 'error', 'Only the General Manager or an Admin can reject');
  end if;
  update purchase_requests set status = 'Rejected', rejected_by = v_name, reject_reason = p_reason
  where id = p_id and status = 'Pending';
  return json_build_object('ok', true);
end;
$$;
grant execute on function reject_purchase_request(uuid, text) to authenticated;

-- Investors table is admin-only, so GM/PM get just names through this.
create or replace function investor_names()
returns table (id uuid, name text) language sql security definer set search_path = public stable as $$
  select i.id, i.name from investors i
  where is_gm_pm_or_admin() order by i.name;
$$;
grant execute on function investor_names() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['purchase_requests','inventory_spare_parts','fabric_usage'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
