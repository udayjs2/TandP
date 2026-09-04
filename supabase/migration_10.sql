-- Migration 10 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds a way to log advance/partial payments received from a customer
-- against a specific order — independent of formal invoicing, since many
-- garment orders collect an advance before any invoice is raised.

create table if not exists order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  amount numeric not null default 0,
  payment_date date not null,
  mode text default 'Cash', -- Cash, UPI, Bank Transfer, Cheque, Card, Other
  notes text,
  updated_by text,
  created_at timestamptz default now()
);

alter table order_payments enable row level security;
create policy "order_payments_admin_only" on order_payments for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table order_payments;
