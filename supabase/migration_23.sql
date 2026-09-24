-- Migration 23 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds a lightweight customer tracker to the Sales Team module: customer
-- name, location, contact person/number, a visit log (so "number of
-- visits" is always accurate — it's just a count of logged visits), and
-- follow-up reminders.

-- Helper: is the current user an admin, OR a staff member linked to an
-- employee whose role is "Sales"? Used to let sales staff manage their own
-- customer list without needing full admin rights.
create or replace function is_sales_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles p
    join employees e on e.id = p.employee_id
    where p.id = auth.uid() and e.role = 'Sales'
  );
$$ language sql security definer stable;

create table if not exists sales_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  contact_person text,
  contact_number text,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists customer_visits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references sales_customers(id) on delete cascade,
  visit_date date not null,
  notes text,
  logged_by text,
  created_at timestamptz default now()
);

create table if not exists customer_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references sales_customers(id) on delete cascade,
  remind_date date not null,
  note text,
  completed boolean not null default false,
  created_at timestamptz default now()
);

alter table sales_customers enable row level security;
alter table customer_visits enable row level security;
alter table customer_reminders enable row level security;

-- Readable by any signed-in user (a customer contact list isn't sensitive
-- the way financial data is); only sales staff or admin can manage it.
create policy "sales_customers_select" on sales_customers for select using (auth.role() = 'authenticated');
create policy "sales_customers_write" on sales_customers for insert with check (is_sales_or_admin());
create policy "sales_customers_update" on sales_customers for update using (is_sales_or_admin());
create policy "sales_customers_delete" on sales_customers for delete using (is_sales_or_admin());

create policy "customer_visits_select" on customer_visits for select using (auth.role() = 'authenticated');
create policy "customer_visits_write" on customer_visits for insert with check (is_sales_or_admin());
create policy "customer_visits_update" on customer_visits for update using (is_sales_or_admin());
create policy "customer_visits_delete" on customer_visits for delete using (is_sales_or_admin());

create policy "customer_reminders_select" on customer_reminders for select using (auth.role() = 'authenticated');
create policy "customer_reminders_write" on customer_reminders for insert with check (is_sales_or_admin());
create policy "customer_reminders_update" on customer_reminders for update using (is_sales_or_admin());
create policy "customer_reminders_delete" on customer_reminders for delete using (is_sales_or_admin());

alter publication supabase_realtime add table sales_customers, customer_visits, customer_reminders;
