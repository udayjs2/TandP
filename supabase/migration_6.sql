-- Migration 6 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: an "hr" role (Dashboard + Attendance access only — nothing else),
-- and a way to record which employees worked on which order and when, so
-- labor cost can be calculated automatically instead of typed in by hand.

-- 1. Allow 'hr' as a valid role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','user','hr'));

-- 2. Helper: is the current user an admin OR hr? (used only for attendance —
-- everything else stays admin-only, including Employees, Orders, Payroll,
-- Invoices, Sales, and Finance)
create or replace function is_admin_or_hr()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','hr')
  );
$$ language sql security definer stable;

-- Also let HR change their own role/employee_id protections stay admin-only
-- (no change needed — the existing protect_profile_fields trigger already
-- requires is_admin() specifically, so HR cannot self-promote or promote others)

-- 3. Widen attendance write access to admin OR hr (select stays as-is —
-- any signed-in user can already read attendance)
drop policy if exists "attendance_admin_write" on attendance;
drop policy if exists "attendance_admin_update" on attendance;
drop policy if exists "attendance_admin_delete" on attendance;
create policy "attendance_write" on attendance for insert with check (is_admin_or_hr());
create policy "attendance_update" on attendance for update using (is_admin_or_hr());
create policy "attendance_delete" on attendance for delete using (is_admin_or_hr());

-- 4. Order labor assignments — which employee worked on which order, on
-- which date. Used to auto-calculate labor cost and man-days per order.
-- Admin-only, same sensitivity level as order_finance.
create table if not exists order_labor (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  work_date date not null,
  created_at timestamptz default now(),
  unique (order_id, employee_id, work_date)
);

alter table order_labor enable row level security;
create policy "order_labor_admin_only" on order_labor for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table order_labor;
