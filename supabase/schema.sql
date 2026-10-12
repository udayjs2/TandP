-- T&P Textiles — Workshop Management
-- Run this entire file once in Supabase Dashboard -> SQL Editor -> New query -> Run

-- 1. Employees (created first since profiles links to it)
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text,
  name text not null,
  role text not null default 'Production',
  department text,
  phone text,
  join_date date,
  base_salary numeric default 0,
  reporting_manager_id uuid references employees(id) on delete set null,
  created_at timestamptz default now()
);

-- 2. Profiles (one row per login, links to Supabase Auth users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'user' check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales')),
  employee_id uuid references employees(id) on delete set null,
  email text,
  created_at timestamptz default now()
);

-- 2b. Pending role invitations — lets an admin pre-assign a role (Admin/HR/
-- Staff) to an email address before that person even signs up.
create table if not exists role_invitations (
  email text primary key,
  intended_role text not null check (intended_role in ('admin','hr','user')),
  name_hint text,
  invited_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Automatically create a profile row whenever someone signs up. Checks for
-- a matching invitation first — if the admin pre-assigned a role to this
-- email, use that; otherwise default to 'user' (Staff) as before.
create or replace function handle_new_user()
returns trigger as $$
declare
  matched_role text;
begin
  -- Exception-safe: a failure looking up an invitation should never block
  -- the signup itself — just fall back to the default 'user' role.
  begin
    select intended_role into matched_role
    from role_invitations
    where lower(email) = lower(new.email)
    limit 1;
  exception when others then
    matched_role := null;
  end;

  insert into public.profiles (id, name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), coalesce(matched_role, 'user'), new.email);

  begin
    delete from role_invitations where lower(email) = lower(new.email);
  exception when others then
    null;
  end;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- HR has the SAME access as Admin everywhere — rather than rewrite every
-- RLS policy in this schema individually (there are dozens), this is the
-- one function almost all of them call, so it's the single place that
-- needs to say so.
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','hr')
  );
$$ language sql security definer stable;

-- Kept as an alias for backward compatibility with earlier policies that
-- reference it by name — identical to is_admin() now that HR has full access.
create or replace function is_admin_or_hr()
returns boolean as $$
  select is_admin();
$$ language sql security definer stable;

-- Is the current user GM, PM, or admin/hr? Used for Cutting approvals and
-- the limited (password-reset-only) User Management view.
create or replace function is_gm_pm_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles where id = auth.uid() and role in ('gm','pm')
  );
$$ language sql security definer stable;

-- Is the current user the Cutting Master, or admin/hr?
create or replace function is_cutting_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles where id = auth.uid() and role = 'cutting_master'
  );
$$ language sql security definer stable;

-- Is the current user an admin, OR a staff member linked to an employee
-- whose role is "Sales"? Lets sales staff manage their own customer list
-- (Sales Team -> Customers) without needing full admin rights.
create or replace function is_sales_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles p
    join employees e on e.id = p.employee_id
    where p.id = auth.uid() and e.role = 'Sales'
  );
$$ language sql security definer stable;

-- Prevent a non-admin from changing their own role or employee_id, even though
-- they're otherwise allowed to update their own profile row (e.g. to change their name).
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

-- 3. Orders (line items stored as jsonb: [{description, quantity}])
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  customer_name text not null,
  items jsonb default '[]',
  daily_target numeric default 0,
  planned_resources numeric default 0,
  order_date date,
  planned_start_date date,
  planned_end_date date,
  due_date date,
  status text default 'Not Started',
  tracking_code text default substr(md5(random()::text || clock_timestamp()::text), 1, 6),
  created_at timestamptz default now()
);

-- 3b. Hourly production progress log (one row per order + date + hour slot + item)
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

-- 3c. Delivery log (partial deliveries — e.g. shipping some items now, rest later)
create table if not exists order_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  date date not null,
  item_description text not null,
  quantity numeric not null default 0,
  delivered_to text,
  notes text,
  updated_by text,
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
  advance_received numeric default 0,
  created_at timestamptz default now()
);

