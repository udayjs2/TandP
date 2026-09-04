-- Migration 9 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: attributing an expenditure to a specific investor (their funded
-- purchases count toward their total invested amount — nothing is deducted
-- anywhere), and bank loan tracking with monthly payment logging.

-- 1. Let an expenditure be attributed to a specific investor
alter table expenditures add column if not exists investor_id uuid references investors(id) on delete set null;

-- 2. Bank loans
create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  lender text not null,
  loan_amount numeric not null default 0,
  interest_rate numeric,
  emi_amount numeric default 0,
  start_date date,
  tenure_months numeric,
  notes text,
  created_at timestamptz default now()
);

-- 3. Monthly loan payments (one row per payment made)
create table if not exists loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id) on delete cascade,
  payment_month text not null, -- format YYYY-MM
  amount numeric not null default 0,
  payment_date date not null,
  notes text,
  created_at timestamptz default now(),
  unique (loan_id, payment_month)
);

alter table loans enable row level security;
alter table loan_payments enable row level security;
create policy "loans_admin_only" on loans for all using (is_admin()) with check (is_admin());
create policy "loan_payments_admin_only" on loan_payments for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table loans, loan_payments;
