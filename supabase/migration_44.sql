-- migration_44.sql — v47
-- 1. Cutting: reject with a reason and send back to the cutting master, resend, delete
-- 2. Dispatch approval (Production Manager, then General Manager) after quality approval;
--    Shipped -> Completed (delivered to customer)
-- 3. QC role (quality team member)
-- 4. Per-user module access granted by the Admin
-- Run after migration_43.sql. Safe to run twice.

-- ============================================================ 3. QC role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance','qc'));

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'role_invitations'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%intended_role%' loop
    execute format('alter table role_invitations drop constraint %I', c.conname);
  end loop;
end $$;
alter table role_invitations add constraint role_invitations_intended_role_check
  check (intended_role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance','qc'));

-- QC team members can run inspections just like the Quality Manager
create or replace function is_quality_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('quality_manager','qc'));
$$ language sql security definer stable;

-- ============================================================ 1. Cutting
alter table cutting_entries add column if not exists reject_reason text;
alter table cutting_entries add column if not exists resend_count int not null default 0;

-- Reject (from pending OR approved) with a reason; the cutting master sees it and can resend.
-- The existing on_cutting_rejected trigger puts the fabric back in stock.
create or replace function reject_cutting(p_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; v_name text;
begin
  if not is_gm_pm_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Production Manager, General Manager or Admin can reject cutting');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return json_build_object('ok', false, 'error', 'Write the reason so the cutting master knows what to fix');
  end if;
  select * into e from cutting_entries where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  if e.status = 'Rejected' then return json_build_object('ok', false, 'error', 'Already rejected'); end if;
  if exists (select 1 from jsonb_each_text(coalesce(e.completed_sizes, '{}'::jsonb)) x where coalesce(nullif(x.value, '')::numeric, 0) > 0) then
    return json_build_object('ok', false, 'error', 'Stitching has already been logged against this cutting entry, so it cannot be rejected');
  end if;
  select name into v_name from profiles where id = auth.uid();
  update cutting_entries
     set status = 'Rejected', reject_reason = trim(p_reason), reviewed_by = v_name, reviewed_at = now()
   where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function reject_cutting(uuid, text) to authenticated;

-- Cutting master corrects a rejected entry and sends it back for approval.
create or replace function resubmit_cutting(
  p_id uuid, p_cut_date date, p_sizes jsonb, p_fabric_id uuid, p_kg numeric, p_meters numeric
) returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; f inventory_fabric%rowtype; v_name text;
begin
  if not (is_cutting_or_admin() or is_gm_pm_or_admin()) then
    return json_build_object('ok', false, 'error', 'Not allowed to resend cutting');
  end if;
  select * into e from cutting_entries where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  if e.status <> 'Rejected' then return json_build_object('ok', false, 'error', 'Only a rejected entry can be resent'); end if;
  if p_fabric_id is null then return json_build_object('ok', false, 'error', 'Select the fabric used'); end if;
  if coalesce(p_kg,0) <= 0 and coalesce(p_meters,0) <= 0 then
    return json_build_object('ok', false, 'error', 'Enter the fabric used (kg or meters)');
  end if;
  if p_sizes is null or p_sizes = '{}'::jsonb then
    return json_build_object('ok', false, 'error', 'Enter the cut quantity for at least one size');
  end if;
  select * into f from inventory_fabric where id = p_fabric_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Fabric not found in inventory'); end if;
  if coalesce(p_kg,0) > coalesce(f.stock_kg,0) then
    return json_build_object('ok', false, 'error', 'Only ' || coalesce(f.stock_kg,0) || ' kg available for this fabric');
  end if;
  if coalesce(p_meters,0) > coalesce(f.stock_meters,0) then
    return json_build_object('ok', false, 'error', 'Only ' || coalesce(f.stock_meters,0) || ' m available for this fabric');
  end if;
  select name into v_name from profiles where id = auth.uid();

  update inventory_fabric
     set stock_kg = coalesce(stock_kg,0) - coalesce(p_kg,0),
         stock_meters = coalesce(stock_meters,0) - coalesce(p_meters,0)
   where id = p_fabric_id;
  insert into fabric_usage (fabric_id, order_id, cutting_entry_id, kg_used, meters_used, used_by)
  values (p_fabric_id, e.order_id, e.id, coalesce(p_kg,0), coalesce(p_meters,0), v_name);

  update cutting_entries
     set status = 'Submitted', cut_date = coalesce(p_cut_date, cut_date), sizes = p_sizes,
         fabric_id = p_fabric_id, fabric_kg_used = coalesce(p_kg,0), fabric_meters_used = coalesce(p_meters,0),
         completed_sizes = '{}'::jsonb, reviewed_by = null, reviewed_at = null,
         resend_count = resend_count + 1
   where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function resubmit_cutting(uuid, date, jsonb, uuid, numeric, numeric) to authenticated;

-- Delete a cutting entry. Fabric that is still deducted goes back into stock first.
-- Admin / HR / GM / PM can delete any entry; a cutting master only their own entry that has not been approved.
create or replace function delete_cutting_entry(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; v_name text;
begin
  select * into e from cutting_entries where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  select name into v_name from profiles where id = auth.uid();
  if not (is_gm_pm_or_admin()
          or (my_role() = 'cutting_master' and e.status in ('Submitted','Rejected') and e.submitted_by is not distinct from v_name)) then
    return json_build_object('ok', false, 'error', 'You cannot delete this cutting entry');
  end if;
  update inventory_fabric f
     set stock_kg = coalesce(f.stock_kg,0) + u.kg_used,
         stock_meters = coalesce(f.stock_meters,0) + u.meters_used
    from fabric_usage u
   where u.cutting_entry_id = p_id and u.restored = false and f.id = u.fabric_id;
  delete from cutting_entries where id = p_id;   -- fabric_usage rows cascade
  return json_build_object('ok', true);
end $$;
grant execute on function delete_cutting_entry(uuid) to authenticated;

-- ============================================================ 2. Dispatch approval
alter table orders add column if not exists dispatch_status text not null default 'Not requested';
alter table orders drop constraint if exists orders_dispatch_status_check;
alter table orders add constraint orders_dispatch_status_check
  check (dispatch_status in ('Not requested','Pending PM','Pending GM','Approved','Rejected'));
alter table orders add column if not exists dispatch_pm_by text;
alter table orders add column if not exists dispatch_pm_at timestamptz;
alter table orders add column if not exists dispatch_gm_by text;
alter table orders add column if not exists dispatch_gm_at timestamptz;
alter table orders add column if not exists dispatch_note text;

-- Orders that already shipped / were completed / already have deliveries are treated as approved.
update orders set dispatch_status = 'Approved'
 where dispatch_status = 'Not requested'
   and (status in ('Shipped','Completed') or exists (select 1 from order_deliveries d where d.order_id = orders.id));
-- Orders already passed by quality but not yet dispatched now wait for the PM.
update orders set dispatch_status = 'Pending PM'
 where dispatch_status = 'Not requested' and quality_status = 'Approved';

-- Quality approval opens the dispatch approval; losing quality approval closes it.
create or replace function sync_dispatch_on_quality()
returns trigger language plpgsql as $$
begin
  if new.quality_status = 'Approved' and old.quality_status is distinct from 'Approved'
     and new.dispatch_status in ('Not requested','Rejected') then
    new.dispatch_status := 'Pending PM';
    new.dispatch_pm_by := null; new.dispatch_pm_at := null;
    new.dispatch_gm_by := null; new.dispatch_gm_at := null;
    new.dispatch_note := null;
  elsif new.quality_status <> 'Approved' and new.status not in ('Shipped','Completed')
        and new.dispatch_status in ('Pending PM','Pending GM','Approved') then
    new.dispatch_status := 'Not requested';
  end if;
  return new;
end $$;
drop trigger if exists orders_sync_dispatch on orders;
create trigger orders_sync_dispatch before update of quality_status on orders
  for each row execute procedure sync_dispatch_on_quality();

-- PM approves first, then GM. Admin can act at either step. A rejection sends the order back to quality.
create or replace function approve_dispatch(p_order_id uuid, p_decision text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; r text; v_name text;
begin
  r := my_role();
  if r not in ('pm','gm','admin') then
    return json_build_object('ok', false, 'error', 'Only the Production Manager and General Manager approve dispatch');
  end if;
  if p_decision not in ('Approved','Rejected') then return json_build_object('ok', false, 'error', 'Invalid decision'); end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.quality_status <> 'Approved' then return json_build_object('ok', false, 'error', 'The order has not passed quality inspection'); end if;
  select name into v_name from profiles where id = auth.uid();

  if o.dispatch_status = 'Pending PM' then
    if r not in ('pm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the Production Manager to approve first'); end if;
  elsif o.dispatch_status = 'Pending GM' then
    if r not in ('gm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the General Manager'); end if;
  else
    return json_build_object('ok', false, 'error', 'This order is not waiting for dispatch approval');
  end if;

  if p_decision = 'Rejected' then
    if coalesce(trim(p_note), '') = '' then return json_build_object('ok', false, 'error', 'Write the reason for rejecting'); end if;
    update orders set dispatch_status = 'Rejected', dispatch_note = trim(p_note),
           quality_status = 'Not inspected', quality_approved_at = null, quality_approved_by = null
     where id = p_order_id;
  elsif o.dispatch_status = 'Pending PM' then
    update orders set dispatch_status = 'Pending GM', dispatch_pm_by = v_name, dispatch_pm_at = now(), dispatch_note = null
     where id = p_order_id;
  else
    update orders set dispatch_status = 'Approved', dispatch_gm_by = v_name, dispatch_gm_at = now(), dispatch_note = null
     where id = p_order_id;
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function approve_dispatch(uuid, text, text) to authenticated;

-- Gates: Shipped needs quality + dispatch approval; Completed (delivered) is only reachable from Shipped.
create or replace function block_ship_without_quality()
returns trigger language plpgsql as $$
begin
  if new.status = 'Shipped' and old.status is distinct from 'Shipped' then
    if new.quality_status <> 'Approved' then
      raise exception 'Quality approval is required before this order can be shipped';
    end if;
    if new.dispatch_status <> 'Approved' then
      raise exception 'Dispatch approval (Production Manager, then General Manager) is required before this order can be shipped';
    end if;
  end if;
  if new.status = 'Completed' and old.status is distinct from 'Completed' and old.status <> 'Shipped' then
    raise exception 'The order must be Shipped before it can be marked Completed (delivered to the customer)';
  end if;
  return new;
end $$;

create or replace function block_delivery_without_quality()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from orders where id = new.order_id and quality_status = 'Approved') then
    raise exception 'Quality approval is required before goods are dispatched for this order';
  end if;
  if not exists (select 1 from orders where id = new.order_id and dispatch_status = 'Approved') then
    raise exception 'Dispatch approval (Production Manager, then General Manager) is required before goods are dispatched';
  end if;
  return new;
end $$;

-- ============================================================ 4. Module access granted by the Admin
create table if not exists user_module_access (
  user_id uuid primary key references profiles(id) on delete cascade,
  modules text[] not null default '{}',
  updated_by text,
  updated_at timestamptz default now()
);
alter table user_module_access enable row level security;
drop policy if exists "uma_select" on user_module_access;
drop policy if exists "uma_admin_write" on user_module_access;
-- everyone reads their own row; the Admin reads all
create policy "uma_select" on user_module_access for select
  using (user_id = auth.uid() or my_role() = 'admin');
-- only the Admin (not HR) writes
create policy "uma_admin_write" on user_module_access for all
  using (my_role() = 'admin') with check (my_role() = 'admin');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_module_access') then
    alter publication supabase_realtime add table user_module_access;
  end if;
end $$;