-- 5. Attendance (one row per employee per day)
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  date date not null,
  status text not null,
  check_in time,
  check_out time,
  check_in_lat numeric,
  check_in_lng numeric,
  check_in_distance_m numeric,
  check_in_location text,
  check_out_lat numeric,
  check_out_lng numeric,
  check_out_distance_m numeric,
  check_out_location text,
  self_marked boolean default false,
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
  business_name text default 'T AND P TEXTILES',
  address text default 'Chinthavaram Ponnavolu Road, Chillakuru Mandal, Nellore District, Andhra Pradesh - 524412',
  phone text default '9384000246',
  gstin text default '37CENPN0332K1ZA',
  bank_name text default 'Canara Bank',
  account_name text default 'T AND P TEXTILES',
  account_number text default '125009801350',
  ifsc text default 'CNRB0013494',
  branch text default 'Chinthavaram',
  upi text default '9384000246',
  terms text default '1. This is a Pro Forma Invoice only.
2. Goods are subject to availability.
3. Prices include GST as shown above.
4. Payment as per agreed terms.',
  total_workforce numeric default 0,
  avg_seconds_per_operation numeric default 30,
  line_efficiency_pct numeric default 50,
  factory_lat numeric,
  factory_lng numeric,
  geofence_radius_meters numeric default 200
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- 18. Garment production rates (admin-maintained) — pieces/day/person per
-- garment type, since a plain T-shirt and a pant with a back pocket take
-- different time. Used to project how many days an order will take.
-- `operations` (number of assembly-line steps a style needs) lets the app
-- estimate a starting rate for you using standard line-balancing math;
-- pieces_per_day_per_person is the number actually used for projections
-- and can always be overridden once you have real observed output.
create table if not exists garment_rates (
  id uuid primary key default gen_random_uuid(),
  garment_type text not null unique,
  operations integer,
  pieces_per_day_per_person numeric not null default 0,
  notes text,
  created_at timestamptz default now()
);

-- 9. Expense claims (bills submitted by sales/field staff — food, petrol, transport)
create table if not exists expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  category text not null default 'Other', -- Food, Petrol, Transport, Other
  transport_mode text, -- Bus, Auto, Own Vehicle, Train, Other
  amount numeric not null default 0,
  expense_date date not null,
  description text,
  receipt_path text, -- path inside the 'bills' storage bucket
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected','Reimbursed')),
  admin_notes text,
  submitted_by uuid references profiles(id) on delete set null,
  linked_order_id uuid references orders(id) on delete set null,
  created_at timestamptz default now()
);

-- 10. Investors
create table if not exists investors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

-- 11. Investments (multiple entries per investor over time)
create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investors(id) on delete cascade,
  amount numeric not null default 0,
  invested_date date not null,
  notes text,
  created_at timestamptz default now()
);

-- 12. Expenditures — general business purchases: raw material (fabric,
-- buttons, trims), machinery, utilities, rent, maintenance, etc.
create table if not exists expenditures (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Raw Material',
  item text,
  vendor text,
  amount numeric not null default 0,
  expense_date date not null,
  notes text,
  linked_order_id uuid references orders(id) on delete set null,
  investor_id uuid references investors(id) on delete set null,
  source_claim_id uuid references expense_claims(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 13. Per-order cost/profitability. Kept separate from `orders` (which any
-- signed-in staff member can read for production tracking) so that cost and
-- profit numbers stay admin-only at the database level.
create table if not exists order_finance (
  order_id uuid primary key references orders(id) on delete cascade,
  raw_material_cost numeric default 0,
  labor_cost numeric default 0,
  overhead_cost numeric default 0,
  manpower_count numeric default 0,
  man_days numeric default 0,
  updated_at timestamptz default now()
);

-- 14. Order labor assignments — which employee worked on which order, on
-- which date. Used to auto-calculate labor cost and man-days per order
-- instead of typing a number in by hand. Same sensitivity as order_finance.
create table if not exists order_labor (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  work_date date not null,
  created_at timestamptz default now(),
  unique (order_id, employee_id, work_date)
);

-- 15. Bank loans + monthly payments
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

create table if not exists loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id) on delete cascade,
  payment_month text not null,
  amount numeric not null default 0,
  payment_date date not null,
  notes text,
  created_at timestamptz default now(),
  unique (loan_id, payment_month)
);

