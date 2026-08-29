-- Migration 2 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: multiple line items per order, hourly production progress tracking,
-- linking a login account to an employee record (for staff payroll visibility).
-- Removes: order value/amount (orders no longer carry a price).

-- 1. Orders: switch to a jsonb items list + a daily target, drop the old single-item/amount fields
alter table orders add column if not exists items jsonb default '[]';
alter table orders add column if not exists daily_target numeric default 0;

-- best-effort: migrate any existing single-item orders into the new items array
update orders
set items = jsonb_build_array(jsonb_build_object('description', coalesce(item_description, 'Item'), 'quantity', coalesce(quantity, 0)))
where (items is null or items = '[]'::jsonb)
  and item_description is not null;

alter table orders drop column if exists amount;
alter table orders drop column if exists item_description;
alter table orders drop column if exists quantity;

-- 2. Hourly production progress log (one row per order + date + hour slot + item)
create table if not exists order_progress (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  date date not null,
  hour_slot text not null,
  item_description text not null,
  quantity numeric not null default 0,
  updated_by text,
  created_at timestamptz default now(),
  unique (order_id, date, hour_slot, item_description)
);

alter table order_progress enable row level security;
create policy "order_progress_select" on order_progress for select using (auth.role() = 'authenticated');
create policy "order_progress_admin_write" on order_progress for insert with check (is_admin());
create policy "order_progress_admin_update" on order_progress for update using (is_admin());
create policy "order_progress_admin_delete" on order_progress for delete using (is_admin());

alter publication supabase_realtime add table order_progress;

-- 3. Link a login account (profile) to an employee record, so staff can see
--    only their own payroll/leave info. Admins set this from the Payroll tab.
alter table profiles add column if not exists employee_id uuid references employees(id) on delete set null;

-- Security: prevent a non-admin from promoting their own role or re-linking
-- their own employee_id, even though they're allowed to update their own row.
create or replace function protect_profile_privileged_fields()
returns trigger as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change account roles';
    end if;
    if new.employee_id is distinct from old.employee_id then
      raise exception 'Only an admin can link an account to an employee record';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists protect_profile_fields on profiles;
create trigger protect_profile_fields
  before update on profiles
  for each row execute procedure protect_profile_privileged_fields();
