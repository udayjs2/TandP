-- Migration 5 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: investor capital tracking, a general business expenditure ledger
-- (raw materials, machinery, etc.), and per-order cost/profit tracking.
--
-- SECURITY NOTE: everything in this migration is admin-only, at the
-- database level, not just hidden in the app's menus. Staff accounts get
-- zero access even via direct API calls — this is stricter than the rest
-- of the app (e.g. invoices, which staff can see) because this covers
-- investor money and per-order profit margins.

-- 1. Investors
create table if not exists investors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

-- 2. Investments (multiple entries per investor over time)
create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investors(id) on delete cascade,
  amount numeric not null default 0,
  invested_date date not null,
  notes text,
  created_at timestamptz default now()
);

-- 3. Expenditures — general business purchases: raw material (fabric,
-- buttons, trims), machinery, utilities, rent, maintenance, etc.
create table if not exists expenditures (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Raw Material',
  item text,
  vendor text,
  amount numeric not null default 0,
  expense_date date not null,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 4. Per-order cost/profitability (kept as a separate table from `orders`,
-- deliberately — `orders` is readable by any signed-in staff member for
-- production tracking, but cost/profit numbers should never be, so they
-- live here instead with their own admin-only policy).
create table if not exists order_finance (
  order_id uuid primary key references orders(id) on delete cascade,
  raw_material_cost numeric default 0,
  labor_cost numeric default 0,
  overhead_cost numeric default 0,
  manpower_count numeric default 0,
  man_days numeric default 0,
  updated_at timestamptz default now()
);

alter table investors enable row level security;
alter table investments enable row level security;
alter table expenditures enable row level security;
alter table order_finance enable row level security;

create policy "investors_admin_only" on investors for all using (is_admin()) with check (is_admin());
create policy "investments_admin_only" on investments for all using (is_admin()) with check (is_admin());
create policy "expenditures_admin_only" on expenditures for all using (is_admin()) with check (is_admin());
create policy "order_finance_admin_only" on order_finance for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table investors, investments, expenditures, order_finance;