-- 16. Advance/partial payments received from a customer against a specific
-- order — independent of formal invoicing, since orders often collect an
-- advance before any invoice is raised.
create table if not exists order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  amount numeric not null default 0,
  payment_date date not null,
  mode text default 'Cash',
  notes text,
  updated_by text,
  created_at timestamptz default now()
);

-- 17. Biometric device sync keys — lets a small local script push
-- attendance punches in via the narrow sync_attendance_punch() function
-- below, without ever holding full database credentials.
create table if not exists device_sync_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

-- 19. Offer letters — fill a form and get a printable offer letter with
-- the company letterhead, matching the standard T&P Textiles template.
create table if not exists offer_letters (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  letter_number text,
  issue_date date not null,
  father_husband_name text,
  address text,
  designation text,
  department text,
  employment_type text default 'Regular' check (employment_type in ('Regular','Probation','Contract')),
  joining_date date,
  reporting_manager text,
  basic_salary numeric default 0,
  da_allowance numeric default 0,
  attendance_allowance numeric default 0,
  other_deductions numeric default 0,
  probation_months numeric default 3,
  notice_period_days numeric default 30,
  weekly_off text default 'Sunday',
  created_at timestamptz default now()
);

-- 20. Sales Team customer tracker: locations, contacts, visit log, reminders
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

-- 21. Order Confirmation & Supply Agreement per order — pulls order
-- number, customer name, items, and dates automatically from the order;
-- only asks for what isn't already tracked elsewhere.
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
  item_rates jsonb default '[]',
  created_at timestamptz default now()
);

-- 22. Cutting module — Cutting Master logs size-wise cut counts per order
-- + item + day; PM/GM/admin/hr approve; completed (stitched) size counts
-- are logged against the same row for a red/green comparison.
create table if not exists cutting_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  item_description text not null,
  cut_date date not null,
  sizes jsonb not null default '{}',
  completed_sizes jsonb not null default '{}',
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected')),
  submitted_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- 23. Leave requests — routed to the employee's reporting manager
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz default now()
);

-- ===================== ROW LEVEL SECURITY =====================

alter table profiles enable row level security;
alter table employees enable row level security;
alter table orders enable row level security;
alter table order_progress enable row level security;
alter table order_deliveries enable row level security;
alter table invoices enable row level security;
alter table attendance enable row level security;
alter table payroll enable row level security;
alter table sales_targets enable row level security;
alter table settings enable row level security;
alter table expense_claims enable row level security;

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

create policy "order_progress_select" on order_progress for select using (auth.role() = 'authenticated');
create policy "order_progress_admin_write" on order_progress for insert with check (is_admin());
create policy "order_progress_admin_update" on order_progress for update using (is_admin());
create policy "order_progress_admin_delete" on order_progress for delete using (is_admin());

create policy "order_deliveries_select" on order_deliveries for select using (auth.role() = 'authenticated');
create policy "order_deliveries_admin_write" on order_deliveries for insert with check (is_admin());
create policy "order_deliveries_admin_update" on order_deliveries for update using (is_admin());
create policy "order_deliveries_admin_delete" on order_deliveries for delete using (is_admin());

create policy "attendance_select" on attendance for select using (auth.role() = 'authenticated');
create policy "attendance_write" on attendance for insert with check (is_admin_or_hr());
create policy "attendance_update" on attendance for update using (is_admin_or_hr());
create policy "attendance_delete" on attendance for delete using (is_admin_or_hr());

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

