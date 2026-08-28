-- T&P Textiles — Workshop Management
-- Run this entire file once in Supabase Dashboard -> SQL Editor -> New query -> Run

-- 1. Profiles (one row per login, links to Supabase Auth users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz default now()
);

-- Automatically create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'user');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Helper: is the current logged-in user an admin?
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- 2. Employees
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text,
  name text not null,
  role text not null default 'Production',
  department text,
  phone text,
  join_date date,
  base_salary numeric default 0,
  created_at timestamptz default now()
);

-- 3. Orders
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  customer_name text not null,
  item_description text,
  quantity numeric default 0,
  order_date date,
  due_date date,
  amount numeric default 0,
  status text default 'Pending',
  created_at timestamptz default now()
);

-- 4. Invoices (line items stored as jsonb: [{description, quantity, price}])
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text,
  customer_name text not null,
  linked_order_id uuid references orders(id) on delete set null,
  issue_date date,
  due_date date,
  status text default 'Unpaid',
  items jsonb default '[]',
  amount numeric default 0,
  created_at timestamptz default now()
);

-- 5. Attendance (one row per employee per day)
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  date date not null,
  status text not null,
  unique (employee_id, date)
);

-- 6. Payroll (one row per employee per month)
create table if not exists payroll (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  month text not null, -- format YYYY-MM
  bonus numeric default 0,
  deductions numeric default 0,
  status text default 'Pending',
  unique (employee_id, month)
);

-- 7. Sales targets (one row per sales employee per month)
create table if not exists sales_targets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  month text not null,
  target numeric default 0,
  achieved numeric default 0,
  leads numeric default 0,
  unique (employee_id, month)
);

-- 8. Business settings (single row, id = 1)
create table if not exists settings (
  id int primary key default 1,
  business_name text default 'T&P Textiles',
  address text default '',
  phone text default '',
  gstin text default '',
  bank_name text default '',
  account_name text default '',
  account_number text default '',
  ifsc text default '',
  branch text default '',
  upi text default '',
  terms text default ''
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ===================== ROW LEVEL SECURITY =====================
alter table profiles enable row level security;
alter table employees enable row level security;
alter table orders enable row level security;
alter table invoices enable row level security;
alter table attendance enable row level security;
alter table payroll enable row level security;
alter table sales_targets enable row level security;
alter table settings enable row level security;

-- Profiles: everyone signed in can see all profiles (small trusted team); only admins edit roles
create policy "profiles_select" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_self_name" on profiles for update using (auth.uid() = id);
create policy "profiles_admin_manage" on profiles for all using (is_admin());

-- Employees, Orders, Attendance, Payroll, Sales targets, Settings:
-- any signed-in user can VIEW, only admins can INSERT/UPDATE/DELETE
create policy "employees_select" on employees for select using (auth.role() = 'authenticated');
create policy "employees_admin_write" on employees for insert with check (is_admin());
create policy "employees_admin_update" on employees for update using (is_admin());
create policy "employees_admin_delete" on employees for delete using (is_admin());

create policy "orders_select" on orders for select using (auth.role() = 'authenticated');
create policy "orders_admin_write" on orders for insert with check (is_admin());
create policy "orders_admin_update" on orders for update using (is_admin());
create policy "orders_admin_delete" on orders for delete using (is_admin());

create policy "attendance_select" on attendance for select using (auth.role() = 'authenticated');
create policy "attendance_admin_write" on attendance for insert with check (is_admin());
create policy "attendance_admin_update" on attendance for update using (is_admin());
create policy "attendance_admin_delete" on attendance for delete using (is_admin());

create policy "payroll_select" on payroll for select using (auth.role() = 'authenticated');
create policy "payroll_admin_write" on payroll for insert with check (is_admin());
create policy "payroll_admin_update" on payroll for update using (is_admin());
create policy "payroll_admin_delete" on payroll for delete using (is_admin());

create policy "sales_select" on sales_targets for select using (auth.role() = 'authenticated');
create policy "sales_admin_write" on sales_targets for insert with check (is_admin());
create policy "sales_admin_update" on sales_targets for update using (is_admin());
create policy "sales_admin_delete" on sales_targets for delete using (is_admin());

create policy "settings_select" on settings for select using (auth.role() = 'authenticated');
create policy "settings_admin_update" on settings for update using (is_admin());

-- Invoices: ANY signed-in user (admin or staff) can view, create and edit invoices
create policy "invoices_select" on invoices for select using (auth.role() = 'authenticated');
create policy "invoices_write" on invoices for insert with check (auth.role() = 'authenticated');
create policy "invoices_update" on invoices for update using (auth.role() = 'authenticated');
create policy "invoices_delete" on invoices for delete using (is_admin());

-- ===================== REALTIME =====================
-- Lets the app receive live updates when another manager changes data
alter publication supabase_realtime add table employees, orders, invoices, attendance, payroll, sales_targets, settings;
