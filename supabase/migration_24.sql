-- Migration 24 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds a printable Order Confirmation & Supply Agreement per order,
-- matching the TandP Textiles two-page template. Pulls order number,
-- customer name, items, and dates automatically from the order; only asks
-- for what isn't already tracked elsewhere (school address, contact,
-- GSTIN, payment terms, per-item rate).

create table if not exists order_agreements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  agreement_date date not null,
  quotation_no text,
  supplier_gstin text,
  supplier_contact text,
  school_address text,
  contact_person text,
  mobile text,
  customer_gstin text,
  gst_percent numeric default 0,
  advance_pct numeric default 0,
  before_dispatch_pct numeric default 0,
  balance_pct numeric default 0,
  balance_days numeric default 7,
  transportation text default 'As mutually agreed' check (transportation in ('Included in price','Payable separately','As mutually agreed')),
  unclaimed_goods_days numeric default 15,
  item_rates jsonb default '[]', -- [{description, rate}]
  created_at timestamptz default now()
);

alter table order_agreements enable row level security;
create policy "order_agreements_admin_only" on order_agreements for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table order_agreements;