-- Expense claims: staff see/manage only their own (matched via their linked
-- employee_id); admins see and can process all.
create policy "expense_claims_select" on expense_claims for select using (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);
create policy "expense_claims_insert" on expense_claims for insert with check (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);
create policy "expense_claims_update" on expense_claims for update using (
  is_admin() or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Submitted'
  )
);
create policy "expense_claims_delete" on expense_claims for delete using (
  is_admin() or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Submitted'
  )
);

-- Investors, investments, expenditures, order profitability: admin-only for
-- every operation (select/insert/update/delete). Staff get zero access even
-- via direct API calls — deliberately stricter than the rest of the app.
alter table investors enable row level security;
alter table investments enable row level security;
alter table expenditures enable row level security;
alter table order_finance enable row level security;
create policy "investors_admin_only" on investors for all using (is_admin()) with check (is_admin());
create policy "investments_admin_only" on investments for all using (is_admin()) with check (is_admin());
create policy "expenditures_admin_only" on expenditures for all using (is_admin()) with check (is_admin());
create policy "order_finance_admin_only" on order_finance for all using (is_admin()) with check (is_admin());
alter table order_labor enable row level security;
create policy "order_labor_admin_only" on order_labor for all using (is_admin()) with check (is_admin());

alter table loans enable row level security;
alter table loan_payments enable row level security;
create policy "loans_admin_only" on loans for all using (is_admin()) with check (is_admin());
create policy "loan_payments_admin_only" on loan_payments for all using (is_admin()) with check (is_admin());

alter table order_payments enable row level security;
create policy "order_payments_admin_only" on order_payments for all using (is_admin()) with check (is_admin());

alter table device_sync_keys enable row level security;
create policy "device_sync_keys_admin_only" on device_sync_keys for all using (is_admin()) with check (is_admin());

alter table offer_letters enable row level security;
create policy "offer_letters_admin_only" on offer_letters for all using (is_admin()) with check (is_admin());

alter table sales_customers enable row level security;
alter table customer_visits enable row level security;
alter table customer_reminders enable row level security;

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

alter table order_agreements enable row level security;
create policy "order_agreements_admin_only" on order_agreements for all using (is_admin()) with check (is_admin());

alter table cutting_entries enable row level security;
create policy "cutting_entries_select" on cutting_entries for select using (auth.role() = 'authenticated');
create policy "cutting_entries_insert" on cutting_entries for insert with check (is_cutting_or_admin());
create policy "cutting_entries_update" on cutting_entries for update using (is_gm_pm_or_admin());
create policy "cutting_entries_delete" on cutting_entries for delete using (is_admin());

alter table leave_requests enable row level security;
create policy "leave_requests_select" on leave_requests for select using (
  is_admin()
  or employee_id = (select employee_id from profiles where id = auth.uid())
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
);
create policy "leave_requests_insert" on leave_requests for insert with check (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);
create policy "leave_requests_update" on leave_requests for update using (
  is_admin()
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
  or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Pending'
  )
);
create policy "leave_requests_delete" on leave_requests for delete using (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);

alter table garment_rates enable row level security;
create policy "garment_rates_select" on garment_rates for select using (auth.role() = 'authenticated');
create policy "garment_rates_admin_write" on garment_rates for insert with check (is_admin());
create policy "garment_rates_admin_update" on garment_rates for update using (is_admin());
create policy "garment_rates_admin_delete" on garment_rates for delete using (is_admin());

alter table role_invitations enable row level security;
create policy "role_invitations_admin_only" on role_invitations for all using (is_admin()) with check (is_admin());

-- Storage bucket for receipt photos (private). Files are stored as
-- "<employee_id>/<filename>" so folder-based policies scope access correctly.
insert into storage.buckets (id, name, public)
values ('bills', 'bills', false)
on conflict (id) do nothing;

create policy "bills_insert" on storage.objects for insert
  with check (
    bucket_id = 'bills' and (
      is_admin() or
      (storage.foldername(name))[1] = (select employee_id::text from profiles where id = auth.uid())
    )
  );

create policy "bills_select" on storage.objects for select
  using (
    bucket_id = 'bills' and (
      is_admin() or
      (storage.foldername(name))[1] = (select employee_id::text from profiles where id = auth.uid())
    )
  );

create policy "bills_delete" on storage.objects for delete
  using (
    bucket_id = 'bills' and (
      is_admin() or
      (storage.foldername(name))[1] = (select employee_id::text from profiles where id = auth.uid())
    )
  );

-- Public order-status lookup (no login required). A customer needs BOTH the
-- exact order number AND its tracking code — this only ever returns one
-- order's summary, never a list, so it can't be used to browse all orders.
create or replace function public_order_status(p_order_number text, p_tracking_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  select json_build_object(
    'order_number', o.order_number,
    'customer_name', o.customer_name,
    'status', o.status,
    'order_date', o.order_date,
    'planned_start_date', o.planned_start_date,
    'planned_end_date', o.planned_end_date,
    'due_date', o.due_date,
    'items', (
      select coalesce(json_agg(json_build_object(
        'description', item->>'description',
        'required', (item->>'quantity')::numeric,
        'completed', coalesce((
          select sum(quantity) from order_progress
          where order_id = o.id and item_description = item->>'description'
        ), 0),
        'delivered', coalesce((
          select sum(quantity) from order_deliveries
          where order_id = o.id and item_description = item->>'description'
        ), 0)
      )), '[]'::json)
      from jsonb_array_elements(o.items) as item
    )
  ) into result
  from orders o
  where o.order_number = p_order_number and o.tracking_code = p_tracking_code;

  return result;
end;
$$;

grant execute on function public_order_status(text, text) to anon, authenticated;

-- When admin marks a sales/field expense claim "Reimbursed", automatically
-- add it to the central Expenditures ledger — via trigger, so it happens
-- regardless of which screen is used to mark it reimbursed.
create or replace function sync_reimbursed_expense_to_expenditure()
returns trigger as $$
begin
  if new.status = 'Reimbursed' and (old.status is distinct from 'Reimbursed') then
    if not exists (select 1 from expenditures where source_claim_id = new.id) then
      insert into expenditures (category, item, amount, expense_date, notes, linked_order_id, source_claim_id)
      values (
        'Other',
        'Sales expense — ' || new.category || coalesce(' (' || new.transport_mode || ')', ''),
        new.amount,
        new.expense_date,
        coalesce(new.description, 'Reimbursed sales/field expense'),
        new.linked_order_id,
        new.id
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_expense_claim_reimbursed on expense_claims;
create trigger on_expense_claim_reimbursed
  after update on expense_claims
  for each row execute procedure sync_reimbursed_expense_to_expenditure();

-- Biometric device sync function (was missing from this master file before —
-- fresh installs need this even though device_sync_keys table was present).
-- Security definer so a local sync script with no logged-in session can
-- call it; the p_api_key check is what actually gates access.
create or replace function sync_attendance_punch(
  p_api_key text,
  p_employee_number text,
  p_date date,
  p_check_in time,
  p_check_out time
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_hours numeric;
  v_status text;
begin
  if not exists (select 1 from device_sync_keys where key = p_api_key and active = true) then
    return json_build_object('ok', false, 'error', 'invalid_or_inactive_key');
  end if;

  update device_sync_keys set last_used_at = now() where key = p_api_key;

  select id into v_employee_id from employees where employee_number = p_employee_number limit 1;
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'employee_not_found', 'employee_number', p_employee_number);
  end if;

  if p_check_in is not null and p_check_out is not null then
    v_hours := extract(epoch from (p_check_out - p_check_in)) / 3600.0;
  else
    v_hours := null;
  end if;

  -- A punch pair (in + out) is never "Absent" — the device saw them.
  v_status := case
    when v_hours is null then 'Present'
    when v_hours >= 9 then 'Present'
    else 'Half Day'
  end;

  insert into attendance (employee_id, date, status, check_in, check_out)
  values (v_employee_id, p_date, v_status, p_check_in, p_check_out)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_out = excluded.check_out, status = excluded.status;

  return json_build_object('ok', true, 'employee_id', v_employee_id, 'status', v_status, 'hours', v_hours);
end;
$$;

grant execute on function sync_attendance_punch(text, text, date, time, time) to anon, authenticated;

-- Distance between two lat/lng points, in meters (haversine formula) — used
-- for geolocation-based self check-in/out below.
create or replace function haversine_meters(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end;
$$;

-- Phone-based self check-in/out. Security definer, but hard-scoped inside
-- the function to the CALLING user's own linked employee and today's date
-- only — nothing a client payload can override. Outside-the-geofence
-- check-ins are flagged (distance returned), never blocked outright.
create or replace function self_check_in(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := (now() at time zone 'Asia/Kolkata')::time;
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is not null then
    return json_build_object('ok', false, 'error', 'already_checked_in');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);

  insert into attendance (employee_id, date, status, check_in, check_in_lat, check_in_lng, check_in_distance_m, check_in_location, self_marked)
  values (v_employee_id, v_today, 'Present', v_now_ist, p_lat, p_lng, v_distance, p_location, true)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_in_lat = excluded.check_in_lat,
                check_in_lng = excluded.check_in_lng, check_in_distance_m = excluded.check_in_distance_m,
                check_in_location = excluded.check_in_location, self_marked = true;

  return json_build_object('ok', true, 'distance_meters', v_distance);
end;
$$;

create or replace function self_check_out(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := (now() at time zone 'Asia/Kolkata')::time;
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
  v_hours numeric;
  v_status text;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is null then
    return json_build_object('ok', false, 'error', 'not_checked_in_yet');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);
  v_hours := extract(epoch from (v_now_ist - v_existing.check_in)) / 3600.0;
  -- A completed check-in + check-out is never "Absent" — they showed up.
  v_status := case when v_hours >= 9 then 'Present' else 'Half Day' end;

  update attendance
  set check_out = v_now_ist, check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_distance_m = v_distance, check_out_location = p_location, status = v_status
  where employee_id = v_employee_id and date = v_today;

  return json_build_object('ok', true, 'distance_meters', v_distance, 'hours', v_hours, 'status', v_status);
end;
$$;

grant execute on function self_check_in(numeric, numeric, text) to authenticated;
grant execute on function self_check_out(numeric, numeric, text) to authenticated;

-- ===================== REALTIME =====================
-- Lets the app receive live updates when another manager changes data
alter publication supabase_realtime add table employees, orders, order_progress, order_deliveries, order_payments, invoices, attendance, payroll, sales_targets, settings, expense_claims, investors, investments, expenditures, order_finance, order_labor, role_invitations, loans, loan_payments, device_sync_keys, garment_rates, offer_letters, sales_customers, customer_visits, customer_reminders, order_agreements, cutting_entries, leave_requests;

-- ===== Migration 29 contents (attendance time fix + inventory) =====
-- Migration 29 — run in Supabase SQL Editor AFTER migration_28.sql
--
-- 1. Attendance fix: self check-in/out times were stored with microseconds
--    (e.g. 09:20:33.482913), which the time field in the Attendance screen
--    could not display, so the row looked empty. Times are now stored to the
--    second, existing rows are trimmed, and `attendance` is added to the
--    realtime feed so the Attendance page refreshes by itself.
-- 2. Inventory module: machines, fabric, and threads/elastic/accessories.

-- ---------- 1. Attendance ----------
update attendance
set check_in  = date_trunc('second', check_in),
    check_out = date_trunc('second', check_out)
where check_in is not null or check_out is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table attendance;
  end if;
end $$;

create or replace function self_check_in(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := date_trunc('second', (now() at time zone 'Asia/Kolkata')::time);
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is not null then
    return json_build_object('ok', false, 'error', 'already_checked_in');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);

  insert into attendance (employee_id, date, status, check_in, check_in_lat, check_in_lng, check_in_distance_m, check_in_location, self_marked)
  values (v_employee_id, v_today, 'Present', v_now_ist, p_lat, p_lng, v_distance, p_location, true)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_in_lat = excluded.check_in_lat,
                check_in_lng = excluded.check_in_lng, check_in_distance_m = excluded.check_in_distance_m,
                check_in_location = excluded.check_in_location, self_marked = true;

  return json_build_object('ok', true, 'distance_meters', v_distance);
end;
$$;

create or replace function self_check_out(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := date_trunc('second', (now() at time zone 'Asia/Kolkata')::time);
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
  v_hours numeric;
  v_status text;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is null then
    return json_build_object('ok', false, 'error', 'not_checked_in_yet');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);
  v_hours := extract(epoch from (v_now_ist - v_existing.check_in)) / 3600.0;
  v_status := case when v_hours >= 9 then 'Present' else 'Half Day' end;

  update attendance
  set check_out = v_now_ist, check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_distance_m = v_distance, check_out_location = p_location, status = v_status
  where employee_id = v_employee_id and date = v_today;

  return json_build_object('ok', true, 'distance_meters', v_distance, 'hours', v_hours, 'status', v_status);
end;
$$;

grant execute on function self_check_in(numeric, numeric, text) to authenticated;
grant execute on function self_check_out(numeric, numeric, text) to authenticated;

-- ---------- 2. Inventory ----------
create table if not exists inventory_machines (
  id uuid primary key default gen_random_uuid(),
  model text not null check (model in ('JUKI','ZOJE','JIN','JACK','KANSAI','OTHER')),
  model_other text,                 -- name when model = OTHER
  machine_type text not null,       -- free text, e.g. Single needle lockstitch
  quantity integer not null default 1,
  working_condition text not null default 'Working',
  purchase_date date,
  last_service_date date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists inventory_fabric (
  id uuid primary key default gen_random_uuid(),
  fabric_type text not null,        -- e.g. Single jersey, Cotton poplin
  color text,
  weight_gsm numeric,               -- fabric weight (GSM)
  stock_kg numeric default 0,
  stock_meters numeric default 0,
  supplier text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Thread','Elastic','Accessory','Other')),
  name text not null,
  quantity numeric not null default 0,
  unit text default 'pcs',
  notes text,
  created_at timestamptz default now()
);

alter table inventory_machines enable row level security;
alter table inventory_fabric enable row level security;
alter table inventory_items enable row level security;

-- Everyone signed in can read; admin/HR/GM/PM can add, edit and delete.
drop policy if exists "inv_machines_select" on inventory_machines;
drop policy if exists "inv_machines_write" on inventory_machines;
drop policy if exists "inv_fabric_select" on inventory_fabric;
drop policy if exists "inv_fabric_write" on inventory_fabric;
drop policy if exists "inv_items_select" on inventory_items;
drop policy if exists "inv_items_write" on inventory_items;

create policy "inv_machines_select" on inventory_machines for select using (auth.role() = 'authenticated');
create policy "inv_machines_write" on inventory_machines for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());
create policy "inv_fabric_select" on inventory_fabric for select using (auth.role() = 'authenticated');
create policy "inv_fabric_write" on inventory_fabric for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());
create policy "inv_items_select" on inventory_items for select using (auth.role() = 'authenticated');
create policy "inv_items_write" on inventory_items for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());

do $$
declare t text;
begin
  foreach t in array array['inventory_machines','inventory_fabric','inventory_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
