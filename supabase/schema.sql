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
-- Migration 30 — run in Supabase SQL Editor AFTER migration_29.sql
--
--  1. Production Manager (PM) gets full write access to the Orders module
--  2. Fabric usage at cutting time, deducted from Inventory -> Fabric
--  3. Admin-only "delete user account"
--  4. Approved leave is marked as "Leave" in Attendance
--  5. Machine spare parts / purchase details
--  6. Purchase requests (GM + Admin approval -> becomes an order expenditure)

-- ---------- 1. PM full access to Orders ----------
create or replace function is_pm_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'pm');
$$ language sql security definer stable;

drop policy if exists "orders_admin_write" on orders;
drop policy if exists "orders_admin_update" on orders;
drop policy if exists "orders_admin_delete" on orders;
create policy "orders_admin_write"  on orders for insert with check (is_pm_or_admin());
create policy "orders_admin_update" on orders for update using (is_pm_or_admin());
create policy "orders_admin_delete" on orders for delete using (is_pm_or_admin());

drop policy if exists "order_progress_admin_write" on order_progress;
drop policy if exists "order_progress_admin_update" on order_progress;
drop policy if exists "order_progress_admin_delete" on order_progress;
create policy "order_progress_admin_write"  on order_progress for insert with check (is_pm_or_admin());
create policy "order_progress_admin_update" on order_progress for update using (is_pm_or_admin());
create policy "order_progress_admin_delete" on order_progress for delete using (is_pm_or_admin());

drop policy if exists "order_deliveries_admin_write" on order_deliveries;
drop policy if exists "order_deliveries_admin_update" on order_deliveries;
drop policy if exists "order_deliveries_admin_delete" on order_deliveries;
create policy "order_deliveries_admin_write"  on order_deliveries for insert with check (is_pm_or_admin());
create policy "order_deliveries_admin_update" on order_deliveries for update using (is_pm_or_admin());
create policy "order_deliveries_admin_delete" on order_deliveries for delete using (is_pm_or_admin());

drop policy if exists "order_agreements_admin_only" on order_agreements;
create policy "order_agreements_admin_only" on order_agreements for all using (is_pm_or_admin()) with check (is_pm_or_admin());

-- ---------- 2. Fabric usage ----------
alter table cutting_entries add column if not exists fabric_id uuid references inventory_fabric(id) on delete set null;
alter table cutting_entries add column if not exists fabric_kg_used numeric default 0;
alter table cutting_entries add column if not exists fabric_meters_used numeric default 0;

create table if not exists fabric_usage (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid references inventory_fabric(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  cutting_entry_id uuid references cutting_entries(id) on delete cascade,
  kg_used numeric default 0,
  meters_used numeric default 0,
  used_by text,
  restored boolean default false,
  created_at timestamptz default now()
);
alter table fabric_usage enable row level security;
drop policy if exists "fabric_usage_select" on fabric_usage;
create policy "fabric_usage_select" on fabric_usage for select using (auth.role() = 'authenticated');

-- Cutting master can't edit inventory directly, so the deduction runs inside
-- this function. It refuses the cutting entry if the stock isn't there.
create or replace function submit_cutting(
  p_order_id uuid, p_item text, p_cut_date date, p_sizes jsonb,
  p_fabric_id uuid, p_kg numeric, p_meters numeric, p_submitted_by text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fabric inventory_fabric%rowtype;
  v_id uuid;
begin
  if not (is_cutting_or_admin() or is_gm_pm_or_admin()) then
    raise exception 'Not allowed to log cutting';
  end if;
  if p_fabric_id is null then
    raise exception 'Select the fabric used before logging cutting';
  end if;
  if coalesce(p_kg,0) <= 0 and coalesce(p_meters,0) <= 0 then
    raise exception 'Enter the fabric used (kg or meters)';
  end if;

  select * into v_fabric from inventory_fabric where id = p_fabric_id for update;
  if not found then raise exception 'Fabric not found in inventory'; end if;
  if coalesce(p_kg,0) > coalesce(v_fabric.stock_kg,0) then
    raise exception 'Only % kg available for this fabric', coalesce(v_fabric.stock_kg,0);
  end if;
  if coalesce(p_meters,0) > coalesce(v_fabric.stock_meters,0) then
    raise exception 'Only % m available for this fabric', coalesce(v_fabric.stock_meters,0);
  end if;

  insert into cutting_entries (order_id, item_description, cut_date, sizes, submitted_by, fabric_id, fabric_kg_used, fabric_meters_used)
  values (p_order_id, p_item, p_cut_date, p_sizes, p_submitted_by, p_fabric_id, coalesce(p_kg,0), coalesce(p_meters,0))
  returning id into v_id;

  update inventory_fabric
  set stock_kg = coalesce(stock_kg,0) - coalesce(p_kg,0),
      stock_meters = coalesce(stock_meters,0) - coalesce(p_meters,0)
  where id = p_fabric_id;

  insert into fabric_usage (fabric_id, order_id, cutting_entry_id, kg_used, meters_used, used_by)
  values (p_fabric_id, p_order_id, v_id, coalesce(p_kg,0), coalesce(p_meters,0), p_submitted_by);

  return v_id;
end;
$$;
grant execute on function submit_cutting(uuid, text, date, jsonb, uuid, numeric, numeric, text) to authenticated;

-- If a cutting entry is rejected, its fabric goes back into stock.
create or replace function restore_fabric_on_reject()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Rejected' and old.status is distinct from 'Rejected' then
    update inventory_fabric f
    set stock_kg = coalesce(f.stock_kg,0) + u.kg_used,
        stock_meters = coalesce(f.stock_meters,0) + u.meters_used
    from fabric_usage u
    where u.cutting_entry_id = new.id and u.restored = false and f.id = u.fabric_id;
    update fabric_usage set restored = true where cutting_entry_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_cutting_rejected on cutting_entries;
create trigger on_cutting_rejected after update on cutting_entries
  for each row execute procedure restore_fabric_on_reject();

-- ---------- 3. Delete user account (Admin only, not HR) ----------
create or replace function delete_user_account(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    return json_build_object('ok', false, 'error', 'Only an Admin can delete accounts');
  end if;
  if p_user_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot delete your own account');
  end if;
  delete from auth.users where id = p_user_id;   -- profiles row cascades
  return json_build_object('ok', true);
end;
$$;
grant execute on function delete_user_account(uuid) to authenticated;

-- ---------- 4. Approved leave -> Attendance "Leave" ----------
create or replace function sync_leave_to_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    insert into attendance (employee_id, date, status)
    select new.employee_id, d::date, 'Leave'
    from generate_series(new.start_date, new.end_date, interval '1 day') d
    on conflict (employee_id, date) do update set status = 'Leave'
      where attendance.check_in is null;      -- never overwrite a real punch
  elsif old.status = 'Approved' and new.status is distinct from 'Approved' then
    delete from attendance
    where employee_id = new.employee_id and date between new.start_date and new.end_date
      and status = 'Leave' and check_in is null;
  end if;
  return new;
end;
$$;
drop trigger if exists on_leave_status_change on leave_requests;
create trigger on_leave_status_change after update on leave_requests
  for each row execute procedure sync_leave_to_attendance();

-- Back-fill leave that was already approved
insert into attendance (employee_id, date, status)
select l.employee_id, d::date, 'Leave'
from leave_requests l, generate_series(l.start_date, l.end_date, interval '1 day') d
where l.status = 'Approved'
on conflict (employee_id, date) do nothing;

-- ---------- 5. Machine spare parts ----------
create table if not exists inventory_spare_parts (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid references inventory_machines(id) on delete cascade,
  part_name text not null,
  quantity numeric not null default 1,
  status text not null default 'Needed' check (status in ('Needed','Ordered','Purchased')),
  supplier text,
  amount numeric,
  purchase_date date,
  notes text,
  created_at timestamptz default now()
);
alter table inventory_spare_parts enable row level security;
drop policy if exists "inv_parts_select" on inventory_spare_parts;
drop policy if exists "inv_parts_write" on inventory_spare_parts;
create policy "inv_parts_select" on inventory_spare_parts for select using (auth.role() = 'authenticated');
create policy "inv_parts_write" on inventory_spare_parts for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());

-- ---------- 6. Purchase requests ----------
create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Fabric','Machine','Spare Parts','Accessories','Other')),
  item text not null,
  quantity numeric default 1,
  unit text,
  amount numeric not null default 0,
  vendor text,
  order_id uuid references orders(id) on delete set null,
  investor_id uuid references investors(id) on delete set null,
  notes text,
  requested_by uuid references profiles(id) on delete set null,
  requested_by_name text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  gm_approved_by text, gm_approved_at timestamptz,
  admin_approved_by text, admin_approved_at timestamptz,
  rejected_by text, reject_reason text,
  expenditure_id uuid references expenditures(id) on delete set null,
  created_at timestamptz default now()
);
alter table purchase_requests enable row level security;
drop policy if exists "pr_select" on purchase_requests;
drop policy if exists "pr_insert" on purchase_requests;
drop policy if exists "pr_delete" on purchase_requests;
create policy "pr_select" on purchase_requests for select using (is_gm_pm_or_admin());
create policy "pr_insert" on purchase_requests for insert with check (is_gm_pm_or_admin() and requested_by = auth.uid());
create policy "pr_delete" on purchase_requests for delete using (
  is_admin() or (requested_by = auth.uid() and status = 'Pending'));

-- Approval: GM approves once, and any one Admin/HR approves once. When both
-- are in, the request becomes Approved and is added to Expenditures against
-- the chosen order, funded by the chosen investor.
create or replace function approve_purchase_request(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; r purchase_requests%rowtype; v_exp uuid; v_cat text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Pending' then return json_build_object('ok', false, 'error', 'Request is already ' || r.status); end if;

  if v_role = 'gm' then
    update purchase_requests set gm_approved_by = v_name, gm_approved_at = now() where id = p_id;
  elsif v_role in ('admin','hr') then
    update purchase_requests set admin_approved_by = v_name, admin_approved_at = now() where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Only the General Manager or an Admin can approve');
  end if;

  select * into r from purchase_requests where id = p_id;
  if r.gm_approved_at is not null and r.admin_approved_at is not null then
    v_cat := case r.category when 'Machine' then 'Machinery' when 'Spare Parts' then 'Maintenance'
                             when 'Fabric' then 'Raw Material' when 'Accessories' then 'Raw Material' else 'Other' end;
    insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, investor_id)
    values (v_cat,
            r.category || ' — ' || r.item || case when r.quantity is not null then ' (' || r.quantity || coalesce(' ' || r.unit, '') || ')' else '' end,
            r.vendor, r.amount, (now() at time zone 'Asia/Kolkata')::date,
            coalesce(r.notes,'') || ' [Purchase request approved by ' || r.gm_approved_by || ' & ' || r.admin_approved_by || ']',
            r.order_id, r.investor_id)
    returning id into v_exp;
    update purchase_requests set status = 'Approved', expenditure_id = v_exp where id = p_id;
  end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function approve_purchase_request(uuid) to authenticated;

create or replace function reject_purchase_request(p_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  if v_role not in ('gm','admin','hr') then
    return json_build_object('ok', false, 'error', 'Only the General Manager or an Admin can reject');
  end if;
  update purchase_requests set status = 'Rejected', rejected_by = v_name, reject_reason = p_reason
  where id = p_id and status = 'Pending';
  return json_build_object('ok', true);
end;
$$;
grant execute on function reject_purchase_request(uuid, text) to authenticated;

-- Investors table is admin-only, so GM/PM get just names through this.
create or replace function investor_names()
returns table (id uuid, name text) language sql security definer set search_path = public stable as $$
  select i.id, i.name from investors i
  where is_gm_pm_or_admin() order by i.name;
$$;
grant execute on function investor_names() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['purchase_requests','inventory_spare_parts','fabric_usage'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
-- Migration 31 — run in Supabase SQL Editor AFTER migration_30.sql
--
-- Purchase request lifecycle after approval:
--   Approved -> Payment to vendor -> Vendor invoice -> Dispatch / transport
--   tracking -> Goods received at factory -> posted into Inventory.

alter table purchase_requests
  add column if not exists paid_at date,
  add column if not exists paid_amount numeric,
  add column if not exists payment_mode text,
  add column if not exists payment_ref text,
  add column if not exists paid_by text,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists invoice_amount numeric,
  add column if not exists invoice_path text,          -- file in the 'bills' bucket
  add column if not exists transporter text,
  add column if not exists tracking_number text,
  add column if not exists dispatch_date date,
  add column if not exists expected_arrival date,
  add column if not exists received_at date,
  add column if not exists received_by text,
  add column if not exists received_qty numeric,
  add column if not exists received_notes text,
  add column if not exists inventory_posted text;       -- what was added to inventory, for the record

-- Vendor invoice files live under bills/vendor-invoices/... ; GM/PM/Admin/HR may upload and read them
drop policy if exists "bills_vendor_insert" on storage.objects;
drop policy if exists "bills_vendor_select" on storage.objects;
create policy "bills_vendor_insert" on storage.objects for insert
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = 'vendor-invoices' and is_gm_pm_or_admin());
create policy "bills_vendor_select" on storage.objects for select
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = 'vendor-invoices' and is_gm_pm_or_admin());

-- Payment / invoice / dispatch updates. p_stage: 'payment' | 'invoice' | 'dispatch'
create or replace function update_purchase_fulfilment(p_id uuid, p_stage text, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; r purchase_requests%rowtype;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Only approved requests can be processed'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Goods already received'); end if;

  if p_stage = 'payment' then
    if v_role not in ('admin','hr') then return json_build_object('ok', false, 'error', 'Only Admin/HR can record payments'); end if;
    update purchase_requests set
      paid_at = (p_data->>'paid_at')::date,
      paid_amount = (p_data->>'paid_amount')::numeric,
      payment_mode = p_data->>'payment_mode',
      payment_ref = nullif(p_data->>'payment_ref',''),
      paid_by = v_name
    where id = p_id;
  elsif p_stage = 'invoice' then
    if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
    update purchase_requests set
      invoice_number = p_data->>'invoice_number',
      invoice_date = nullif(p_data->>'invoice_date','')::date,
      invoice_amount = nullif(p_data->>'invoice_amount','')::numeric,
      invoice_path = coalesce(nullif(p_data->>'invoice_path',''), invoice_path),
      vendor = coalesce(nullif(p_data->>'vendor',''), vendor)
    where id = p_id;
    -- the real invoice amount replaces the estimate in the order's expenditure
    if nullif(p_data->>'invoice_amount','') is not null and r.expenditure_id is not null then
      update expenditures set
        amount = (p_data->>'invoice_amount')::numeric,
        vendor = coalesce(nullif(p_data->>'vendor',''), vendor),
        notes = coalesce(notes,'') || ' [Invoice ' || (p_data->>'invoice_number') || ']'
      where id = r.expenditure_id;
    end if;
  elsif p_stage = 'dispatch' then
    if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
    update purchase_requests set
      transporter = p_data->>'transporter',
      tracking_number = nullif(p_data->>'tracking_number',''),
      dispatch_date = nullif(p_data->>'dispatch_date','')::date,
      expected_arrival = nullif(p_data->>'expected_arrival','')::date
    where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Unknown stage');
  end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function update_purchase_fulfilment(uuid, text, jsonb) to authenticated;

-- Goods receipt: marks the request received AND adds the stock to Inventory in one step.
-- p_inv examples:
--  Fabric:      {"mode":"existing","id":"<fabric id>","kg":50,"meters":200}
--               {"mode":"new","fabric_type":"Single jersey","color":"Navy","weight_gsm":180,"kg":50,"meters":200}
--  Accessories: {"mode":"existing","id":"<item id>","quantity":500}
--               {"mode":"new","category":"Elastic","name":"Elastic 20mm","unit":"m","quantity":500}
--  Machine:     {"model":"JUKI","model_other":null,"machine_type":"Single needle","quantity":2}
--  Spare Parts: {"machine_id":"<id or empty>","part_name":"Motor","quantity":1}
create or replace function receive_purchase_request(p_id uuid, p_received_qty numeric, p_notes text, p_inv jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; r purchase_requests%rowtype; v_msg text := 'No inventory posting (category: Other)';
  v_id uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select name into v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Request is not approved'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Already received'); end if;

  if r.category = 'Fabric' then
    if p_inv->>'mode' = 'existing' then
      update inventory_fabric set
        stock_kg = coalesce(stock_kg,0) + coalesce((p_inv->>'kg')::numeric,0),
        stock_meters = coalesce(stock_meters,0) + coalesce((p_inv->>'meters')::numeric,0)
      where id = (p_inv->>'id')::uuid;
      if not found then return json_build_object('ok', false, 'error', 'Fabric not found'); end if;
    else
      insert into inventory_fabric (fabric_type, color, weight_gsm, stock_kg, stock_meters, supplier)
      values (p_inv->>'fabric_type', nullif(p_inv->>'color',''), nullif(p_inv->>'weight_gsm','')::numeric,
              coalesce((p_inv->>'kg')::numeric,0), coalesce((p_inv->>'meters')::numeric,0), r.vendor);
    end if;
    v_msg := 'Fabric +' || coalesce(p_inv->>'kg','0') || ' kg / ' || coalesce(p_inv->>'meters','0') || ' m';

  elsif r.category = 'Accessories' then
    if p_inv->>'mode' = 'existing' then
      update inventory_items set quantity = coalesce(quantity,0) + coalesce((p_inv->>'quantity')::numeric,0)
      where id = (p_inv->>'id')::uuid;
      if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
    else
      insert into inventory_items (category, name, quantity, unit, notes)
      values (coalesce(nullif(p_inv->>'category',''),'Accessory'), p_inv->>'name',
              coalesce((p_inv->>'quantity')::numeric,0), coalesce(nullif(p_inv->>'unit',''),'pcs'),
              'Received via purchase request');
    end if;
    v_msg := 'Item +' || coalesce(p_inv->>'quantity','0');

  elsif r.category = 'Machine' then
    insert into inventory_machines (model, model_other, machine_type, quantity, working_condition, purchase_date, notes)
    values (coalesce(nullif(p_inv->>'model',''),'OTHER'), nullif(p_inv->>'model_other',''), p_inv->>'machine_type',
            coalesce((p_inv->>'quantity')::integer,1), 'Working', coalesce(r.invoice_date, v_today),
            'Received via purchase request');
    v_msg := 'Machine +' || coalesce(p_inv->>'quantity','1');

  elsif r.category = 'Spare Parts' then
    insert into inventory_spare_parts (machine_id, part_name, quantity, status, supplier, amount, purchase_date, notes)
    values (nullif(p_inv->>'machine_id','')::uuid, p_inv->>'part_name', coalesce((p_inv->>'quantity')::numeric,1),
            'Purchased', r.vendor, coalesce(r.invoice_amount, r.amount), coalesce(r.invoice_date, v_today),
            'Received via purchase request');
    v_msg := 'Spare part +' || coalesce(p_inv->>'quantity','1');
  end if;

  update purchase_requests set
    received_at = v_today, received_by = v_name, received_qty = p_received_qty,
    received_notes = nullif(p_notes,''), inventory_posted = v_msg
  where id = p_id;
  return json_build_object('ok', true, 'posted', v_msg);
end;
$$;
grant execute on function receive_purchase_request(uuid, numeric, text, jsonb) to authenticated;
-- Migration 32 — run in Supabase SQL Editor AFTER migration_31.sql
--
-- Quality module: a Quality Manager inspects an order (stitched count vs cut
-- count, design, colour, print vs sample, and more). Only an approved order
-- can be marked Shipped or have deliveries logged.

-- 1. New role: quality_manager (also fixes invitations so every role can be invited)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager'));

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
  check (intended_role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager'));

create or replace function is_quality_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'quality_manager');
$$ language sql security definer stable;

-- 2. Order-level quality status
alter table orders
  add column if not exists quality_status text not null default 'Not inspected'
    check (quality_status in ('Not inspected','Approved','Rejected')),
  add column if not exists quality_approved_at timestamptz,
  add column if not exists quality_approved_by text;

-- orders already shipped before this feature existed are treated as approved
update orders set quality_status = 'Approved' where status = 'Shipped' and quality_status = 'Not inspected';

-- 3. Inspections (one row per inspection; an order can be re-inspected after a rejection)
create table if not exists quality_inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  decision text not null check (decision in ('Approved','Rejected')),
  checks jsonb not null default '[]',          -- [{key,label,result: Pass|Fail|NA, note}]
  cut_total numeric default 0,
  stitched_total numeric default 0,
  inspected_qty numeric,
  defective_qty numeric,
  photos text[] default '{}',                  -- paths in the 'bills' bucket under quality/
  notes text,
  inspected_by uuid references profiles(id) on delete set null,
  inspected_by_name text,
  created_at timestamptz default now()
);
alter table quality_inspections enable row level security;
drop policy if exists "qi_select" on quality_inspections;
create policy "qi_select" on quality_inspections for select using (auth.role() = 'authenticated');
-- no insert/update policies: inspections are written only through submit_quality_inspection()

-- 4. Cut vs stitched totals for an order (approved cutting vs order progress)
create or replace function order_count_summary(p_order_id uuid)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object(
    'cut', coalesce((select sum(v::numeric) from cutting_entries c, jsonb_each_text(c.sizes) e(k, v)
                     where c.order_id = p_order_id and c.status = 'Approved'), 0),
    'stitched', coalesce((select sum(quantity) from order_progress where order_id = p_order_id), 0)
  );
$$;
grant execute on function order_count_summary(uuid) to authenticated;

-- 5. Submit an inspection
create or replace function submit_quality_inspection(
  p_order_id uuid, p_decision text, p_checks jsonb,
  p_inspected numeric, p_defective numeric, p_notes text, p_photos text[]
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_counts json; v_cut numeric; v_stitched numeric;
  v_checks jsonb := '[]'; c jsonb; v_res text;
begin
  if not is_quality_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Quality Manager can inspect orders');
  end if;
  if p_decision not in ('Approved','Rejected') then
    return json_build_object('ok', false, 'error', 'Invalid decision');
  end if;
  select name into v_name from profiles where id = auth.uid();
  v_counts := order_count_summary(p_order_id);
  v_cut := (v_counts->>'cut')::numeric;
  v_stitched := (v_counts->>'stitched')::numeric;

  -- re-write the count check from the real numbers so it can't be faked
  for c in select * from jsonb_array_elements(p_checks) loop
    v_res := c->>'result';
    if c->>'key' = 'count_match' and v_cut > 0 then
      v_res := case when v_cut = v_stitched then 'Pass' else 'Fail' end;
    end if;
    if v_res not in ('Pass','Fail','NA') then
      return json_build_object('ok', false, 'error', 'Answer every check (Pass / Fail / N/A)');
    end if;
    v_checks := v_checks || jsonb_build_array(jsonb_set(c, '{result}', to_jsonb(v_res)));
  end loop;

  if p_decision = 'Approved' then
    if exists (select 1 from jsonb_array_elements(v_checks) x where x->>'result' = 'Fail') then
      return json_build_object('ok', false, 'error',
        case when v_cut > 0 and v_cut <> v_stitched
             then 'Stitched count (' || v_stitched || ') does not match cut count (' || v_cut || ')'
             else 'A failed check cannot be approved — reject the order or fix the issue and re-inspect' end);
    end if;
  elsif coalesce(trim(p_notes),'') = '' then
    return json_build_object('ok', false, 'error', 'Write the reason for rejecting');
  end if;

  insert into quality_inspections (order_id, decision, checks, cut_total, stitched_total, inspected_qty, defective_qty,
                                   photos, notes, inspected_by, inspected_by_name)
  values (p_order_id, p_decision, v_checks, v_cut, v_stitched, p_inspected, p_defective,
          coalesce(p_photos,'{}'), nullif(p_notes,''), auth.uid(), v_name);

  update orders set quality_status = p_decision,
                    quality_approved_at = case when p_decision = 'Approved' then now() else null end,
                    quality_approved_by = case when p_decision = 'Approved' then v_name else null end
  where id = p_order_id;

  return json_build_object('ok', true);
end;
$$;
grant execute on function submit_quality_inspection(uuid, text, jsonb, numeric, numeric, text, text[]) to authenticated;

-- 6. Gate: no Shipped status and no delivery entries without quality approval
create or replace function block_ship_without_quality()
returns trigger language plpgsql as $$
begin
  if new.status = 'Shipped' and old.status is distinct from 'Shipped' and new.quality_status <> 'Approved' then
    raise exception 'Quality approval is required before this order can be shipped';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_require_quality on orders;
create trigger orders_require_quality before update on orders
  for each row execute procedure block_ship_without_quality();

create or replace function block_delivery_without_quality()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from orders where id = new.order_id and quality_status = 'Approved') then
    raise exception 'Quality approval is required before goods are dispatched for this order';
  end if;
  return new;
end;
$$;
drop trigger if exists deliveries_require_quality on order_deliveries;
create trigger deliveries_require_quality before insert on order_deliveries
  for each row execute procedure block_delivery_without_quality();

-- 7. Inspection photos: bills/quality/<order id>/...
drop policy if exists "bills_quality_insert" on storage.objects;
drop policy if exists "bills_quality_select" on storage.objects;
create policy "bills_quality_insert" on storage.objects for insert
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = 'quality' and is_quality_or_admin());
create policy "bills_quality_select" on storage.objects for select
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = 'quality'
         and (is_quality_or_admin() or is_gm_pm_or_admin()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='quality_inspections') then
    alter publication supabase_realtime add table quality_inspections;
  end if;
end $$;
-- Migration 33 — run in Supabase SQL Editor AFTER migration_32.sql
--
-- Operation-wise output log. This is the data the "Why did output change?"
-- report needs to spot operation bottlenecks and uneven workloads: who did
-- which operation, on which order, and how many pieces.

create or replace function is_tl_or_above()
returns boolean as $$
  select is_gm_pm_or_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'tl');
$$ language sql security definer stable;

create table if not exists operation_output (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  order_id uuid references orders(id) on delete cascade,
  item_description text,
  operation text not null,                       -- e.g. Collar attach, Side seam, Hemming
  employee_id uuid references employees(id) on delete set null,
  quantity numeric not null default 0,
  logged_by text,
  created_at timestamptz default now()
);
create index if not exists operation_output_date_idx on operation_output (work_date);

alter table operation_output enable row level security;
drop policy if exists "op_out_select" on operation_output;
drop policy if exists "op_out_insert" on operation_output;
drop policy if exists "op_out_update" on operation_output;
drop policy if exists "op_out_delete" on operation_output;
create policy "op_out_select" on operation_output for select using (is_tl_or_above());
create policy "op_out_insert" on operation_output for insert with check (is_tl_or_above());
create policy "op_out_update" on operation_output for update using (is_tl_or_above());
create policy "op_out_delete" on operation_output for delete using (is_tl_or_above());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='operation_output') then
    alter publication supabase_realtime add table operation_output;
  end if;
end $$;
-- v30: paid salaries post to Finance -> Expenditures automatically (category "Salary").
-- Run after migration_33.sql. Safe to re-run.

alter table payroll add column if not exists net_pay numeric;
alter table payroll add column if not exists paid_at timestamptz;
alter table expenditures add column if not exists payroll_id uuid references payroll(id) on delete cascade;
create unique index if not exists expenditures_payroll_id_key on expenditures(payroll_id) where payroll_id is not null;

create or replace function sync_payroll_expenditure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  paid_on date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status = 'Paid' and coalesce(new.net_pay, 0) > 0 then
    select name into emp_name from employees where id = new.employee_id;
    if tg_op = 'UPDATE' and old.status = 'Paid' and exists (select 1 from expenditures where payroll_id = new.id) then
      -- already posted: keep the original payment date, refresh the amount
      update expenditures set amount = new.net_pay,
             item = 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee')
       where payroll_id = new.id;
    else
      insert into expenditures (category, item, vendor, amount, expense_date, notes, payroll_id, created_by)
      values ('Salary', 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee'), emp_name, new.net_pay, paid_on,
              'Auto-posted from Payroll when marked paid', new.id, auth.uid())
      on conflict (payroll_id) where payroll_id is not null
      do update set amount = excluded.amount, item = excluded.item;
      update payroll set paid_at = now() where id = new.id and paid_at is null;
    end if;
  else
    -- back to Pending (or zero pay): withdraw the posted salary
    delete from expenditures where payroll_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists payroll_post_expenditure on payroll;
create trigger payroll_post_expenditure after insert or update on payroll
  for each row execute function sync_payroll_expenditure();
-- v31: leave approvals for GM / PM / TL / HR, no self-approval, and auto-link of
-- manager logins to their employee record (needed for self check-in / check-out).
-- Run after migration_34.sql. Safe to re-run.

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Who can SEE and DECIDE a leave request:
--   admin / hr  : everyone
--   gm / pm     : everyone except their own request
--   tl          : people who report to them (employees.reporting_manager_id)
--   anyone      : their own request (to view / cancel while Pending)
drop policy if exists "leave_requests_select" on leave_requests;
create policy "leave_requests_select" on leave_requests for select using (
  is_admin()
  or my_role() in ('gm','pm')
  or employee_id = (select employee_id from profiles where id = auth.uid())
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
);

drop policy if exists "leave_requests_update" on leave_requests;
create policy "leave_requests_update" on leave_requests for update using (
  is_admin()
  or (my_role() in ('gm','pm') and employee_id is distinct from (select employee_id from profiles where id = auth.uid()))
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

-- Nobody approves or rejects their own leave (only the owner/admin login can, as the final authority).
create or replace function block_self_leave_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare my_emp uuid; r text;
begin
  if new.status is distinct from old.status and new.status in ('Approved','Rejected') then
    select employee_id, role into my_emp, r from profiles where id = auth.uid();
    if my_emp is not null and my_emp = new.employee_id and coalesce(r,'') <> 'admin' then
      raise exception 'You cannot approve or reject your own leave request. Ask your manager, GM or Admin.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leave_block_self_review on leave_requests;
create trigger leave_block_self_review before update on leave_requests
  for each row execute function block_self_leave_review();

-- Link GM / PM / TL / HR logins to an employee record when the name matches exactly
-- (one employee, not already linked to another login). Lets them use My Attendance
-- check-in / check-out and raise leave. Anything not matched is listed in the notice.
do $$
declare p record; n int; emp uuid;
begin
  for p in select id, name from profiles
           where role in ('gm','pm','tl','hr') and employee_id is null loop
    select count(*) into n from employees e
      where lower(trim(e.name)) = lower(trim(p.name))
        and not exists (select 1 from profiles x where x.employee_id = e.id);
    if n = 1 then
      select e.id into emp from employees e
        where lower(trim(e.name)) = lower(trim(p.name))
          and not exists (select 1 from profiles x where x.employee_id = e.id);
      update profiles set employee_id = emp where id = p.id;
      raise notice 'Linked login "%" to its employee record', p.name;
    else
      raise notice 'NOT linked (no unique name match): "%". Link it in Payroll -> account column.', p.name;
    end if;
  end loop;
end $$;
-- v32: Vendors (Sales Team) and employee advances for expense claims.
-- Run after migration_35.sql. Safe to re-run.

-- ---------- Vendors ----------
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  supplier_type text not null default 'Fabric',   -- Fabric, Machines, Accessories, Elastic, Threads, ...
  contact_person text,
  designation text,                                -- Owner, Sales Manager, ...
  phone text,
  email text,
  address text,
  gstin text,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table vendors enable row level security;
drop policy if exists "vendors_select" on vendors;
drop policy if exists "vendors_insert" on vendors;
drop policy if exists "vendors_update" on vendors;
drop policy if exists "vendors_delete" on vendors;
create policy "vendors_select" on vendors for select using (is_admin() or my_role() in ('gm','pm','sales'));
create policy "vendors_insert" on vendors for insert with check (is_admin() or my_role() in ('gm','pm','sales'));
create policy "vendors_update" on vendors for update using (is_admin() or my_role() in ('gm','pm','sales'));
create policy "vendors_delete" on vendors for delete using (is_admin() or my_role() in ('gm','pm'));

-- ---------- Advances given to employees ----------
create table if not exists employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  amount numeric not null check (amount > 0),
  given_date date not null default current_date,
  purpose text not null default 'Travel',          -- Travel, Marketing, Purchase, Other
  payment_mode text,
  linked_order_id uuid references orders(id) on delete set null,
  notes text,
  returned_amount numeric not null default 0,       -- unspent cash handed back
  status text not null default 'Open' check (status in ('Open','Settled')),
  given_by uuid references profiles(id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz default now()
);
alter table employee_advances enable row level security;
drop policy if exists "advances_select" on employee_advances;
drop policy if exists "advances_write" on employee_advances;
create policy "advances_select" on employee_advances for select using (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);
create policy "advances_write" on employee_advances for all using (is_admin()) with check (is_admin());

-- ---------- Claims: paid from advance or own money ----------
alter table expense_claims add column if not exists paid_from text not null default 'Own money';
alter table expense_claims drop constraint if exists expense_claims_paid_from_check;
alter table expense_claims add constraint expense_claims_paid_from_check check (paid_from in ('Own money','Advance'));
alter table expense_claims add column if not exists advance_id uuid references employee_advances(id) on delete set null;

-- A claim paid from an advance must come from the claimant's own open advance and fit in what is left.
create or replace function check_claim_advance() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record; spent numeric;
begin
  if new.paid_from <> 'Advance' then
    new.advance_id := null;
    return new;
  end if;
  if new.status = 'Rejected' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'Rejected' and new.advance_id is not distinct from old.advance_id
     and new.amount = old.amount and new.paid_from = old.paid_from then
    return new;   -- status moves only (Approved, Reimbursed, ...)
  end if;
  if new.advance_id is null then raise exception 'Choose which advance this expense is paid from.'; end if;
  select * into a from employee_advances where id = new.advance_id;
  if not found or a.employee_id <> new.employee_id then raise exception 'That advance does not belong to this employee.'; end if;
  if a.status <> 'Open' then raise exception 'That advance is already settled.'; end if;
  select coalesce(sum(amount), 0) into spent from expense_claims
    where advance_id = new.advance_id and status <> 'Rejected' and id <> new.id;
  if a.amount - a.returned_amount - spent < new.amount then
    raise exception 'Only Rs. % is left in that advance. Submit the rest as "Own money".', (a.amount - a.returned_amount - spent);
  end if;
  return new;
end $$;
drop trigger if exists claim_advance_check on expense_claims;
create trigger claim_advance_check before insert or update on expense_claims
  for each row execute function check_claim_advance();

-- Finance ledger: own-money claims post when Reimbursed (company pays the employee back);
-- advance claims post when Approved (the cash already left the company as the advance, so
-- the advance itself is NOT an expense - only what was actually spent is).
create or replace function sync_reimbursed_expense_to_expenditure() returns trigger as $$
begin
  if (new.status = 'Reimbursed' and new.paid_from = 'Own money')
     or (new.status in ('Approved','Reimbursed') and new.paid_from = 'Advance') then
    if not exists (select 1 from expenditures where source_claim_id = new.id) then
      insert into expenditures (category, item, amount, expense_date, notes, linked_order_id, source_claim_id)
      values (
        'Other',
        'Sales expense - ' || new.category || coalesce(' (' || new.transport_mode || ')', '') ||
          case when new.paid_from = 'Advance' then ' [from advance]' else '' end,
        new.amount, new.expense_date,
        coalesce(new.description, 'Sales/field expense'),
        new.linked_order_id, new.id);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

do $$ begin alter publication supabase_realtime add table employee_advances; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table vendors; exception when others then null; end $$;
-- v33: choose which investor funds a salary. Run after migration_36.sql. Safe to re-run.
alter table payroll add column if not exists investor_id uuid references investors(id) on delete set null;

create or replace function sync_payroll_expenditure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  paid_on date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status = 'Paid' and coalesce(new.net_pay, 0) > 0 then
    select name into emp_name from employees where id = new.employee_id;
    if tg_op = 'UPDATE' and old.status = 'Paid' and exists (select 1 from expenditures where payroll_id = new.id) then
      update expenditures set amount = new.net_pay, investor_id = new.investor_id,
             item = 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee')
       where payroll_id = new.id;
    else
      insert into expenditures (category, item, vendor, amount, expense_date, notes, payroll_id, investor_id, created_by)
      values ('Salary', 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee'), emp_name, new.net_pay, paid_on,
              'Auto-posted from Payroll when marked paid', new.id, new.investor_id, auth.uid())
      on conflict (payroll_id) where payroll_id is not null
      do update set amount = excluded.amount, item = excluded.item, investor_id = excluded.investor_id;
      update payroll set paid_at = now() where id = new.id and paid_at is null;
    end if;
  else
    delete from expenditures where payroll_id = new.id;
  end if;
  return null;
end $$;

-- Back-fill: salaries already posted before this update keep "no investor" until you pick one in Payroll.
-- v34: daily workforce per order, delay RCA gate, customer agreement link, customer feedback link.
-- Run after migration_37.sql. Safe to re-run.

-- ================= 1. Who worked on which order on a day =================
-- Combines Manpower assignments (Orders -> people icon) and the Operation log.
-- Labour cost = employee's daily wage (monthly base / days in month), split across the orders the
-- person worked on that day. Wages are only returned to Admin / HR; everyone else gets NULL.
create or replace function daily_order_workforce(p_date date)
returns table(order_id uuid, employee_id uuid, employee_name text, employee_role text, wage_share numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_admin boolean := is_admin();
begin
  if not (is_tl_or_above() or v_admin) then raise exception 'Not allowed'; end if;
  return query
  with pairs as (
    select l.order_id, l.employee_id from order_labor l where l.work_date = p_date
    union
    select o.order_id, o.employee_id from operation_output o
      where o.work_date = p_date and o.order_id is not null and o.employee_id is not null
  ), cnt as (select pairs.employee_id, count(*) as n from pairs group by pairs.employee_id)
  select p.order_id, p.employee_id, e.name, e.role,
         case when v_admin then round((coalesce(e.base_salary, 0)
              / extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))) / c.n, 2)
              else null end
  from pairs p join employees e on e.id = p.employee_id join cnt c on c.employee_id = p.employee_id;
end $$;
grant execute on function daily_order_workforce(date) to authenticated;

-- ================= 2. Delay RCA + lessons learned =================
create table if not exists order_delay_rca (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  causes jsonb not null default '[]',      -- [{cause, days, notes}]
  root_cause text not null,
  lessons_learned text not null,
  corrective_action text,
  days_late integer,
  submitted_by uuid references profiles(id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz default now()
);
alter table order_delay_rca enable row level security;
drop policy if exists "rca_select" on order_delay_rca;
drop policy if exists "rca_insert" on order_delay_rca;
drop policy if exists "rca_update" on order_delay_rca;
drop policy if exists "rca_delete" on order_delay_rca;
create policy "rca_select" on order_delay_rca for select using (is_admin() or is_tl_or_above() or my_role() = 'quality_manager');
create policy "rca_insert" on order_delay_rca for insert with check (is_admin() or my_role() in ('gm','pm','tl'));
create policy "rca_update" on order_delay_rca for update using (is_admin() or my_role() in ('gm','pm','tl'));
create policy "rca_delete" on order_delay_rca for delete using (is_admin());

-- An order past its due date cannot move to Completed / Shipped until the RCA is on file.
create or replace function block_late_completion_without_rca() returns trigger
language plpgsql security definer set search_path = public as $$
declare today_ist date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status in ('Completed','Shipped') and old.status is distinct from new.status
     and old.status not in ('Completed','Shipped')
     and new.due_date is not null and new.due_date < today_ist
     and not exists (select 1 from order_delay_rca r where r.order_id = new.id) then
    raise exception 'This order is past its due date. Submit the delay RCA and lessons learned before completing it.';
  end if;
  return new;
end $$;
drop trigger if exists orders_require_rca on orders;
create trigger orders_require_rca before update on orders
  for each row execute function block_late_completion_without_rca();

-- ================= 3. Customer agreement (agree / disagree link) =================
alter table orders add column if not exists agreement_status text not null default 'Not sent';
alter table orders drop constraint if exists orders_agreement_status_check;
alter table orders add constraint orders_agreement_status_check check (agreement_status in ('Not sent','Sent','Agreed','Disagreed'));
alter table orders add column if not exists agreement_sent_at timestamptz;
alter table orders add column if not exists agreement_responded_at timestamptz;
alter table orders add column if not exists agreement_responder text;
alter table orders add column if not exists agreement_comment text;
alter table orders add column if not exists feedback_sent_at timestamptz;

create or replace function public_agreement(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o record; a record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  select * into a from order_agreements where order_id = o.id order by created_at desc limit 1;
  return json_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name, 'order_date', o.order_date,
    'due_date', o.due_date, 'agreement_status', o.agreement_status, 'responded_at', o.agreement_responded_at,
    'responder', o.agreement_responder,
    'items', (select coalesce(json_agg(json_build_object(
        'description', it->>'description', 'quantity', (it->>'quantity')::numeric,
        'rate', (select (r->>'rate')::numeric from jsonb_array_elements(coalesce(a.item_rates,'[]'::jsonb)) r where r->>'description' = it->>'description' limit 1)
      )), '[]'::json) from jsonb_array_elements(o.items) it),
    'terms', case when a.id is null then null else json_build_object(
        'gst_percent', a.gst_percent, 'advance_pct', a.advance_pct, 'before_dispatch_pct', a.before_dispatch_pct,
        'balance_pct', a.balance_pct, 'balance_days', a.balance_days, 'transportation', a.transportation,
        'unclaimed_goods_days', a.unclaimed_goods_days) end
  );
end $$;

create or replace function public_agreement_respond(p_order_number text, p_tracking_code text, p_decision text, p_name text, p_comment text)
returns json language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if p_decision not in ('Agreed','Disagreed') then return json_build_object('ok', false, 'error', 'bad_decision'); end if;
  if o.agreement_status <> 'Sent' then return json_build_object('ok', false, 'error', 'not_open', 'status', o.agreement_status); end if;
  if length(trim(coalesce(p_name,''))) < 2 then return json_build_object('ok', false, 'error', 'name_required'); end if;
  if p_decision = 'Disagreed' and length(trim(coalesce(p_comment,''))) < 3 then return json_build_object('ok', false, 'error', 'comment_required'); end if;
  update orders set agreement_status = p_decision, agreement_responded_at = now(),
         agreement_responder = left(trim(p_name), 120), agreement_comment = nullif(left(trim(coalesce(p_comment,'')), 1000), '')
   where id = o.id;
  return json_build_object('ok', true, 'status', p_decision);
end $$;
grant execute on function public_agreement(text, text) to anon, authenticated;
grant execute on function public_agreement_respond(text, text, text, text, text) to anon, authenticated;

-- ================= 4. Customer feedback =================
create table if not exists order_feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  ratings jsonb not null default '{}',     -- {fabric_quality: 1-5, ...}
  delivery_timing text,                    -- On time / Slightly delayed / Very delayed
  would_reorder text,                      -- Yes / Maybe / No
  issues text,
  comments text,
  respondent_name text,
  submitted_at timestamptz default now()
);
alter table order_feedback enable row level security;
drop policy if exists "feedback_select" on order_feedback;
drop policy if exists "feedback_delete" on order_feedback;
create policy "feedback_select" on order_feedback for select using (is_admin() or is_tl_or_above() or my_role() = 'quality_manager');
create policy "feedback_delete" on order_feedback for delete using (is_admin());

create or replace function public_feedback_status(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  return json_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'status', o.status,
    'open', o.status in ('Completed','Shipped'),
    'already_submitted', exists (select 1 from order_feedback f where f.order_id = o.id));
end $$;

create or replace function public_feedback_submit(p_order_number text, p_tracking_code text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o record; k text; v numeric; r jsonb := '{}'::jsonb;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status not in ('Completed','Shipped') then return json_build_object('ok', false, 'error', 'not_open'); end if;
  if exists (select 1 from order_feedback where order_id = o.id) then return json_build_object('ok', false, 'error', 'already_submitted'); end if;
  for k in select jsonb_object_keys(coalesce(p_payload->'ratings','{}'::jsonb)) loop
    v := (p_payload->'ratings'->>k)::numeric;
    if v between 1 and 5 and k ~ '^[a-z_]{1,40}$' then r := r || jsonb_build_object(k, v); end if;
  end loop;
  if r = '{}'::jsonb then return json_build_object('ok', false, 'error', 'no_ratings'); end if;
  insert into order_feedback (order_id, ratings, delivery_timing, would_reorder, issues, comments, respondent_name)
  values (o.id, r, left(p_payload->>'delivery_timing', 40), left(p_payload->>'would_reorder', 20),
          nullif(left(p_payload->>'issues', 1500), ''), nullif(left(p_payload->>'comments', 1500), ''),
          nullif(left(p_payload->>'respondent_name', 120), ''));
  return json_build_object('ok', true);
end $$;
grant execute on function public_feedback_status(text, text) to anon, authenticated;
grant execute on function public_feedback_submit(text, text, jsonb) to anon, authenticated;

do $$ begin alter publication supabase_realtime add table order_delay_rca; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table order_feedback; exception when others then null; end $$;
-- v35: access changes, invoice balances, inactive employees, resource allocation access,
-- inventory prices + materials issued to orders, and the actual order cost.
-- Run after migration_38.sql. Safe to re-run.

-- ================= 1. Access control =================
-- Finance-admin = Admin only (HR is no longer a finance user).
create or replace function is_finance_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

do $$
declare r record;
begin
  -- invoices: Admin only (GM and HR lose access; previously any signed-in user could read them)
  for r in select policyname from pg_policies where schemaname='public' and tablename='invoices' loop
    execute format('drop policy %I on invoices', r.policyname);
  end loop;
  create policy "invoices_finance_admin" on invoices for all using (is_finance_admin()) with check (is_finance_admin());

  -- other financial tables: Admin only
  for r in select tablename, policyname from pg_policies where schemaname='public'
           and tablename in ('investors','investments','order_finance','loans','loan_payments','order_payments') loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
  create policy "investors_finance_admin" on investors for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "investments_finance_admin" on investments for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "order_finance_finance_admin" on order_finance for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "loans_finance_admin" on loans for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "loan_payments_finance_admin" on loan_payments for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "order_payments_finance_admin" on order_payments for all using (is_finance_admin()) with check (is_finance_admin());

  -- inventory: everyone signed in can read; only Admin / HR can edit (GM and PM are view-only)
  for r in select tablename, policyname from pg_policies where schemaname='public'
           and tablename in ('inventory_machines','inventory_fabric','inventory_items','inventory_spare_parts')
           and cmd <> 'SELECT' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
  create policy "inv_machines_write" on inventory_machines for all using (is_admin()) with check (is_admin());
  create policy "inv_fabric_write" on inventory_fabric for all using (is_admin()) with check (is_admin());
  create policy "inv_items_write" on inventory_items for all using (is_admin()) with check (is_admin());
  create policy "inv_parts_write" on inventory_spare_parts for all using (is_admin()) with check (is_admin());

  -- manpower allocation (no wages in this table): Team Lead and above can read / allocate
  for r in select policyname from pg_policies where schemaname='public' and tablename='order_labor' loop
    execute format('drop policy %I on order_labor', r.policyname);
  end loop;
  create policy "order_labor_tl_select" on order_labor for select using (is_tl_or_above());
  create policy "order_labor_tl_insert" on order_labor for insert with check (is_tl_or_above());
  create policy "order_labor_tl_update" on order_labor for update using (is_tl_or_above());
  create policy "order_labor_tl_delete" on order_labor for delete using (is_tl_or_above());
end $$;

-- ================= 2. Invoice balance + automatic Paid =================
alter table invoices add column if not exists paid_auto boolean not null default false;

-- Payments logged against an order are applied to its invoices oldest-first. An invoice covered in
-- full becomes Paid; if a payment is later removed, invoices that were auto-marked Paid revert.
create or replace function recompute_invoice_status(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pool numeric; inv record; share numeric;
begin
  if p_order is null then return; end if;
  select coalesce(sum(amount), 0) into pool from order_payments where order_id = p_order;
  for inv in select id, amount, status, paid_auto from invoices
             where linked_order_id = p_order order by issue_date nulls last, created_at, id loop
    share := least(pool, coalesce(inv.amount, 0));
    pool := pool - share;
    if coalesce(inv.amount, 0) > 0 and share >= inv.amount then
      if inv.status <> 'Paid' then update invoices set status = 'Paid', paid_auto = true where id = inv.id; end if;
    elsif inv.paid_auto and inv.status = 'Paid' then
      update invoices set status = 'Unpaid', paid_auto = false where id = inv.id;
    end if;
  end loop;
end $$;

create or replace function trg_payment_invoice_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform recompute_invoice_status(old.order_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform recompute_invoice_status(new.order_id); end if;
  return null;
end $$;
drop trigger if exists payments_sync_invoices on order_payments;
create trigger payments_sync_invoices after insert or update or delete on order_payments
  for each row execute function trg_payment_invoice_sync();

create or replace function trg_invoice_payment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_invoice_status(new.linked_order_id);
  return null;
end $$;
drop trigger if exists invoices_sync_payments on invoices;
create trigger invoices_sync_payments after insert or update of amount, linked_order_id on invoices
  for each row execute function trg_invoice_payment_sync();

-- one-off: apply to everything that already exists
do $$ declare o uuid; begin
  for o in select distinct linked_order_id from invoices where linked_order_id is not null loop
    perform recompute_invoice_status(o);
  end loop;
end $$;

-- ================= 3. Inactive employees =================
alter table employees add column if not exists status text not null default 'Active';
alter table employees drop constraint if exists employees_status_check;
alter table employees add constraint employees_status_check check (status in ('Active','Inactive'));
alter table employees add column if not exists inactive_since date;
alter table employees add column if not exists inactive_reason text;
alter table employees add column if not exists reactivated_at date;

-- Anyone with no attendance record at all for 30 days becomes Inactive (people who joined or were
-- re-activated less than 30 days ago are left alone). Run by Admin / HR when they open Employees.
create or replace function deactivate_stale_employees() returns json
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; names text[];
begin
  if not is_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  with moved as (
    update employees e set status = 'Inactive', inactive_since = today,
           inactive_reason = 'No attendance marked for 30 days'
    where e.status = 'Active'
      and greatest(coalesce(e.join_date, date '1900-01-01'), coalesce(e.reactivated_at, date '1900-01-01'),
                   (e.created_at at time zone 'Asia/Kolkata')::date) <= today - 30
      and not exists (select 1 from attendance a where a.employee_id = e.id and a.date > today - 30)
    returning e.name)
  select coalesce(array_agg(name), '{}') into names from moved;
  return json_build_object('ok', true, 'count', coalesce(array_length(names, 1), 0), 'names', names);
end $$;
grant execute on function deactivate_stale_employees() to authenticated;

create or replace function set_employee_active(p_id uuid, p_active boolean) returns json
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_admin() then return json_build_object('ok', false, 'error', 'Only HR or Admin can change this'); end if;
  if p_active then
    update employees set status = 'Active', inactive_since = null, inactive_reason = null, reactivated_at = today where id = p_id;
  else
    update employees set status = 'Inactive', inactive_since = today, inactive_reason = 'Made inactive by HR / Admin' where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function set_employee_active(uuid, boolean) to authenticated;

-- ================= 4. Prices in inventory + materials issued to orders =================
alter table inventory_fabric add column if not exists price_per_kg numeric;
alter table inventory_fabric add column if not exists price_per_meter numeric;
alter table inventory_items add column if not exists unit_price numeric;
alter table fabric_usage add column if not exists price_per_kg numeric;
alter table fabric_usage add column if not exists price_per_meter numeric;

-- the price in force when the fabric was cut is kept on the usage row
create or replace function snapshot_fabric_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fabric_id is not null and new.price_per_kg is null and new.price_per_meter is null then
    select f.price_per_kg, f.price_per_meter into new.price_per_kg, new.price_per_meter from inventory_fabric f where f.id = new.fabric_id;
  end if;
  return new;
end $$;
drop trigger if exists fabric_usage_price on fabric_usage;
create trigger fabric_usage_price before insert on fabric_usage for each row execute function snapshot_fabric_price();

create table if not exists order_material_usage (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  category text,
  unit text,
  quantity numeric not null check (quantity > 0),
  unit_price numeric,
  used_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  used_by text,
  notes text,
  returned boolean not null default false,
  created_at timestamptz default now()
);
alter table order_material_usage enable row level security;
drop policy if exists "material_usage_select" on order_material_usage;
create policy "material_usage_select" on order_material_usage for select
  using (is_admin() or is_tl_or_above() or my_role() = 'cutting_master');

create or replace function issue_material_to_order(p_order uuid, p_item uuid, p_qty numeric, p_notes text default null)
returns json language plpgsql security definer set search_path = public as $$
declare it inventory_items%rowtype; who text;
begin
  if not (is_admin() or is_tl_or_above() or my_role() = 'cutting_master') then
    return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  if p_qty is null or p_qty <= 0 then return json_build_object('ok', false, 'error', 'Enter a quantity'); end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
  if coalesce(it.quantity, 0) < p_qty then
    return json_build_object('ok', false, 'error', 'Only ' || coalesce(it.quantity, 0) || ' ' || coalesce(it.unit, '') || ' in stock'); end if;
  select name into who from profiles where id = auth.uid();
  update inventory_items set quantity = quantity - p_qty where id = p_item;
  insert into order_material_usage (order_id, item_id, item_name, category, unit, quantity, unit_price, used_by, notes)
  values (p_order, p_item, it.name, it.category, it.unit, p_qty, it.unit_price, who, nullif(p_notes, ''));
  return json_build_object('ok', true);
end $$;
grant execute on function issue_material_to_order(uuid, uuid, numeric, text) to authenticated;

create or replace function return_material_usage(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare u order_material_usage%rowtype;
begin
  if not (is_admin() or is_tl_or_above() or my_role() = 'cutting_master') then
    return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select * into u from order_material_usage where id = p_id for update;
  if not found or u.returned then return json_build_object('ok', false, 'error', 'Nothing to return'); end if;
  if u.item_id is not null then update inventory_items set quantity = quantity + u.quantity where id = u.item_id; end if;
  update order_material_usage set returned = true where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function return_material_usage(uuid) to authenticated;

-- Goods received from a purchase request also set the stock price (weighted average with what is in stock).
create or replace function receive_purchase_request(p_id uuid, p_received_qty numeric, p_notes text, p_inv jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; r purchase_requests%rowtype; v_msg text := 'No inventory posting (category: Other)';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_amt numeric; v_kg numeric; v_m numeric; v_q numeric; f inventory_fabric%rowtype; it inventory_items%rowtype;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select name into v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Request is not approved'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Already received'); end if;
  v_amt := coalesce(r.invoice_amount, r.amount);

  if r.category = 'Fabric' then
    v_kg := coalesce((p_inv->>'kg')::numeric, 0); v_m := coalesce((p_inv->>'meters')::numeric, 0);
    if p_inv->>'mode' = 'existing' then
      select * into f from inventory_fabric where id = (p_inv->>'id')::uuid for update;
      if not found then return json_build_object('ok', false, 'error', 'Fabric not found'); end if;
      update inventory_fabric set
        stock_kg = coalesce(stock_kg,0) + v_kg,
        stock_meters = coalesce(stock_meters,0) + v_m,
        price_per_kg = case when v_kg > 0 and v_amt > 0 then round((coalesce(f.stock_kg,0) * coalesce(f.price_per_kg,0) + v_amt) / (coalesce(f.stock_kg,0) + v_kg), 2) else price_per_kg end,
        price_per_meter = case when v_m > 0 and v_kg = 0 and v_amt > 0 then round((coalesce(f.stock_meters,0) * coalesce(f.price_per_meter,0) + v_amt) / (coalesce(f.stock_meters,0) + v_m), 2) else price_per_meter end
      where id = f.id;
    else
      insert into inventory_fabric (fabric_type, color, weight_gsm, stock_kg, stock_meters, supplier, price_per_kg, price_per_meter)
      values (p_inv->>'fabric_type', nullif(p_inv->>'color',''), nullif(p_inv->>'weight_gsm','')::numeric, v_kg, v_m, r.vendor,
              case when v_kg > 0 and v_amt > 0 then round(v_amt / v_kg, 2) end,
              case when v_m > 0 and v_kg = 0 and v_amt > 0 then round(v_amt / v_m, 2) end);
    end if;
    v_msg := 'Fabric +' || coalesce(p_inv->>'kg','0') || ' kg / ' || coalesce(p_inv->>'meters','0') || ' m';

  elsif r.category = 'Accessories' then
    v_q := coalesce((p_inv->>'quantity')::numeric, 0);
    if p_inv->>'mode' = 'existing' then
      select * into it from inventory_items where id = (p_inv->>'id')::uuid for update;
      if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
      update inventory_items set quantity = coalesce(quantity,0) + v_q,
        unit_price = case when v_q > 0 and v_amt > 0 then round((coalesce(it.quantity,0) * coalesce(it.unit_price,0) + v_amt) / (coalesce(it.quantity,0) + v_q), 4) else unit_price end
      where id = it.id;
    else
      insert into inventory_items (category, name, quantity, unit, notes, unit_price)
      values (coalesce(nullif(p_inv->>'category',''),'Accessory'), p_inv->>'name', v_q, coalesce(nullif(p_inv->>'unit',''),'pcs'),
              'Received via purchase request', case when v_q > 0 and v_amt > 0 then round(v_amt / v_q, 4) end);
    end if;
    v_msg := 'Item +' || coalesce(p_inv->>'quantity','0');

  elsif r.category = 'Machine' then
    insert into inventory_machines (model, model_other, machine_type, quantity, working_condition, purchase_date, notes)
    values (coalesce(nullif(p_inv->>'model',''),'OTHER'), nullif(p_inv->>'model_other',''), p_inv->>'machine_type',
            coalesce((p_inv->>'quantity')::integer,1), 'Working', coalesce(r.invoice_date, v_today), 'Received via purchase request');
    v_msg := 'Machine +' || coalesce(p_inv->>'quantity','1');

  elsif r.category = 'Spare Parts' then
    insert into inventory_spare_parts (machine_id, part_name, quantity, status, supplier, amount, purchase_date, notes)
    values (nullif(p_inv->>'machine_id','')::uuid, p_inv->>'part_name', coalesce((p_inv->>'quantity')::numeric,1),
            'Purchased', r.vendor, v_amt, coalesce(r.invoice_date, v_today), 'Received via purchase request');
    v_msg := 'Spare part +' || coalesce(p_inv->>'quantity','1');
  end if;

  update purchase_requests set received_at = v_today, received_by = v_name, received_qty = p_received_qty,
    received_notes = nullif(p_notes,''), inventory_posted = v_msg where id = p_id;
  return json_build_object('ok', true, 'posted', v_msg);
end $$;
grant execute on function receive_purchase_request(uuid, numeric, text, jsonb) to authenticated;

-- ================= 5. Actual cost of an order (Admin only) =================
-- fabric used x inventory price + trims/thread/elastic issued x inventory price
-- + expenditures tagged to the order (transport, printing, packing, ...) + manpower.
-- Fabric / accessory purchase requests are NOT added again: they are already priced through the stock used.
create or replace function order_actual_cost(p_order uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare fabric json; mats json; other json; crew json; stocked json;
        t_fabric numeric; t_mats numeric; t_other numeric; t_transport numeric; t_crew numeric; unpriced int;
begin
  if not is_finance_admin() then raise exception 'Not allowed'; end if;

  select coalesce(json_agg(x order by x.cut_date), '[]'::json), coalesce(sum(x.cost), 0) into fabric, t_fabric from (
    select u.created_at::date as cut_date, f.fabric_type, f.color, u.kg_used, u.meters_used,
           coalesce(u.price_per_kg, f.price_per_kg) as price_per_kg, coalesce(u.price_per_meter, f.price_per_meter) as price_per_meter,
           coalesce(u.kg_used,0) * coalesce(u.price_per_kg, f.price_per_kg, 0)
             + coalesce(u.meters_used,0) * coalesce(u.price_per_meter, f.price_per_meter, 0) as cost
    from fabric_usage u left join inventory_fabric f on f.id = u.fabric_id
    where u.order_id = p_order and u.restored = false) x;

  select coalesce(json_agg(x order by x.used_on), '[]'::json), coalesce(sum(x.cost), 0) into mats, t_mats from (
    select m.used_on, m.item_name, m.category, m.unit, m.quantity, m.unit_price, m.quantity * coalesce(m.unit_price, 0) as cost
    from order_material_usage m where m.order_id = p_order and not m.returned) x;

  select coalesce(json_agg(x order by x.expense_date), '[]'::json), coalesce(sum(x.amount), 0),
         coalesce(sum(x.amount) filter (where x.category = 'Transport'), 0) into other, t_other, t_transport from (
    select e.expense_date, e.category, e.item, e.vendor, e.amount from expenditures e
    where e.linked_order_id = p_order and e.category <> 'Salary'
      and not exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x), '[]'::json) into stocked from (
    select e.expense_date, e.item, e.amount from expenditures e
    where e.linked_order_id = p_order
      and exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x order by x.work_date, x.name), '[]'::json), coalesce(sum(x.cost), 0) into crew, t_crew from (
    select e.name, l.work_date,
           round((coalesce(e.base_salary,0) / extract(day from (date_trunc('month', l.work_date) + interval '1 month - 1 day')))
                 / (select count(distinct l2.order_id) from order_labor l2 where l2.employee_id = l.employee_id and l2.work_date = l.work_date), 2) as cost
    from order_labor l join employees e on e.id = l.employee_id where l.order_id = p_order) x;

  select (select count(*) from json_array_elements(fabric) r where coalesce((r->>'cost')::numeric,0) = 0)
       + (select count(*) from json_array_elements(mats) r where coalesce((r->>'unit_price')::numeric,0) = 0) into unpriced;

  return json_build_object('fabric', fabric, 'materials', mats, 'other', other, 'stock_purchases', stocked, 'crew', crew,
    'totals', json_build_object('fabric', t_fabric, 'materials', t_mats, 'other', t_other, 'transport', t_transport, 'manpower', t_crew,
                                'total', t_fabric + t_mats + t_other + t_crew),
    'unpriced_lines', unpriced);
end $$;
grant execute on function order_actual_cost(uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table order_material_usage; exception when others then null; end $$;


-- ===== migration_40.sql (v36: CRM leads, commission) =====
-- v36: CRM & Sales — Lead -> Customer -> Order -> Commission.
-- Run after migration_39.sql. Safe to re-run.

-- ---------------------------------------------------------------- helpers
create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from profiles where id = auth.uid()
$$;

-- admin / hr / gm / pm : see every lead
create or replace function is_sales_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','hr','gm','pm'))
$$;

-- admin / gm / pm : see every order value and commission (HR has no financial access)
create or replace function is_sales_finance_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','gm','pm'))
$$;

-- ---------------------------------------------------------------- leads
create sequence if not exists lead_seq start 1;

create table if not exists sales_leads (
  id uuid primary key default gen_random_uuid(),
  lead_number text unique default ('LD-' || lpad(nextval('lead_seq')::text, 4, '0')),
  company_name text not null,
  lead_type text not null default 'Other',          -- School, Hospital, Company, Retailer, Other
  contact_person text,
  designation text,
  phone text,
  email text,
  address text,
  salesperson_id uuid references employees(id) on delete set null,
  lead_source text,
  first_visit_date date,
  estimated_value numeric not null default 0,
  quotation_value numeric not null default 0,
  expected_order_date date,
  status text not null default 'New',
  lost_reason text,
  customer_id uuid references sales_customers(id) on delete set null,
  next_followup_date date,
  last_activity_at timestamptz,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table sales_leads drop constraint if exists sales_leads_status_check;
alter table sales_leads add constraint sales_leads_status_check
  check (status in ('New','Contacted','Interested','Quotation Sent','Won','Lost'));
create index if not exists sales_leads_salesperson_idx on sales_leads (salesperson_id);

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references sales_leads(id) on delete cascade,
  kind text not null default 'Visit',                -- Visit, Call, WhatsApp, Email, Meeting, Quotation, Note
  activity_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  location text,
  contact_person text,
  requirements text,
  notes text,
  quotation_value numeric,
  customer_response text,
  expected_order_date date,
  next_followup_date date,
  logged_by text,
  created_at timestamptz default now()
);
alter table lead_activities drop constraint if exists lead_activities_kind_check;
alter table lead_activities add constraint lead_activities_kind_check
  check (kind in ('Visit','Call','WhatsApp','Email','Meeting','Quotation','Note'));
create index if not exists lead_activities_lead_idx on lead_activities (lead_id, activity_date desc);

-- a new activity keeps the lead's follow-up date / quotation / status up to date
create or replace function lead_activity_roll_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_leads l set
    last_activity_at = now(),
    next_followup_date = case when new.kind = 'Note' then l.next_followup_date else new.next_followup_date end,
    quotation_value = coalesce(new.quotation_value, l.quotation_value),
    expected_order_date = coalesce(new.expected_order_date, l.expected_order_date),
    first_visit_date = coalesce(l.first_visit_date, case when new.kind = 'Visit' then new.activity_date end),
    status = case
      when l.status in ('Won','Lost') then l.status
      when new.kind = 'Quotation' or new.quotation_value is not null then 'Quotation Sent'
      when l.status = 'New' and new.kind <> 'Note' then 'Contacted'
      else l.status end
  where l.id = new.lead_id;
  return null;
end $$;
drop trigger if exists lead_activity_roll_up_trg on lead_activities;
create trigger lead_activity_roll_up_trg after insert on lead_activities
  for each row execute function lead_activity_roll_up();

alter table sales_leads enable row level security;
alter table lead_activities enable row level security;

drop policy if exists "leads_select" on sales_leads;
drop policy if exists "leads_insert" on sales_leads;
drop policy if exists "leads_update" on sales_leads;
drop policy if exists "leads_delete" on sales_leads;
create policy "leads_select" on sales_leads for select using (is_sales_manager() or salesperson_id = my_employee_id() or created_by = auth.uid());
create policy "leads_insert" on sales_leads for insert with check (is_sales_manager() or salesperson_id = my_employee_id());
create policy "leads_update" on sales_leads for update using (is_sales_manager() or salesperson_id = my_employee_id())
  with check (is_sales_manager() or salesperson_id = my_employee_id());
create policy "leads_delete" on sales_leads for delete using (is_sales_manager());

drop policy if exists "lead_act_select" on lead_activities;
drop policy if exists "lead_act_insert" on lead_activities;
drop policy if exists "lead_act_delete" on lead_activities;
create policy "lead_act_select" on lead_activities for select using (
  exists (select 1 from sales_leads l where l.id = lead_id and (is_sales_manager() or l.salesperson_id = my_employee_id())));
create policy "lead_act_insert" on lead_activities for insert with check (
  exists (select 1 from sales_leads l where l.id = lead_id and (is_sales_manager() or l.salesperson_id = my_employee_id())));
create policy "lead_act_delete" on lead_activities for delete using (is_sales_manager());

-- ---------------------------------------------------------------- order <-> salesperson link
-- Kept apart from `orders` (readable by all staff) so order values stay private.
create table if not exists order_sales (
  order_id uuid primary key references orders(id) on delete cascade,
  lead_id uuid references sales_leads(id) on delete set null,
  customer_id uuid references sales_customers(id) on delete set null,
  salesperson_id uuid references employees(id) on delete set null,
  order_value numeric not null default 0,
  created_at timestamptz default now()
);
create index if not exists order_sales_sp_idx on order_sales (salesperson_id);
create index if not exists order_sales_lead_idx on order_sales (lead_id);
alter table order_sales enable row level security;
drop policy if exists "order_sales_select" on order_sales;
create policy "order_sales_select" on order_sales for select using (
  is_sales_finance_viewer() or salesperson_id = my_employee_id());
-- no write policies: written only through convert_lead_to_order() / set_order_sales()

-- ---------------------------------------------------------------- commission
create table if not exists commission_settings (
  id int primary key default 1 check (id = 1),
  threshold numeric not null default 500000,
  rate_pct numeric not null default 1,
  period text not null default 'month',      -- month | quarter | year | all
  basis text not null default 'completed',   -- completed (executed orders only) | confirmed (every confirmed order)
  updated_at timestamptz default now()
);
insert into commission_settings (id) values (1) on conflict do nothing;
alter table commission_settings drop constraint if exists commission_settings_period_check;
alter table commission_settings add constraint commission_settings_period_check check (period in ('month','quarter','year','all'));
alter table commission_settings drop constraint if exists commission_settings_basis_check;
alter table commission_settings add constraint commission_settings_basis_check check (basis in ('completed','confirmed'));
alter table commission_settings enable row level security;
drop policy if exists "comm_settings_select" on commission_settings;
create policy "comm_settings_select" on commission_settings for select using (auth.role() = 'authenticated');

create table if not exists sales_commissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references orders(id) on delete set null,   -- one commission per order: no duplicate payment
  salesperson_id uuid references employees(id) on delete set null,
  period_key text not null,
  order_number text,
  customer_name text,
  order_value numeric not null default 0,
  rate_pct numeric not null default 1,
  amount numeric not null default 0,
  status text not null default 'Pending',
  approved_by text, approved_at timestamptz,
  paid_by text, paid_at timestamptz,
  note text,
  created_at timestamptz default now()
);
alter table sales_commissions drop constraint if exists sales_commissions_status_check;
alter table sales_commissions add constraint sales_commissions_status_check check (status in ('Pending','Approved','Paid'));
create index if not exists sales_commissions_sp_idx on sales_commissions (salesperson_id, period_key);
alter table sales_commissions enable row level security;
drop policy if exists "sales_comm_select" on sales_commissions;
create policy "sales_comm_select" on sales_commissions for select using (
  is_sales_finance_viewer() or salesperson_id = my_employee_id());

-- paid commission posts to Finance -> Expenditures (category Commission), once
alter table expenditures add column if not exists commission_id uuid references sales_commissions(id) on delete set null;
create unique index if not exists expenditures_commission_id_key on expenditures(commission_id) where commission_id is not null;

-- period bucket (Indian financial year: Apr-Mar)
create or replace function commission_period_key(d date, per text) returns text
language sql immutable as $$
  select case per
    when 'month' then to_char(d, 'YYYY-MM')
    when 'quarter' then 'FY' || (case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int
         || '-Q' || (case when extract(month from d) between 4 and 6 then 1 when extract(month from d) between 7 and 9 then 2
                          when extract(month from d) between 10 and 12 then 3 else 4 end)
    when 'year' then 'FY' || (case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int
    else 'all' end
$$;

-- Order value used for commission: the agreed order value, else what has been invoiced for it.
create or replace function commission_order_value(p_order uuid, p_value numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p_value, 0), (select sum(amount) from invoices where linked_order_id = p_order), 0)
$$;

-- Recalculate one salesperson's commission rows.
--   * the salesperson's orders in a period are COMBINED (3 x 2 lakh = 6 lakh);
--   * the period total must EXCEED the threshold (5,00,000);
--   * then every order in that period earns rate% (1% of 6 lakh = 6,000).
-- Approved / Paid rows are never changed or removed.
create or replace function refresh_commissions_for(p_sp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s commission_settings%rowtype;
begin
  if p_sp is null then return; end if;
  select * into s from commission_settings where id = 1;

  create temp table if not exists _comm_elig (order_id uuid, period_key text, val numeric, order_number text, customer_name text) on commit drop;
  delete from _comm_elig where true;
  insert into _comm_elig
  select o.id, commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period),
         commission_order_value(o.id, os.order_value), o.order_number, o.customer_name
  from order_sales os join orders o on o.id = os.order_id
  where os.salesperson_id = p_sp
    and (s.basis = 'confirmed' or o.status in ('Completed','Shipped'));

  -- pending rows that no longer qualify
  delete from sales_commissions c
   where c.salesperson_id = p_sp and c.status = 'Pending'
     and (c.order_id is null or not exists (
            select 1 from _comm_elig e
             where e.order_id = c.order_id and e.val > 0
               and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold));

  insert into sales_commissions (order_id, salesperson_id, period_key, order_number, customer_name, order_value, rate_pct, amount)
  select e.order_id, p_sp, e.period_key, e.order_number, e.customer_name, e.val, s.rate_pct, round(e.val * s.rate_pct / 100, 2)
    from _comm_elig e
   where e.val > 0 and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold
  on conflict (order_id) do update
     set period_key = excluded.period_key, order_number = excluded.order_number, customer_name = excluded.customer_name,
         order_value = excluded.order_value, rate_pct = excluded.rate_pct, amount = excluded.amount
   where sales_commissions.status = 'Pending' and sales_commissions.salesperson_id = p_sp;
end $$;

create or replace function refresh_all_commissions() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct salesperson_id from order_sales where salesperson_id is not null loop
    perform refresh_commissions_for(r.salesperson_id);
  end loop;
end $$;
grant execute on function refresh_all_commissions() to authenticated;

create or replace function trg_order_sales_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform refresh_commissions_for(old.salesperson_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform refresh_commissions_for(new.salesperson_id); end if;
  return null;
end $$;
drop trigger if exists order_sales_refresh on order_sales;
create trigger order_sales_refresh after insert or update or delete on order_sales
  for each row execute function trg_order_sales_refresh();

create or replace function trg_order_status_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp uuid;
begin
  select salesperson_id into sp from order_sales where order_id = new.id;
  if sp is not null then perform refresh_commissions_for(sp); end if;
  return null;
end $$;
drop trigger if exists order_status_commission on orders;
create trigger order_status_commission after update of status, order_date on orders
  for each row execute function trg_order_status_commission();

-- settings (admin only); changing them re-prices pending commissions
create or replace function set_commission_settings(p_threshold numeric, p_rate numeric, p_period text, p_basis text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_finance_admin() then return jsonb_build_object('ok', false, 'error', 'Only the admin can change commission rules.'); end if;
  if p_threshold is null or p_threshold < 0 or p_rate is null or p_rate < 0 or p_rate > 100 then
    return jsonb_build_object('ok', false, 'error', 'Check the threshold and rate.');
  end if;
  update commission_settings set threshold = p_threshold, rate_pct = p_rate, period = p_period, basis = p_basis, updated_at = now() where id = 1;
  -- pending rows are rebuilt under the new rule; approved / paid rows stay as they were
  delete from sales_commissions where status = 'Pending';
  perform refresh_all_commissions();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_commission_settings(numeric, numeric, text, text) to authenticated;

-- approve / pay / reopen commission rows (admin only). Paid rows are final.
create or replace function commission_set_status(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; who text; paid_on date := (now() at time zone 'Asia/Kolkata')::date; sp_name text;
begin
  if not is_finance_admin() then return jsonb_build_object('ok', false, 'error', 'Only the admin can approve or pay commission.'); end if;
  if p_status not in ('Pending','Approved','Paid') then return jsonb_build_object('ok', false, 'error', 'Unknown status.'); end if;
  select name into who from profiles where id = auth.uid();
  for r in select * from sales_commissions where id = any(p_ids) for update loop
    if r.status = 'Paid' then continue; end if;                       -- never pay twice / never undo a payment
    if p_status = 'Paid' and r.status <> 'Approved' then continue; end if;   -- must be approved first
    if p_status = 'Approved' and r.status <> 'Pending' then continue; end if;
    if p_status = 'Pending' and r.status <> 'Approved' then continue; end if;
    if p_status = 'Approved' then
      update sales_commissions set status = 'Approved', approved_by = who, approved_at = now(), note = coalesce(p_note, note) where id = r.id;
    elsif p_status = 'Paid' then
      update sales_commissions set status = 'Paid', paid_by = who, paid_at = now(), note = coalesce(p_note, note) where id = r.id;
      select name into sp_name from employees where id = r.salesperson_id;
      insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, commission_id, created_by)
      values ('Commission', 'Sales commission ' || coalesce(r.order_number, '') || ' - ' || coalesce(sp_name, 'salesperson'),
              sp_name, r.amount, paid_on, 'Auto-posted when commission was marked paid (' || r.period_key || ')', r.order_id, r.id, auth.uid())
      on conflict (commission_id) where commission_id is not null do nothing;
    else
      update sales_commissions set status = 'Pending', approved_by = null, approved_at = null where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;
grant execute on function commission_set_status(uuid[], text, text) to authenticated;

-- threshold progress: one row per salesperson per period
create or replace function commission_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s commission_settings%rowtype; out jsonb;
begin
  select * into s from commission_settings where id = 1;
  if not (is_sales_finance_viewer() or my_employee_id() is not null) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.period_key desc, t.salesperson_name), '[]'::jsonb) into out from (
    select os.salesperson_id,
           (select name from employees where id = os.salesperson_id) as salesperson_name,
           commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period) as period_key,
           count(*) as orders,
           sum(commission_order_value(o.id, os.order_value)) as confirmed_value,
           sum(case when o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as executed_value,
           sum(case when s.basis = 'confirmed' or o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as counted_value,
           s.threshold, s.rate_pct, s.period, s.basis
      from order_sales os join orders o on o.id = os.order_id
     where os.salesperson_id is not null
       and (is_sales_finance_viewer() or os.salesperson_id = my_employee_id())
     group by os.salesperson_id, 3, s.threshold, s.rate_pct, s.period, s.basis
  ) t;
  return out;
end $$;
grant execute on function commission_progress() to authenticated;

-- ---------------------------------------------------------------- link an order to a salesperson / lead
create or replace function set_order_sales(p_order uuid, p_salesperson uuid, p_value numeric, p_lead uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (is_pm_or_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'gm')) then
    return jsonb_build_object('ok', false, 'error', 'Only Admin, HR, GM or PM can link an order to a salesperson.');
  end if;
  if p_salesperson is null and coalesce(p_value, 0) = 0 and p_lead is null then
    delete from order_sales where order_id = p_order;
    return jsonb_build_object('ok', true);
  end if;
  insert into order_sales (order_id, salesperson_id, order_value, lead_id, customer_id)
  values (p_order, p_salesperson, coalesce(p_value, 0), p_lead, (select customer_id from sales_leads where id = p_lead))
  on conflict (order_id) do update
     set salesperson_id = excluded.salesperson_id, order_value = excluded.order_value,
         lead_id = coalesce(excluded.lead_id, order_sales.lead_id),
         customer_id = coalesce(excluded.customer_id, order_sales.customer_id);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_order_sales(uuid, uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------- convert a lead into customer + order
create or replace function convert_lead_to_order(p_lead uuid, p_items jsonb, p_order_value numeric, p_due_date date, p_order_number text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; cid uuid; oid uuid; onum text; n int; today date := (now() at time zone 'Asia/Kolkata')::date; who text;
begin
  select * into l from sales_leads where id = p_lead for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Lead not found.'); end if;
  if not (is_sales_manager() or l.salesperson_id = my_employee_id()) then
    return jsonb_build_object('ok', false, 'error', 'You can only convert your own leads.');
  end if;
  if l.status = 'Lost' then return jsonb_build_object('ok', false, 'error', 'This lead is marked Lost. Re-open it first.'); end if;
  if l.salesperson_id is null then return jsonb_build_object('ok', false, 'error', 'Assign a salesperson to the lead first, so the order and commission are linked to someone.'); end if;
  if coalesce(p_order_value, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter the order value.'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Add at least one item to the order.');
  end if;

  cid := l.customer_id;
  if cid is null then
    insert into sales_customers (name, location, contact_person, contact_number, notes, created_by)
    values (l.company_name, l.address, l.contact_person, l.phone, 'Converted from lead ' || l.lead_number, auth.uid())
    returning id into cid;
  end if;

  if p_order_number is not null and length(trim(p_order_number)) > 0 then
    onum := trim(p_order_number);
    if exists (select 1 from orders where order_number = onum) then return jsonb_build_object('ok', false, 'error', 'Order number ' || onum || ' already exists.'); end if;
  else
    select count(*) + 1 into n from orders;
    loop
      onum := 'ORD-' || lpad(n::text, 4, '0');
      exit when not exists (select 1 from orders where order_number = onum);
      n := n + 1;
    end loop;
  end if;

  insert into orders (order_number, customer_name, items, order_date, due_date, status)
  values (onum, l.company_name, p_items, today, p_due_date, 'Not Started')
  returning id into oid;

  insert into order_sales (order_id, lead_id, customer_id, salesperson_id, order_value)
  values (oid, l.id, cid, l.salesperson_id, p_order_value);

  update sales_leads set status = 'Won', customer_id = cid, lost_reason = null, next_followup_date = null where id = l.id;
  select name into who from profiles where id = auth.uid();
  insert into lead_activities (lead_id, kind, activity_date, notes, quotation_value, logged_by)
  values (l.id, 'Note', today, 'Order confirmed: ' || onum || ' for ' || p_order_value::text, null, who);
  return jsonb_build_object('ok', true, 'order_id', oid, 'order_number', onum, 'customer_id', cid);
end $$;
grant execute on function convert_lead_to_order(uuid, jsonb, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------- order tracking for the CRM
-- Confirmation -> production -> delivery -> invoice -> payment. Amounts only for the admin.
create or replace function sales_order_tracking() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb; fin boolean := is_finance_admin();
begin
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_date desc nulls last, t.order_number desc), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.order_date, o.due_date, o.status,
           l.lead_number, os.lead_id, os.salesperson_id, e.name as salesperson_name,
           commission_order_value(o.id, os.order_value) as order_value,
           coalesce((select sum(nullif(i->>'quantity','')::numeric) from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i), 0) as ordered_qty,
           coalesce((select sum(quantity) from order_deliveries d where d.order_id = o.id), 0) as delivered_qty,
           case when fin then (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) end as invoiced,
           case when fin then (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) end as received,
           case
             when (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) = 0 then 'Not invoiced'
             when (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) >= (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) then 'Paid'
             when (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) > 0 then 'Part paid'
             else 'Invoiced' end as invoice_state,
           (select status from sales_commissions c where c.order_id = o.id) as commission_status,
           (select amount from sales_commissions c where c.order_id = o.id) as commission_amount
      from order_sales os
      join orders o on o.id = os.order_id
      left join sales_leads l on l.id = os.lead_id
      left join employees e on e.id = os.salesperson_id
     where is_sales_finance_viewer() or os.salesperson_id = my_employee_id()
  ) t;
  return out;
end $$;
grant execute on function sales_order_tracking() to authenticated;

-- the actual-cost report counts commission paid on an order as an order expense automatically
-- (it is an order-linked expenditure), no extra change needed.

-- first run: price any existing links (none yet) — safe no-op
select refresh_all_commissions();

revoke execute on function refresh_commissions_for(uuid) from public, anon, authenticated;
-- v37: new login type "Finance" (Finance & Accounts access). Run after migration_40.sql. Safe to re-run.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance'));

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
  check (intended_role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance'));

-- Admin and Finance: invoices, investors, investments, loans, payments, order costing, actual cost
create or replace function is_finance_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','finance'))
$$;

-- tables that were guarded by is_admin() (admin + hr): let Finance in as well
drop policy if exists "expenditures_finance_role" on expenditures;
create policy "expenditures_finance_role" on expenditures for all using (my_role() = 'finance') with check (my_role() = 'finance');
drop policy if exists "advances_finance_role" on employee_advances;
create policy "advances_finance_role" on employee_advances for all using (my_role() = 'finance') with check (my_role() = 'finance');
drop policy if exists "claims_finance_select" on expense_claims;
create policy "claims_finance_select" on expense_claims for select using (my_role() = 'finance');

-- the commission RULES stay with the Admin only (paying commission is allowed for Finance)
create or replace function set_commission_settings(p_threshold numeric, p_rate numeric, p_period text, p_basis text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Only the admin can change commission rules.'); end if;
  if p_threshold is null or p_threshold < 0 or p_rate is null or p_rate < 0 or p_rate > 100 then
    return jsonb_build_object('ok', false, 'error', 'Check the threshold and rate.');
  end if;
  update commission_settings set threshold = p_threshold, rate_pct = p_rate, period = p_period, basis = p_basis, updated_at = now() where id = 1;
  delete from sales_commissions where status = 'Pending';
  perform refresh_all_commissions();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_commission_settings(numeric, numeric, text, text) to authenticated;

-- investor names for the "Funded by" pickers (non-admin users cannot read the investors table directly)
create or replace function investor_names()
returns table (id uuid, name text) language sql security definer set search_path = public stable as $$
  select i.id, i.name from investors i
  where is_gm_pm_or_admin() or my_role() = 'finance' order by i.name;
$$;
grant execute on function investor_names() to authenticated;

-- ===== v38 (migration_42) =====
-- v38: lead -> order -> agreement -> Won flow, purchase approval chain (GM -> Finance -> Admin),
--      best performer of the day, and the "DELETE requires a WHERE clause" fix. Run after migration_41.sql. Safe to re-run.

-- ============ 1. Fix: Supabase blocks DELETE without WHERE (hit when linking an order to a salesperson) ============
create or replace function refresh_commissions_for(p_sp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s commission_settings%rowtype;
begin
  if p_sp is null then return; end if;
  select * into s from commission_settings where id = 1;

  create temp table if not exists _comm_elig (order_id uuid, period_key text, val numeric, order_number text, customer_name text) on commit drop;
  delete from _comm_elig where true;
  insert into _comm_elig
  select o.id, commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period),
         commission_order_value(o.id, os.order_value), o.order_number, o.customer_name
  from order_sales os join orders o on o.id = os.order_id
  where os.salesperson_id = p_sp
    and (s.basis = 'confirmed' or o.status in ('Completed','Shipped'));

  -- pending rows that no longer qualify
  delete from sales_commissions c
   where c.salesperson_id = p_sp and c.status = 'Pending'
     and (c.order_id is null or not exists (
            select 1 from _comm_elig e
             where e.order_id = c.order_id and e.val > 0
               and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold));

  insert into sales_commissions (order_id, salesperson_id, period_key, order_number, customer_name, order_value, rate_pct, amount)
  select e.order_id, p_sp, e.period_key, e.order_number, e.customer_name, e.val, s.rate_pct, round(e.val * s.rate_pct / 100, 2)
    from _comm_elig e
   where e.val > 0 and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold
  on conflict (order_id) do update
     set period_key = excluded.period_key, order_number = excluded.order_number, customer_name = excluded.customer_name,
         order_value = excluded.order_value, rate_pct = excluded.rate_pct, amount = excluded.amount
   where sales_commissions.status = 'Pending' and sales_commissions.salesperson_id = p_sp;
end $$;

-- ============ 2. Lead -> Order -> Agreement -> Won ============
alter table sales_leads drop constraint if exists sales_leads_status_check;
alter table sales_leads add constraint sales_leads_status_check
  check (status in ('New','Contacted','Interested','Quotation Sent','Order Created','Won','Lost'));

-- the order created from a lead stays linked to it until the customer agrees
alter table orders add column if not exists lead_id uuid references sales_leads(id) on delete set null;
alter table orders add column if not exists sales_order_value numeric;
create index if not exists orders_lead_idx on orders (lead_id);

-- an activity must not pull an 'Order Created' lead back to an earlier stage
create or replace function lead_activity_roll_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_leads l set
    last_activity_at = now(),
    next_followup_date = case when new.kind = 'Note' then l.next_followup_date else new.next_followup_date end,
    quotation_value = coalesce(new.quotation_value, l.quotation_value),
    expected_order_date = coalesce(new.expected_order_date, l.expected_order_date),
    first_visit_date = coalesce(l.first_visit_date, case when new.kind = 'Visit' then new.activity_date end),
    status = case
      when l.status in ('Won','Lost','Order Created') then l.status
      when new.kind = 'Quotation' or new.quotation_value is not null then 'Quotation Sent'
      when l.status = 'New' and new.kind <> 'Note' then 'Contacted'
      else l.status end
  where l.id = new.lead_id;
  return null;
end $$;

-- next number in the Orders module sequence (same rule the Orders screen uses)
create or replace function next_order_number() returns text
language plpgsql stable security definer set search_path = public as $$
declare n int; onum text;
begin
  select count(*) + 1 into n from orders;
  loop
    onum := 'ORD-' || lpad(n::text, 4, '0');
    exit when not exists (select 1 from orders where order_number = onum);
    n := n + 1;
  end loop;
  return onum;
end $$;
grant execute on function next_order_number() to authenticated;

-- Convert: creates the order in Orders (Production Management), linked to the lead. The lead moves to
-- 'Order Created'. It becomes Won, and the order appears in Sales Orders, only when the customer agrees.
create or replace function convert_lead_to_order(p_lead uuid, p_items jsonb, p_order_value numeric, p_due_date date, p_order_number text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; oid uuid; onum text; today date := (now() at time zone 'Asia/Kolkata')::date; who text;
begin
  select * into l from sales_leads where id = p_lead for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Lead not found.'); end if;
  if not (is_sales_manager() or l.salesperson_id = my_employee_id()) then
    return jsonb_build_object('ok', false, 'error', 'You can only convert your own leads.');
  end if;
  if l.status = 'Lost' then return jsonb_build_object('ok', false, 'error', 'This lead is marked Lost. Re-open it first.'); end if;
  if l.status not in ('Interested','Quotation Sent','Order Created','Won') then
    return jsonb_build_object('ok', false, 'error', 'Move the lead to Interested before converting it to an order.');
  end if;
  if l.salesperson_id is null then return jsonb_build_object('ok', false, 'error', 'Assign a salesperson to the lead first, so the order and commission are linked to someone.'); end if;
  if coalesce(p_order_value, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter the order value.'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Add at least one item to the order.');
  end if;

  if p_order_number is not null and length(trim(p_order_number)) > 0 then
    onum := trim(p_order_number);
    if exists (select 1 from orders where order_number = onum) then return jsonb_build_object('ok', false, 'error', 'Order number ' || onum || ' already exists.'); end if;
  else
    onum := next_order_number();
  end if;

  insert into orders (order_number, customer_name, items, order_date, due_date, status, lead_id, sales_order_value)
  values (onum, l.company_name, p_items, today, p_due_date, 'Not Started', l.id, p_order_value)
  returning id into oid;

  if l.status <> 'Won' then
    update sales_leads set status = 'Order Created', lost_reason = null, next_followup_date = null where id = l.id;
  end if;
  select name into who from profiles where id = auth.uid();
  insert into lead_activities (lead_id, kind, activity_date, notes, quotation_value, logged_by)
  values (l.id, 'Note', today, 'Order ' || onum || ' created in Orders for ' || p_order_value::text || '. Waiting for the customer to agree.', null, who);
  return jsonb_build_object('ok', true, 'order_id', oid, 'order_number', onum);
end $$;
grant execute on function convert_lead_to_order(uuid, jsonb, numeric, date, text) to authenticated;

-- Open the agreement for the customer (also usable by the lead's salesperson, who cannot edit Orders directly)
create or replace function send_order_agreement(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Order not found.'); end if;
  if not (is_pm_or_admin() or my_role() = 'gm' or is_sales_manager()
          or exists (select 1 from sales_leads l where l.id = o.lead_id and l.salesperson_id = my_employee_id())) then
    return jsonb_build_object('ok', false, 'error', 'Not allowed.');
  end if;
  update orders set agreement_status = 'Sent', agreement_sent_at = now(), agreement_responded_at = null,
         agreement_responder = null, agreement_comment = null where id = p_order;
  return jsonb_build_object('ok', true, 'tracking_code', o.tracking_code);
end $$;
grant execute on function send_order_agreement(uuid) to authenticated;

-- Customer answer -> lead status. Agreed: customer is created, the order is added to Sales Orders
-- (commission starts counting) and the lead is Won. Disagreed: noted on the lead, which stays 'Order Created'.
create or replace function trg_order_agreement_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; cid uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.lead_id is null or new.agreement_status is not distinct from old.agreement_status then return null; end if;
  select * into l from sales_leads where id = new.lead_id for update;
  if not found then return null; end if;

  if new.agreement_status = 'Agreed' then
    cid := l.customer_id;
    if cid is null then
      insert into sales_customers (name, location, contact_person, contact_number, notes, created_by)
      values (l.company_name, l.address, l.contact_person, l.phone, 'From lead ' || l.lead_number, l.created_by)
      returning id into cid;
    end if;
    insert into order_sales (order_id, lead_id, customer_id, salesperson_id, order_value)
    values (new.id, l.id, cid, l.salesperson_id, coalesce(new.sales_order_value, 0))
    on conflict (order_id) do nothing;
    update sales_leads set status = 'Won', customer_id = cid, lost_reason = null, next_followup_date = null where id = l.id;
    insert into lead_activities (lead_id, kind, activity_date, notes, logged_by)
    values (l.id, 'Note', today, 'Customer agreed to order ' || new.order_number || '. Lead won; order added to Sales Orders.', coalesce(new.agreement_responder, 'Customer'));
  elsif new.agreement_status = 'Disagreed' then
    insert into lead_activities (lead_id, kind, activity_date, notes, logged_by)
    values (l.id, 'Note', today, 'Customer did not agree to order ' || new.order_number || coalesce(': ' || new.agreement_comment, '.'), coalesce(new.agreement_responder, 'Customer'));
  end if;
  return null;
end $$;
drop trigger if exists orders_agreement_lead on orders;
create trigger orders_agreement_lead after update of agreement_status on orders
  for each row execute function trg_order_agreement_lead();

-- ============ 3. Purchase requests: GM -> Finance -> Admin ============
alter table purchase_requests add column if not exists finance_approved_by text;
alter table purchase_requests add column if not exists finance_approved_at timestamptz;
-- requests already fully or admin-approved before this change count as Finance-approved
update purchase_requests set finance_approved_by = coalesce(admin_approved_by, 'earlier approval'), finance_approved_at = admin_approved_at
 where admin_approved_at is not null and finance_approved_at is null;

drop policy if exists "pr_select" on purchase_requests;
create policy "pr_select" on purchase_requests for select using (is_gm_pm_or_admin() or my_role() = 'finance');

create or replace function approve_purchase_request(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; r purchase_requests%rowtype; v_exp uuid; v_cat text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Pending' then return json_build_object('ok', false, 'error', 'Request is already ' || r.status); end if;

  if v_role = 'gm' then
    if r.gm_approved_at is not null then return json_build_object('ok', false, 'error', 'The General Manager has already approved'); end if;
    update purchase_requests set gm_approved_by = v_name, gm_approved_at = now() where id = p_id;
  elsif v_role = 'finance' then
    if r.gm_approved_at is null then return json_build_object('ok', false, 'error', 'The General Manager must approve first'); end if;
    if r.finance_approved_at is not null then return json_build_object('ok', false, 'error', 'Finance has already approved'); end if;
    update purchase_requests set finance_approved_by = v_name, finance_approved_at = now() where id = p_id;
  elsif v_role in ('admin','hr') then
    if r.finance_approved_at is null then return json_build_object('ok', false, 'error', 'Finance must approve before the Admin'); end if;
    if r.admin_approved_at is not null then return json_build_object('ok', false, 'error', 'The Admin has already approved'); end if;
    update purchase_requests set admin_approved_by = v_name, admin_approved_at = now() where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Only the General Manager, Finance or an Admin can approve');
  end if;

  select * into r from purchase_requests where id = p_id;
  if r.gm_approved_at is not null and r.finance_approved_at is not null and r.admin_approved_at is not null then
    v_cat := case r.category when 'Machine' then 'Machinery' when 'Spare Parts' then 'Maintenance'
                             when 'Fabric' then 'Raw Material' when 'Accessories' then 'Raw Material' else 'Other' end;
    insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, investor_id)
    values (v_cat,
            r.category || ' — ' || r.item || case when r.quantity is not null then ' (' || r.quantity || coalesce(' ' || r.unit, '') || ')' else '' end,
            r.vendor, r.amount, (now() at time zone 'Asia/Kolkata')::date,
            coalesce(r.notes,'') || ' [Purchase request approved by ' || r.gm_approved_by || ', ' || r.finance_approved_by || ' & ' || r.admin_approved_by || ']',
            r.order_id, r.investor_id)
    returning id into v_exp;
    update purchase_requests set status = 'Approved', expenditure_id = v_exp where id = p_id;
  end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function approve_purchase_request(uuid) to authenticated;

create or replace function reject_purchase_request(p_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  if v_role not in ('gm','finance','admin','hr') then
    return json_build_object('ok', false, 'error', 'Only the General Manager, Finance or an Admin can reject');
  end if;
  update purchase_requests set status = 'Rejected', rejected_by = v_name, reject_reason = p_reason
  where id = p_id and status = 'Pending';
  return json_build_object('ok', true);
end;
$$;
grant execute on function reject_purchase_request(uuid, text) to authenticated;

-- ============ 4. Best performer of the day (floor display) ============
-- Top operators by pieces logged in Production -> Output for the day. Callable by anyone signed in,
-- because the floor display is open to every role.
create or replace function best_performer_today(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.pieces desc, x.name) from (
      select e.name, sum(o.quantity) as pieces, count(distinct o.operation) as operations
        from operation_output o join employees e on e.id = o.employee_id
       where o.work_date = d and o.quantity > 0
       group by e.id, e.name
       order by sum(o.quantity) desc, e.name limit 3) x
  ), '[]'::jsonb);
end $$;
grant execute on function best_performer_today(date) to authenticated;

-- ===== v41 (migration_43) =====
-- v41: AI Factory Manager. Run after migration_42.sql. Safe to re-run.

-- Scheduled AI reports (written by the server with the service key; read in the app)
create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- morning | midday | evening | weekly | monthly
  title text not null,
  body text not null,
  data jsonb,                               -- structured daily report (evening run)
  audience text not null default 'managers' check (audience in ('managers','admin')),
  report_date date,
  created_at timestamptz default now()
);
alter table ai_reports enable row level security;
drop policy if exists "ai_reports_read" on ai_reports;
create policy "ai_reports_read" on ai_reports for select
  using (my_role() = 'admin' or (audience = 'managers' and my_role() in ('gm','pm')));
drop policy if exists "ai_reports_delete" on ai_reports;
create policy "ai_reports_delete" on ai_reports for delete using (my_role() = 'admin');

-- Numbers allowed to use the AI manager on WhatsApp (digits only, with country code, e.g. 919876543210)
create table if not exists ai_whatsapp_users (
  phone text primary key check (phone ~ '^[0-9]{8,15}$'),
  name text not null,
  role text not null default 'pm' check (role in ('admin','gm','pm')),
  receive_reports boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table ai_whatsapp_users enable row level security;
drop policy if exists "ai_whatsapp_users_admin" on ai_whatsapp_users;
create policy "ai_whatsapp_users_admin" on ai_whatsapp_users for all using (my_role() = 'admin') with check (my_role() = 'admin');

create table if not exists ai_whatsapp_log (
  message_id text primary key,
  phone text,
  question text,
  answer text,
  created_at timestamptz default now()
);
alter table ai_whatsapp_log enable row level security;
drop policy if exists "ai_whatsapp_log_admin" on ai_whatsapp_log;
create policy "ai_whatsapp_log_admin" on ai_whatsapp_log for select using (my_role() = 'admin');

-- Versions of two existing functions without the signed-in-user check, callable ONLY with the service key
-- (used by scheduled reports and WhatsApp, where nobody is signed in).
create or replace function order_actual_cost_internal(p_order uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare fabric json; mats json; other json; crew json; stocked json;
        t_fabric numeric; t_mats numeric; t_other numeric; t_transport numeric; t_crew numeric; unpriced int;
begin

  select coalesce(json_agg(x order by x.cut_date), '[]'::json), coalesce(sum(x.cost), 0) into fabric, t_fabric from (
    select u.created_at::date as cut_date, f.fabric_type, f.color, u.kg_used, u.meters_used,
           coalesce(u.price_per_kg, f.price_per_kg) as price_per_kg, coalesce(u.price_per_meter, f.price_per_meter) as price_per_meter,
           coalesce(u.kg_used,0) * coalesce(u.price_per_kg, f.price_per_kg, 0)
             + coalesce(u.meters_used,0) * coalesce(u.price_per_meter, f.price_per_meter, 0) as cost
    from fabric_usage u left join inventory_fabric f on f.id = u.fabric_id
    where u.order_id = p_order and u.restored = false) x;

  select coalesce(json_agg(x order by x.used_on), '[]'::json), coalesce(sum(x.cost), 0) into mats, t_mats from (
    select m.used_on, m.item_name, m.category, m.unit, m.quantity, m.unit_price, m.quantity * coalesce(m.unit_price, 0) as cost
    from order_material_usage m where m.order_id = p_order and not m.returned) x;

  select coalesce(json_agg(x order by x.expense_date), '[]'::json), coalesce(sum(x.amount), 0),
         coalesce(sum(x.amount) filter (where x.category = 'Transport'), 0) into other, t_other, t_transport from (
    select e.expense_date, e.category, e.item, e.vendor, e.amount from expenditures e
    where e.linked_order_id = p_order and e.category <> 'Salary'
      and not exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x), '[]'::json) into stocked from (
    select e.expense_date, e.item, e.amount from expenditures e
    where e.linked_order_id = p_order
      and exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x order by x.work_date, x.name), '[]'::json), coalesce(sum(x.cost), 0) into crew, t_crew from (
    select e.name, l.work_date,
           round((coalesce(e.base_salary,0) / extract(day from (date_trunc('month', l.work_date) + interval '1 month - 1 day')))
                 / (select count(distinct l2.order_id) from order_labor l2 where l2.employee_id = l.employee_id and l2.work_date = l.work_date), 2) as cost
    from order_labor l join employees e on e.id = l.employee_id where l.order_id = p_order) x;

  select (select count(*) from json_array_elements(fabric) r where coalesce((r->>'cost')::numeric,0) = 0)
       + (select count(*) from json_array_elements(mats) r where coalesce((r->>'unit_price')::numeric,0) = 0) into unpriced;

  return json_build_object('fabric', fabric, 'materials', mats, 'other', other, 'stock_purchases', stocked, 'crew', crew,
    'totals', json_build_object('fabric', t_fabric, 'materials', t_mats, 'other', t_other, 'transport', t_transport, 'manpower', t_crew,
                                'total', t_fabric + t_mats + t_other + t_crew),
    'unpriced_lines', unpriced);
end $$;
grant execute on function order_actual_cost_internal(uuid) to service_role;
revoke execute on function order_actual_cost_internal(uuid) from public, anon, authenticated;

create or replace function commission_progress_internal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s commission_settings%rowtype; out jsonb;
begin
  select * into s from commission_settings where id = 1;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.period_key desc, t.salesperson_name), '[]'::jsonb) into out from (
    select os.salesperson_id,
           (select name from employees where id = os.salesperson_id) as salesperson_name,
           commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period) as period_key,
           count(*) as orders,
           sum(commission_order_value(o.id, os.order_value)) as confirmed_value,
           sum(case when o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as executed_value,
           sum(case when s.basis = 'confirmed' or o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as counted_value,
           s.threshold, s.rate_pct, s.period, s.basis
      from order_sales os join orders o on o.id = os.order_id
     where os.salesperson_id is not null
       and (is_sales_finance_viewer() or os.salesperson_id = my_employee_id())
     group by os.salesperson_id, 3, s.threshold, s.rate_pct, s.period, s.basis
  ) t;
  return out;
end $$;
grant execute on function commission_progress_internal() to service_role;
revoke execute on function commission_progress_internal() from public, anon, authenticated;
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
-- migration_45.sql — v48: day-by-day stitching history per cutting entry. Run after migration_44.sql. Safe to run twice.
create table if not exists cutting_stitch_log (
  id uuid primary key default gen_random_uuid(),
  cutting_entry_id uuid not null references cutting_entries(id) on delete cascade,
  log_date date not null,
  sizes jsonb not null default '{}',      -- pieces stitched on THIS day, per size
  note text,
  logged_by text,
  created_at timestamptz default now()
);
create index if not exists cutting_stitch_log_entry_idx on cutting_stitch_log(cutting_entry_id, log_date);
alter table cutting_stitch_log enable row level security;
drop policy if exists "csl_select" on cutting_stitch_log;
create policy "csl_select" on cutting_stitch_log for select using (auth.role() = 'authenticated');
-- no direct writes: everything goes through the functions below

-- Totals shown on the cutting card (completed_sizes) are always the sum of the daily rows.
create or replace function recompute_stitched(p_entry uuid) returns void
language sql security definer set search_path = public as $$
  update cutting_entries set completed_sizes = coalesce((
    select jsonb_object_agg(k, t) from (
      select e.key k, sum(e.value::numeric) t
      from cutting_stitch_log l, jsonb_each_text(l.sizes) e
      where l.cutting_entry_id = p_entry group by e.key
    ) x), '{}'::jsonb)
  where id = p_entry;
$$;

-- Add one day's stitching. Can be called again on later days; the totals keep adding up.
create or replace function log_stitching(p_entry uuid, p_date date, p_sizes jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; k text; v numeric; cur numeric; v_name text; v_clean jsonb := '{}'::jsonb;
begin
  if not is_gm_pm_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Production Manager, General Manager or Admin can log stitching');
  end if;
  select * into e from cutting_entries where id = p_entry for update;
  if not found then return json_build_object('ok', false, 'error', 'Cutting entry not found'); end if;
  if e.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Stitching can only be logged on an approved cutting entry'); end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then
    return json_build_object('ok', false, 'error', 'Choose today or an earlier date');
  end if;
  for k, v in select key, nullif(value, '')::numeric from jsonb_each_text(coalesce(p_sizes, '{}'::jsonb)) loop
    if coalesce(v, 0) <= 0 then continue; end if;
    if not (e.sizes ? k) then return json_build_object('ok', false, 'error', 'Size ' || k || ' is not part of this cutting entry'); end if;
    cur := coalesce(nullif(e.completed_sizes->>k, '')::numeric, 0);
    if cur + v > (e.sizes->>k)::numeric then
      return json_build_object('ok', false, 'error', 'Size ' || k || ': ' || (cur + v) || ' stitched would exceed the ' || (e.sizes->>k) || ' cut');
    end if;
    v_clean := v_clean || jsonb_build_object(k, v);
  end loop;
  if v_clean = '{}'::jsonb then return json_build_object('ok', false, 'error', 'Enter the pieces stitched for at least one size'); end if;
  select name into v_name from profiles where id = auth.uid();
  insert into cutting_stitch_log (cutting_entry_id, log_date, sizes, note, logged_by)
  values (p_entry, p_date, v_clean, nullif(trim(coalesce(p_note, '')), ''), v_name);
  perform recompute_stitched(p_entry);
  return json_build_object('ok', true);
end $$;
grant execute on function log_stitching(uuid, date, jsonb, text) to authenticated;

-- Remove a mistaken daily row; the totals are recalculated.
create or replace function delete_stitch_log(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select cutting_entry_id into v_entry from cutting_stitch_log where id = p_id;
  if v_entry is null then return json_build_object('ok', false, 'error', 'Row not found'); end if;
  delete from cutting_stitch_log where id = p_id;
  perform recompute_stitched(v_entry);
  return json_build_object('ok', true);
end $$;
grant execute on function delete_stitch_log(uuid) to authenticated;

-- Keep what was already logged: one opening row per entry that has totals but no history yet.
insert into cutting_stitch_log (cutting_entry_id, log_date, sizes, note, logged_by)
select c.id, coalesce(c.reviewed_at::date, c.cut_date),
       (select jsonb_object_agg(x.key, x.value::numeric) from jsonb_each_text(c.completed_sizes) x where coalesce(nullif(x.value,'')::numeric,0) > 0),
       'Total logged before daily history was added', 'System'
from cutting_entries c
where c.completed_sizes <> '{}'::jsonb
  and exists (select 1 from jsonb_each_text(c.completed_sizes) x where coalesce(nullif(x.value,'')::numeric,0) > 0)
  and not exists (select 1 from cutting_stitch_log l where l.cutting_entry_id = c.id);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cutting_stitch_log') then
    alter publication supabase_realtime add table cutting_stitch_log;
  end if;
end $$;
-- migration_46.sql — v49 (offer-letter type, duplicate-expenditure review, alerts). Run after migration_45.sql. Safe to run twice.
alter table offer_letters add column if not exists letter_type text not null default 'staff';

-- ===== Duplicate expenditures: a Finance / Admin reviewer can mark an entry as genuine =====
alter table expenditures add column if not exists dup_cleared_at timestamptz;
alter table expenditures add column if not exists dup_cleared_by text;

-- If the fields that decide "duplicate" are edited afterwards, the entry must be reviewed again.
create or replace function reset_dup_review() returns trigger language plpgsql as $$
begin
  if (new.amount, new.expense_date, new.category, coalesce(new.vendor,''), coalesce(new.item,''))
     is distinct from (old.amount, old.expense_date, old.category, coalesce(old.vendor,''), coalesce(old.item,'')) then
    new.dup_cleared_at := null; new.dup_cleared_by := null;
  end if;
  return new;
end $$;
drop trigger if exists expenditures_reset_dup on expenditures;
create trigger expenditures_reset_dup before update on expenditures
  for each row execute procedure reset_dup_review();

-- ===== Alerts & escalations (Production Manager, General Manager, Admin) =====
alter table order_finance add column if not exists approved_estimate numeric default 0;   -- approved cost estimate for the order

create table if not exists alert_settings (
  id int primary key default 1 check (id = 1),
  defect_limit_pct numeric not null default 5,        -- approved defect limit (% of inspected pieces)
  cost_overrun_pct numeric not null default 0,        -- tolerance above the approved estimate
  target_shortfall_pct numeric not null default 20,   -- how far below the pro-rated daily target before alerting
  low_stock_qty numeric not null default 20,          -- accessories at or below this are "insufficient"
  escalate_after_hours numeric not null default 24,   -- an alert still open after this is shown as ESCALATED
  updated_by text,
  updated_at timestamptz default now()
);
insert into alert_settings (id) values (1) on conflict do nothing;
alter table alert_settings enable row level security;
drop policy if exists "alert_settings_select" on alert_settings;
drop policy if exists "alert_settings_admin_write" on alert_settings;
create policy "alert_settings_select" on alert_settings for select using (my_role() in ('admin','gm','pm'));
create policy "alert_settings_admin_write" on alert_settings for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Remembers when each alert first appeared so that old, unresolved ones can be escalated.
create table if not exists alert_state (
  key text primary key,
  kind text not null,
  severity text not null,
  message text not null,
  order_number text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table alert_state enable row level security;
drop policy if exists "alert_state_select" on alert_state;
create policy "alert_state_select" on alert_state for select using (my_role() in ('admin','gm','pm'));

-- Every alert is computed live from the current data, so it clears itself once the problem is fixed.
create or replace function factory_alerts() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s alert_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_clock numeric := extract(hour from (now() at time zone 'Asia/Kolkata')) + extract(minute from (now() at time zone 'Asia/Kolkata')) / 60.0;
  v_frac numeric;
  v_dow int := extract(dow from (now() at time zone 'Asia/Kolkata'));
  v_cur jsonb;
  v_need numeric; v_stock numeric; v_global numeric;
begin
  if coalesce(my_role(), '') not in ('admin','gm','pm') then return '[]'::jsonb; end if;
  select * into s from alert_settings where id = 1;
  v_frac := greatest(0, least(1, (v_clock - 9) / 9.0));   -- share of the 9:00-18:00 shift that has passed

  -- fabric needed for the next working day (daily target, else recent pace, capped at pieces left) vs stock
  select coalesce(sum(cp.k), 0) / nullif(coalesce(sum(cp.p), 0), 0) into v_global from (
    select sum(c.fabric_kg_used) k, sum((select coalesce(sum(x.value::numeric), 0) from jsonb_each_text(c.sizes) x)) p
    from cutting_entries c where c.status = 'Approved') cp;
  select coalesce(sum(least(plan, remaining) * coalesce(rate, v_global, 0)), 0) into v_need from (
    select
      greatest(o.qty - coalesce(pr.done, 0), 0) as remaining,
      case when coalesce(o.daily_target, 0) > 0 then o.daily_target
           when coalesce(pr.days14, 0) > 0 then pr.q14 / pr.days14 else 0 end as plan,
      (select sum(c.fabric_kg_used) / nullif(sum((select coalesce(sum(x.value::numeric), 0) from jsonb_each_text(c.sizes) x)), 0)
         from cutting_entries c where c.order_id = o.id and c.status = 'Approved') as rate
    from (select oo.*, (select coalesce(sum((i->>'quantity')::numeric), 0) from jsonb_array_elements(coalesce(oo.items, '[]'::jsonb)) i) qty
          from orders oo where oo.status not in ('Shipped','Completed')) o
    left join (select order_id, sum(quantity) done,
                      sum(quantity) filter (where date >= v_today - 13) q14,
                      count(distinct date) filter (where date >= v_today - 13 and quantity > 0) days14
               from order_progress group by order_id) pr on pr.order_id = o.id) t;
  select coalesce(sum(stock_kg), 0) into v_stock from inventory_fabric;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_cur from (
    with ord as (
      select o.id, o.order_number, o.customer_name, o.due_date, o.status, coalesce(o.daily_target, 0) target,
             (select coalesce(sum((i->>'quantity')::numeric), 0) from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) i) qty
      from orders o where o.status not in ('Shipped','Completed')),
    pr as (select order_id, sum(quantity) done,
                  sum(quantity) filter (where date = v_today) today_done,
                  sum(quantity) filter (where date >= v_today - 13) q14,
                  count(distinct date) filter (where date >= v_today - 13 and quantity > 0) days14
           from order_progress group by order_id),
    m as (select ord.*, coalesce(pr.done, 0) done, coalesce(pr.today_done, 0) today_done,
                 greatest(ord.qty - coalesce(pr.done, 0), 0) remaining,
                 case when ord.target > 0 then ord.target when coalesce(pr.days14, 0) > 0 then pr.q14 / pr.days14 else 0 end rate
          from ord left join pr on pr.order_id = ord.id)

    -- 1. delivery date at risk
    select 'delivery:' || id as key, 'delivery' as kind, 'critical' as severity, order_number,
           order_number || ' (' || coalesce(customer_name, '') || ') is ' || (v_today - due_date) || ' day(s) past its delivery date of ' || due_date || ' and is not shipped yet.' as message
    from m where due_date is not null and due_date < v_today
    union all
    select 'delivery:' || id, 'delivery', 'high', order_number,
           order_number || ' (' || coalesce(customer_name, '') || ') is likely to miss its delivery date ' || due_date || ': ' || round(remaining) || ' pcs left, '
           || case when rate > 0 then 'needs about ' || ceil(remaining / rate) || ' working day(s) at ' || round(rate) || ' pcs/day' else 'no production pace yet' end
           || ', ' || (due_date - v_today) || ' day(s) left.'
    from m where due_date is not null and due_date >= v_today and remaining > 0
      and ((rate > 0 and ceil(remaining / rate) > floor((due_date - v_today) * 6 / 7.0))
           or (rate = 0 and due_date - v_today <= 3 and status = 'Not Started'))

    -- 2. production below planned target (checked once half the shift has passed; not on Sundays)
    union all
    select 'target:' || id, 'target', 'high', order_number,
           order_number || ': ' || round(today_done) || ' pcs done today against a daily target of ' || round(target) || ' (about ' || round(target * v_frac) || ' expected by now).'
    from m where v_dow <> 0 and v_frac >= 0.5 and target > 0 and status in ('Cutting','Stitching','Finishing','Ironing')
      and today_done < target * v_frac * (1 - s.target_shortfall_pct / 100.0)

    -- 3a. fabric short for tomorrow's plan
    union all
    select 'fabric', 'material', 'high', null,
           'Fabric may be insufficient: the next working day needs about ' || round(v_need, 1) || ' kg but only ' || round(v_stock, 1) || ' kg is in stock (short by ' || round(v_need - v_stock, 1) || ' kg).'
    where v_need > v_stock and v_need > 0

    -- 3b. accessories at or below the limit
    union all
    select 'accessories', 'material', 'high', null,
           'Accessories running low (at or below ' || s.low_stock_qty || '): ' ||
           (select string_agg(name || ' (' || quantity || ' ' || coalesce(unit, 'pcs') || ')', ', ' order by quantity)
              from (select * from inventory_items where quantity <= s.low_stock_qty order by quantity limit 6) z) || '.'
    where exists (select 1 from inventory_items where quantity <= s.low_stock_qty)

    -- 4. quality defects above the approved limit (latest inspection that recorded a sample)
    union all
    select 'quality:' || o.id, 'quality', 'critical', o.order_number,
           o.order_number || ': defect rate ' || round(li.defective_qty / li.inspected_qty * 100, 1) || '% (' || li.defective_qty || ' of ' || li.inspected_qty
           || ' inspected) is above the approved limit of ' || s.defect_limit_pct || '%.'
    from ord o
    join lateral (select qi.inspected_qty, qi.defective_qty from quality_inspections qi
                  where qi.order_id = o.id and coalesce(qi.inspected_qty, 0) > 0
                  order by qi.created_at desc limit 1) li on true
    where li.defective_qty / li.inspected_qty * 100 > s.defect_limit_pct

    -- 5. machine breakdown while orders are in production
    union all
    select 'machines', 'machine',
           case when down * 5 >= total then 'critical' else 'high' end, null,
           'Machine breakdown: ' || down || ' of ' || total || ' machine(s) are not running (' || detail || '), while '
           || (select count(*) from ord where status in ('Cutting','Stitching','Finishing','Ironing')) || ' order(s) are in production.'
    from (select coalesce(sum(quantity) filter (where working_condition in ('Under repair','Not working')), 0) down,
                 coalesce(sum(quantity), 0) total,
                 string_agg(coalesce(nullif(model_other, ''), model) || ' ' || machine_type || ' ×' || quantity || ' ' || working_condition, '; ')
                   filter (where working_condition in ('Under repair','Not working')) detail
          from inventory_machines) mm
    where down > 0 and exists (select 1 from ord where status in ('Cutting','Stitching','Finishing','Ironing'))

    -- 6. actual cost above the approved estimate
    union all
    select 'cost:' || o.id, 'cost', 'critical', o.order_number,
           o.order_number || ': actual cost ₹' || round(c.actual) || ' is above the approved estimate of ₹' || round(f.approved_estimate)
           || ' (+' || round((c.actual - f.approved_estimate) / f.approved_estimate * 100, 1) || '%).'
    from ord o
    join order_finance f on f.order_id = o.id and coalesce(f.approved_estimate, 0) > 0
    cross join lateral (select coalesce((order_actual_cost_internal(o.id)->'totals'->>'total')::numeric, 0) actual) c
    where c.actual > f.approved_estimate * (1 + s.cost_overrun_pct / 100.0)
  ) a;

  -- remember / resolve
  insert into alert_state (key, kind, severity, message, order_number, first_seen_at, last_seen_at, resolved_at)
  select r.key, r.kind, r.severity, r.message, r.order_number, now(), now(), null
  from jsonb_to_recordset(v_cur) as r(key text, kind text, severity text, message text, order_number text)
  on conflict (key) do update
    set severity = excluded.severity, message = excluded.message, order_number = excluded.order_number, last_seen_at = now(),
        first_seen_at = case when alert_state.resolved_at is not null then now() else alert_state.first_seen_at end,
        resolved_at = null;
  update alert_state set resolved_at = now()
   where resolved_at is null and key not in (select r.key from jsonb_to_recordset(v_cur) as r(key text));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', st.key, 'kind', st.kind, 'severity', st.severity, 'message', st.message, 'order_number', st.order_number,
             'first_seen_at', st.first_seen_at,
             'age_hours', round(extract(epoch from (now() - st.first_seen_at)) / 3600.0, 1),
             'escalated', extract(epoch from (now() - st.first_seen_at)) / 3600.0 >= s.escalate_after_hours)
           order by case st.severity when 'critical' then 0 else 1 end, st.first_seen_at)
    from alert_state st
    where st.resolved_at is null and st.key in (select r.key from jsonb_to_recordset(v_cur) as r(key text))), '[]'::jsonb);
end $$;
grant execute on function factory_alerts() to authenticated;
-- v52: Production Manager full access, "Rejected by Customer" status, customer delivery acceptance link,
-- Garment Design & Size Master. Run after migration_46.sql. Safe to re-run.

-- ============================================================ 1. Production Manager: full access in Production Management
create or replace function is_quality_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('quality_manager','qc','pm'));
$$ language sql security definer stable;

create or replace function is_cutting_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('cutting_master','pm'));
$$ language sql security definer stable;

-- ============================================================ 2. Rejected by Customer (Shipped -> Rejected by Customer -> Completed)
alter table orders add column if not exists customer_reject_reason text;
alter table orders add column if not exists customer_rejected_at timestamptz;
alter table orders add column if not exists customer_rejected_by text;

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
  if new.status = 'Rejected by Customer' and old.status is distinct from 'Rejected by Customer' then
    if old.status <> 'Shipped' then
      raise exception 'Only a Shipped order can be marked Rejected by Customer';
    end if;
    if auth.uid() is not null and my_role() not in ('admin','gm','pm') then
      raise exception 'Only the Admin, Production Manager or General Manager can mark an order Rejected by Customer';
    end if;
  end if;
  if new.status = 'Completed' and old.status is distinct from 'Completed' and old.status not in ('Shipped','Rejected by Customer') then
    raise exception 'The order must be Shipped before it can be marked Completed (delivered to the customer)';
  end if;
  return new;
end $$;

-- GM cannot update orders directly, so the customer-rejection steps go through these two functions.
create or replace function set_customer_rejection(p_order_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_name text;
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can mark an order Rejected by Customer');
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason the customer gave'); end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status <> 'Shipped' then return json_build_object('ok', false, 'error', 'Only a Shipped order can be marked Rejected by Customer'); end if;
  select name into v_name from profiles where id = auth.uid();
  update orders set status = 'Rejected by Customer', customer_reject_reason = left(trim(p_reason), 1000),
         customer_rejected_at = now(), customer_rejected_by = v_name
   where id = p_order_id;
  return json_build_object('ok', true);
end $$;

-- After a rejection: goods re-dispatched (back to Shipped) or the customer finally accepted (Completed).
create or replace function resolve_customer_rejection(p_order_id uuid, p_to text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can do this');
  end if;
  if p_to not in ('Shipped','Completed') then return json_build_object('ok', false, 'error', 'Invalid status'); end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status <> 'Rejected by Customer' then return json_build_object('ok', false, 'error', 'This order is not marked Rejected by Customer'); end if;
  update orders set status = p_to where id = p_order_id;
  return json_build_object('ok', true);
end $$;
grant execute on function set_customer_rejection(uuid, text) to authenticated;
grant execute on function resolve_customer_rejection(uuid, text) to authenticated;

-- A rejected order is no longer "in production": keep it out of the alert and dispatch-sync rules.
do $$
declare fn text; oid_ oid; def text;
begin
  foreach fn in array array['factory_alerts','sync_dispatch_on_quality'] loop
    select p.oid into oid_ from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if oid_ is not null then
      def := pg_get_functiondef(oid_);
      if position('(''Shipped'',''Completed'')' in def) > 0 then
        execute replace(def, '(''Shipped'',''Completed'')', '(''Shipped'',''Completed'',''Rejected by Customer'')');
      end if;
    end if;
  end loop;
end $$;

-- ============================================================ 3. Customer acceptance of dispatched goods
alter table order_deliveries add column if not exists customer_status text not null default 'Pending';
alter table order_deliveries drop constraint if exists order_deliveries_customer_status_check;
alter table order_deliveries add constraint order_deliveries_customer_status_check
  check (customer_status in ('Pending','Accepted','Partly accepted','Rejected'));
alter table order_deliveries add column if not exists accepted_qty numeric not null default 0;
alter table order_deliveries add column if not exists rejected_qty numeric not null default 0;
alter table order_deliveries add column if not exists customer_reason text;
alter table order_deliveries add column if not exists customer_responded_at timestamptz;
alter table order_deliveries add column if not exists customer_responder text;

-- The customer's answer can only be written by the customer's link or reset by Admin/PM/GM.
create or replace function guard_delivery_customer_fields()
returns trigger language plpgsql as $$
declare via_rpc boolean := coalesce(current_setting('tp.cust_rpc', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.customer_status := 'Pending'; new.accepted_qty := 0; new.rejected_qty := 0;
    new.customer_reason := null; new.customer_responded_at := null; new.customer_responder := null;
  elsif not via_rpc then
    if (new.customer_status, new.accepted_qty, new.rejected_qty, new.customer_reason, new.customer_responded_at, new.customer_responder)
       is distinct from
       (old.customer_status, old.accepted_qty, old.rejected_qty, old.customer_reason, old.customer_responded_at, old.customer_responder) then
      raise exception 'The customer''s response can only be given from the customer link, or reset by the Admin / Production Manager / General Manager';
    end if;
    if old.customer_status <> 'Pending' and new.quantity is distinct from old.quantity then
      raise exception 'The customer has already answered for this dispatch. Reset the response before changing the quantity.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_delivery_customer on order_deliveries;
create trigger guard_delivery_customer before insert or update on order_deliveries
  for each row execute procedure guard_delivery_customer_fields();

create or replace function reset_delivery_response(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can reset a customer response');
  end if;
  perform set_config('tp.cust_rpc', '1', true);
  update order_deliveries set customer_status = 'Pending', accepted_qty = 0, rejected_qty = 0,
         customer_reason = null, customer_responded_at = null, customer_responder = null
   where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function reset_delivery_response(uuid) to authenticated;

create or replace function public_delivery_status(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  return json_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name, 'status', o.status, 'due_date', o.due_date,
    'items', (select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
        select it->>'description' as description,
               coalesce((it->>'quantity')::numeric, 0) as ordered,
               coalesce((select sum(d.quantity) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as dispatched,
               coalesce((select sum(d.accepted_qty) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as accepted,
               coalesce((select sum(d.rejected_qty) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as rejected,
               coalesce((select sum(d.quantity) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description' and d.customer_status = 'Pending'), 0) as awaiting
          from jsonb_array_elements(o.items) with ordinality as t(it, n) order by n) x),
    'deliveries', (select coalesce(json_agg(row_to_json(y)), '[]'::json) from (
        select d.id, d.date, d.item_description, d.quantity, d.customer_status, d.accepted_qty, d.rejected_qty,
               d.customer_reason, d.customer_responded_at, d.customer_responder
          from order_deliveries d where d.order_id = o.id order by d.date desc, d.created_at desc) y),
    'payments', (select coalesce(json_agg(row_to_json(z)), '[]'::json) from (
        select p.payment_date, p.amount, p.mode from order_payments p where p.order_id = o.id order by p.payment_date desc, p.created_at desc) z),
    'payments_total', coalesce((select sum(amount) from order_payments where order_id = o.id), 0),
    'invoices', (select coalesce(json_agg(row_to_json(w)), '[]'::json) from (
        select i.invoice_number, i.issue_date, i.amount, i.status from invoices i where i.linked_order_id = o.id order by i.issue_date desc) w)
  );
end $$;

create or replace function public_delivery_respond(p_order_number text, p_tracking_code text, p_delivery_id uuid, p_accepted numeric, p_reason text, p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; d order_deliveries%rowtype; v_rej numeric; v_status text;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select * into d from order_deliveries where id = p_delivery_id and order_id = o.id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if d.customer_status <> 'Pending' then return json_build_object('ok', false, 'error', 'already_answered'); end if;
  if length(trim(coalesce(p_name,''))) < 2 then return json_build_object('ok', false, 'error', 'name_required'); end if;
  if p_accepted is null or p_accepted < 0 or p_accepted > d.quantity or p_accepted <> floor(p_accepted) then
    return json_build_object('ok', false, 'error', 'bad_quantity');
  end if;
  v_rej := d.quantity - p_accepted;
  if v_rej > 0 and length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'reason_required'); end if;
  v_status := case when v_rej = 0 then 'Accepted' when p_accepted = 0 then 'Rejected' else 'Partly accepted' end;
  perform set_config('tp.cust_rpc', '1', true);
  update order_deliveries set customer_status = v_status, accepted_qty = p_accepted, rejected_qty = v_rej,
         customer_reason = nullif(left(trim(coalesce(p_reason,'')), 1000), ''),
         customer_responded_at = now(), customer_responder = left(trim(p_name), 120)
   where id = d.id;
  return json_build_object('ok', true, 'status', v_status, 'accepted', p_accepted, 'rejected', v_rej);
end $$;
grant execute on function public_delivery_status(text, text) to anon, authenticated;
grant execute on function public_delivery_respond(text, text, uuid, numeric, text, text) to anon, authenticated;

-- ============================================================ 4. Garment Design & Size Master
create table if not exists garment_types (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Dress types',
  name text not null unique,
  models text[] not null default '{}',
  gender text,
  size_prefix text not null unique check (size_prefix ~ '^[A-Z0-9]{1,14}$'),
  sizes text[] not null default '{}',
  start_size text,
  end_size text,
  typical_length text,
  sleeve_type text,
  collar_type text,
  pocket_config text,
  fabric_type text,
  colour text,
  measurements text,
  compliance_note text,
  sku text,
  purchase_price numeric,
  selling_price numeric,
  active boolean not null default true,
  sort_no int not null default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists size_chart_ref (
  letter_size text primary key,
  chest text,
  waist text,
  sort_no int not null default 0
);
create table if not exists size_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_size text,
  end_size text,
  sort_no int not null default 0
);
alter table garment_types enable row level security;
alter table size_chart_ref enable row level security;
alter table size_systems enable row level security;
do $$
declare t text;
begin
  foreach t in array array['garment_types','size_chart_ref','size_systems'] loop
    execute format('drop policy if exists "%1$s_select" on %1$s', t);
    execute format('drop policy if exists "%1$s_write" on %1$s', t);
    execute format('create policy "%1$s_select" on %1$s for select using (auth.role() = ''authenticated'')', t);
    execute format('create policy "%1$s_write" on %1$s for all using (is_admin() or my_role() in (''gm'',''pm'')) with check (is_admin() or my_role() in (''gm'',''pm''))', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table garment_types; exception when others then null; end $$;

insert into garment_types (category, name, models, size_prefix, sizes, start_size, end_size, typical_length, compliance_note, active, sort_no) values
  ('Dress types','Knicker / Shorts',array['Regular','Boxer','Denim','School shorts']::text[],'KNICKER',array['9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26']::text[],'9','26',null,null,true,1),
  ('Dress types','Frock',array['Baby frock','A-line','Party wear','Gown','Layered']::text[],'FROCK',array['0–3 M','3–6 M','6–9 M','9–12 M','1 Y','2 Y','3 Y','4 Y','5 Y','6 Y','7 Y','8 Y','9 Y','10 Y','11 Y','12 Y','13 Y','14 Y','15 Y','16 Y']::text[],'0–3 months','16 years',null,null,true,2),
  ('Dress types','Chudidhar',array['Straight cut','Anarkali','Umbrella','Palazzo set']::text[],'CHUD',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,3),
  ('Dress types','T-shirt',array['Round neck','V-neck','Polo','Oversized','Printed']::text[],'T',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,4),
  ('Dress types','Pant / Trouser',array['Formal','Casual','Slim fit','Straight fit','Cargo']::text[],'P',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,5),
  ('Dress types','Skirt',array['Mini','Midi','Maxi','Pleated','Pencil','Circular']::text[],'SKIRT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,6),
  ('Dress types','Track pant',array['Jogger','Slim fit','Regular','Zipper','Cuffed']::text[],'TRACK',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,7),
  ('Dress types','Coat / Blazer',array['Formal','Slim fit','Double-breasted','Casual blazer']::text[],'COAT',array['34','36','38','40','42','44','46','48','50']::text[],'34','50',null,null,true,8),
  ('Dress types','Safari shirt',array['Half sleeve','Full sleeve','Utility pocket','Formal']::text[],'SAFARISHIRT',array['36','38','40','42','44','46','48','50']::text[],'36','50',null,null,true,9),
  ('Dress types','Safari pant',array['Regular fit','Pleated','Flat front','Cargo style']::text[],'SAFARIPANT',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,10),
  ('Dress types','Shirt',array['Formal','Casual','Checked','Printed','Slim fit']::text[],'SHIRT',array['36','38','40','42','44','46','48','50']::text[],'36','50',null,null,true,11),
  ('Dress types','Jeans',array['Skinny','Slim','Straight','Bootcut','Relaxed']::text[],'JEANS',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,12),
  ('Dress types','Kurti',array['Straight','A-line','Anarkali','Short','Long']::text[],'KURTI',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,13),
  ('Dress types','Salwar',array['Patiala','Straight salwar','Churidar','Dhoti style']::text[],'SALWAR',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,14),
  ('Dress types','Leggings',array['Ankle length','Full length','Capri','Cotton']::text[],'LEGGINGS',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,15),
  ('Dress types','Nightwear',array['Nighty','Pajama set','Night suit','Shorts set']::text[],'NIGHTWEAR',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,16),
  ('Dress types','Innerwear',array['Brief','Boxer','Vest','Camisole']::text[],'INNERWEAR',array['S','M','L','XL','XXL']::text[],'S','XXL',null,null,true,17),
  ('Dress types','Jacket',array['Denim','Bomber','Hoodie jacket','Winter jacket']::text[],'JACKET',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,18),
  ('Dress types','Suit',array['Two-piece','Three-piece','Wedding suit']::text[],'SUIT',array['34','36','38','40','42','44','46','48','50']::text[],'34','50',null,null,true,19),
  ('Dress types','Dhoti',array['Traditional','Readymade','Double border','Silk']::text[],'DHOTI',array['Free size','Custom']::text[],'Dhoti-specific sizing','Dhoti-specific sizing',null,null,true,20),
  ('Medical & hospital','Doctor coat / Doctor dress',array['Classic white coat','Short coat','Long coat','Fitted coat','Mandarin collar','Notched collar']::text[],'DOCTORCOATDO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL','30–42 inches',null,true,21),
  ('Medical & hospital','Scrub suit',array['V-neck','Round neck','Crossover top','Jogger scrub','Unisex scrub','Surgical scrub']::text[],'SCRUBSUIT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,'Components: scrub top and scrub pant',true,22),
  ('Medical & hospital','Nurse dress / Nursing uniform',array['Button-front dress','Tunic uniform','Nursing top and pant','Maternity nursing uniform']::text[],'NURSEDRESSNU',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,23),
  ('Medical & hospital','Patient gown',array['Back-open gown','Side-tie gown','Examination gown','Patient nightgown']::text[],'PATIENTGOWN',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,'Adjustable ties can provide a wider fit',true,24),
  ('Medical & hospital','Surgical gown',array['Reusable cotton gown','Sterile surgical gown','Disposable gown','Reinforced surgical gown']::text[],'SURGICALGOWN',array['M','L','XL','XXL','3XL','4XL']::text[],'M','4XL',null,'Manufacturer-specific sizes possible. Sterile and fluid-resistant gowns require appropriately validated materials and construction.',true,25),
  ('Aprons & laboratory','Apron',array['Bib apron','Waist apron','Cross-back apron','Sleeveless apron','Full-length apron','Pocket apron']::text[],'APRON',array['Free size','S','M','L','XL','XXL','Custom']::text[],'Free size','Custom',null,'Hospitals, laboratories, kitchens, salons and factories',true,26),
  ('Aprons & laboratory','Lab coat',array['Short lab coat','Knee-length coat','Long lab coat','Unisex coat','Women''s fitted coat','Men''s coat']::text[],'LABCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,'Research laboratories, colleges, pharmaceutical companies and testing centres',true,27),
  ('Aprons & laboratory','Chemical safety coat',array['Chemical-resistant coat','Splash-resistant coat','Coated-fabric coat','Disposable protective gown']::text[],'CHEMICALSAFE',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,'Choose the fabric based on the actual chemicals and exposure risks. Manufacturer-specific sizing possible.',true,28),
  ('Aprons & laboratory','Pharmacist coat',array['Half coat','Full coat','Short fitted coat','Unisex pharmacy coat']::text[],'PHARMACISTCO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,29),
  ('Industrial & safety','Safety coat',array['Reflective coat','High-visibility coat','Industrial coat']::text[],'SAFETYCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,30),
  ('Industrial & safety','Boiler suit / Coverall',array['Full sleeve','Half sleeve','Zipper','Button-front','Disposable']::text[],'BOILERSUITCO',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,31),
  ('Industrial & safety','Industrial uniform',array['Shirt-pant set','Two-piece uniform','Colour-coded uniform']::text[],'INDUSTRIALUN',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,32),
  ('Industrial & safety','Safety vest',array['Reflective vest','Mesh vest','Multi-pocket vest']::text[],'SAFETYVEST',array['S','M','L','XL','XXL','3XL','4XL','5XL','Adjustable']::text[],'S','5XL; adjustable',null,null,true,33),
  ('Industrial & safety','Flame-resistant coverall',array['Arc-rated','Flame-resistant','Industrial protective']::text[],'FLAMERESISTA',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,34),
  ('Industrial & safety','Chemical coverall',array['Splash protection','Disposable','Reusable chemical suit']::text[],'CHEMICALCOVE',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,35),
  ('Industrial & safety','Welding apron',array['Leather apron','Split-leg apron','Full-body apron']::text[],'WELDINGAPRON',array['Adjustable','Custom']::text[],'Adjustable','Custom',null,null,true,36),
  ('Industrial & safety','Industrial apron',array['PVC apron','Canvas apron','Coated-fabric apron']::text[],'INDUSTRIALAP',array['Free size','Custom']::text[],'Free size','Custom',null,null,true,37),
  ('Industrial & safety','High-visibility jacket',array['Reflective jacket','Padded safety jacket','Rain jacket']::text[],'HIGHVISIBILI',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,38),
  ('Industrial & safety','Rain suit',array['Jacket and pant set','Hooded suit','PVC rainwear']::text[],'RAINSUIT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,39),
  ('Industrial & safety','ESD / Antistatic coat',array['Lab coat','ESD jacket','Cleanroom coat']::text[],'ESDANTISTATI',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,40),
  ('Industrial & safety','Cleanroom suit',array['Coverall','Hooded suit','Cleanroom gown']::text[],'CLEANROOMSUI',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,41),
  ('Industrial & safety','Dust coat',array['Cotton dust coat','Industrial dust coat','Workshop coat']::text[],'DUSTCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,42),
  ('Industrial & safety','Security uniform',array['Security shirt','Trouser','Blazer','Winter jacket']::text[],'SECURITYUNIF',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,43),
  ('Industrial & safety','Housekeeping uniform',array['Tunic','Shirt-pant set','Dress uniform','Apron set']::text[],'HOUSEKEEPING',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,44),
  ('Professional uniforms','Chef coat',array['Double-breasted','Single-breasted','Short sleeve','Long sleeve']::text[],'CHEFCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,45),
  ('Professional uniforms','Kitchen apron',array['Bib','Waist','Cross-back','Waterproof']::text[],'KITCHENAPRON',array['Free size','Custom']::text[],'Free size','Custom',null,null,true,46),
  ('Professional uniforms','Hotel uniform',array['Reception coat','Housekeeping dress','Service shirt']::text[],'HOTELUNIFORM',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,47),
  ('Professional uniforms','Salon uniform',array['Tunic','Beauty therapist coat','Salon apron']::text[],'SALONUNIFORM',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,48),
  ('Professional uniforms','Dental coat',array['Short coat','Long coat','Dental tunic','Scrub suit']::text[],'DENTALCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,49),
  ('Professional uniforms','Veterinary coat',array['Lab coat','Scrub suit','Protective apron']::text[],'VETERINARYCO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,50),
  ('Professional uniforms','Factory coat',array['Button coat','Zipper coat','Pocket coat']::text[],'FACTORYCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,51),
  ('Professional uniforms','Workshop uniform',array['Shirt-pant set','Coverall','Mechanic coat']::text[],'WORKSHOPUNIF',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,52),
  ('Professional uniforms','School lab coat',array['Student coat','College lab coat','Junior lab coat']::text[],'SCHOOLLABCOA',array['6 Y','8 Y','10 Y','12 Y','14 Y','16 Y','XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'Children''s sizes','5XL',null,null,true,53),
  ('Professional uniforms','Maternity uniform',array['Maternity scrub','Adjustable tunic','Nursing gown']::text[],'MATERNITYUNI',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,54),
  ('Professional uniforms','Patient attendant gown',array['Wrap gown','Tie gown','Washable gown']::text[],'PATIENTATTEN',array['M','L','XL','XXL','3XL','4XL','5XL','Adjustable']::text[],'M','5XL; adjustable',null,null,true,55),
  ('Professional uniforms','Laundry uniform',array['Tunic','Shirt-pant set','Apron']::text[],'LAUNDRYUNIFO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,56)
on conflict (name) do nothing;

insert into size_chart_ref (letter_size, chest, waist, sort_no) values
  ('XS','32–34','26–28',1),('S','34–36','28–30',2),('M','38–40','32–34',3),('L','42–44','36–38',4),('XL','46–48','40–42',5),
  ('XXL','50–52','44–46',6),('3XL','54–56','48–50',7),('4XL','58–60','52–54',8),('5XL','62–64','56–58',9)
on conflict (letter_size) do nothing;

insert into size_systems (name, start_size, end_size, sort_no) values
  ('Children''s uniforms','0–3 months','16 years',1),
  ('Adult letter sizes','XS','5XL',2),
  ('Men''s trousers','26 inches waist','44 inches waist',3),
  ('Men''s shirts','36 inches chest','50 inches chest',4),
  ('Coats and blazers','34 inches chest','50 inches chest',5),
  ('Adjustable aprons','Free size','Custom size',6),
  ('Special protective clothing','Manufacturer-defined','Manufacturer-defined',7)
on conflict (name) do nothing;
-- v53: partial dispatches. Each lot of pieces goes through its own QC approval, then dispatch approval by the
-- Production Manager and the General Manager, before deliveries can be logged against it.
-- Run after migration_47.sql. Safe to re-run.

create table if not exists dispatch_lots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  lot_no int not null,
  items jsonb not null default '[]',
  note text,
  status text not null default 'Pending QC' check (status in ('Pending QC','Pending PM','Pending GM','Approved','Rejected')),
  requested_by text,
  requested_at timestamptz default now(),
  qc_by text, qc_at timestamptz, qc_inspected numeric, qc_defective numeric, qc_note text,
  pm_by text, pm_at timestamptz,
  gm_by text, gm_at timestamptz,
  reject_stage text,
  reject_reason text,
  unique (order_id, lot_no)
);
alter table dispatch_lots enable row level security;
drop policy if exists "dispatch_lots_select" on dispatch_lots;
create policy "dispatch_lots_select" on dispatch_lots for select using (auth.role() = 'authenticated');
-- no write policies: lots are created and approved only through the functions below

alter table order_deliveries add column if not exists lot_id uuid references dispatch_lots(id) on delete set null;
do $$ begin alter publication supabase_realtime add table dispatch_lots; exception when others then null; end $$;

-- Pieces can leave the factory when the whole order is approved, OR against a fully approved partial dispatch.
create or replace function block_delivery_without_quality()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; l dispatch_lots%rowtype; lot_qty numeric; done numeric;
begin
  select * into o from orders where id = new.order_id;
  if o.quality_status = 'Approved' and o.dispatch_status = 'Approved' then return new; end if;
  if new.lot_id is null then
    raise exception 'The order needs quality and dispatch approval, or choose an approved partial dispatch, before goods are dispatched';
  end if;
  select * into l from dispatch_lots where id = new.lot_id and order_id = new.order_id;
  if not found then raise exception 'This partial dispatch does not belong to the order'; end if;
  if l.status <> 'Approved' then
    raise exception 'Partial dispatch % is not fully approved yet (status: %)', l.lot_no, l.status;
  end if;
  select coalesce(sum((it->>'quantity')::numeric), 0) into lot_qty
    from jsonb_array_elements(l.items) it where it->>'description' = new.item_description;
  if lot_qty = 0 then raise exception 'This item is not part of the approved partial dispatch %', l.lot_no; end if;
  select coalesce(sum(quantity), 0) into done from order_deliveries
   where lot_id = l.id and item_description = new.item_description and id is distinct from new.id;
  if done + new.quantity > lot_qty then
    raise exception 'Only % more pieces of % are approved in partial dispatch %', greatest(0, lot_qty - done), new.item_description, l.lot_no;
  end if;
  return new;
end $$;

-- 1. Request a lot of already-made pieces
create or replace function request_dispatch_lot(p_order_id uuid, p_items jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; it jsonb; d text; q numeric; clean jsonb := '[]'; seen text[] := '{}';
        ordered numeric; made numeric; lotted numeric; avail numeric; v_no int; v_name text; v_id uuid;
begin
  if not (is_tl_or_above() or is_admin()) then
    return json_build_object('ok', false, 'error', 'Only the Team Lead, Production Manager, General Manager or Admin can request a partial dispatch');
  end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status in ('Shipped','Completed','Rejected by Customer') then
    return json_build_object('ok', false, 'error', 'This order has already been shipped');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    d := trim(coalesce(it->>'description', ''));
    q := nullif(it->>'quantity', '')::numeric;
    if q is null or q <= 0 then continue; end if;
    if q <> floor(q) then return json_build_object('ok', false, 'error', 'Pieces must be whole numbers'); end if;
    if d = any(seen) then return json_build_object('ok', false, 'error', 'Each item can appear once in a lot'); end if;
    seen := seen || d;
    select sum((x->>'quantity')::numeric) into ordered from jsonb_array_elements(o.items) x where x->>'description' = d;
    if ordered is null then return json_build_object('ok', false, 'error', format('"%s" is not an item of this order', d)); end if;
    select coalesce(sum(quantity), 0) into made from order_progress where order_id = o.id and item_description = d;
    select coalesce(sum((li->>'quantity')::numeric), 0) into lotted
      from dispatch_lots l, jsonb_array_elements(l.items) li
     where l.order_id = o.id and l.status <> 'Rejected' and li->>'description' = d;
    avail := greatest(0, least(made, ordered) - lotted);
    if q > avail then
      return json_build_object('ok', false, 'error', format('%s: only %s pieces are available (made %s, already in other partial dispatches %s)', d, avail, made, lotted));
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('description', d, 'quantity', q));
  end loop;
  if jsonb_array_length(clean) = 0 then return json_build_object('ok', false, 'error', 'Enter the pieces to dispatch'); end if;
  select coalesce(max(lot_no), 0) + 1 into v_no from dispatch_lots where order_id = o.id;
  select name into v_name from profiles where id = auth.uid();
  insert into dispatch_lots (order_id, lot_no, items, note, requested_by)
  values (o.id, v_no, clean, nullif(trim(coalesce(p_note, '')), ''), v_name) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'lot_no', v_no);
end $$;

-- 2. Quality check of the lot (Quality Manager / QC / PM / Admin)
create or replace function qc_dispatch_lot(p_lot uuid, p_decision text, p_inspected numeric, p_defective numeric, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare l dispatch_lots%rowtype; v_name text; v_total numeric;
begin
  if not is_quality_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Quality Manager, QC or Production Manager can approve quality');
  end if;
  if p_decision not in ('Approved','Rejected') then return json_build_object('ok', false, 'error', 'Invalid decision'); end if;
  select * into l from dispatch_lots where id = p_lot for update;
  if not found then return json_build_object('ok', false, 'error', 'Partial dispatch not found'); end if;
  if l.status <> 'Pending QC' then return json_build_object('ok', false, 'error', 'This partial dispatch is not waiting for quality approval'); end if;
  select name into v_name from profiles where id = auth.uid();
  if p_decision = 'Rejected' then
    if length(trim(coalesce(p_note, ''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for rejecting'); end if;
    update dispatch_lots set status = 'Rejected', reject_stage = 'QC', reject_reason = trim(p_note),
           qc_by = v_name, qc_at = now(), qc_inspected = p_inspected, qc_defective = p_defective, qc_note = trim(p_note)
     where id = p_lot;
    return json_build_object('ok', true, 'status', 'Rejected');
  end if;
  select coalesce(sum((it->>'quantity')::numeric), 0) into v_total from jsonb_array_elements(l.items) it;
  if coalesce(p_inspected, 0) <= 0 then return json_build_object('ok', false, 'error', 'Enter how many pieces were inspected'); end if;
  if p_inspected > v_total then return json_build_object('ok', false, 'error', format('Inspected pieces cannot be more than the %s pieces in this lot', v_total)); end if;
  if coalesce(p_defective, 0) < 0 or coalesce(p_defective, 0) > p_inspected then return json_build_object('ok', false, 'error', 'Check the defective count'); end if;
  if coalesce(p_defective, 0) > 0 then
    return json_build_object('ok', false, 'error', 'Defective pieces were found. Remove them from the lot (delete it and request a corrected one) or reject it.');
  end if;
  update dispatch_lots set status = 'Pending PM', qc_by = v_name, qc_at = now(), qc_inspected = p_inspected,
         qc_defective = 0, qc_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_lot;
  return json_build_object('ok', true, 'status', 'Pending PM');
end $$;

-- 3. Dispatch approval of the lot: Production Manager, then General Manager (Admin can act at either step)
create or replace function approve_lot_dispatch(p_lot uuid, p_decision text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare l dispatch_lots%rowtype; r text; v_name text;
begin
  r := my_role();
  if r not in ('pm','gm','admin') then
    return json_build_object('ok', false, 'error', 'Only the Production Manager and General Manager approve dispatch');
  end if;
  if p_decision not in ('Approved','Rejected') then return json_build_object('ok', false, 'error', 'Invalid decision'); end if;
  select * into l from dispatch_lots where id = p_lot for update;
  if not found then return json_build_object('ok', false, 'error', 'Partial dispatch not found'); end if;
  if l.status = 'Pending PM' then
    if r not in ('pm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the Production Manager to approve first'); end if;
  elsif l.status = 'Pending GM' then
    if r not in ('gm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the General Manager'); end if;
  else
    return json_build_object('ok', false, 'error', 'This partial dispatch is not waiting for dispatch approval');
  end if;
  select name into v_name from profiles where id = auth.uid();
  if p_decision = 'Rejected' then
    if length(trim(coalesce(p_note, ''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for rejecting'); end if;
    update dispatch_lots set status = 'Rejected', reject_stage = case when l.status = 'Pending PM' then 'PM' else 'GM' end, reject_reason = trim(p_note) where id = p_lot;
  elsif l.status = 'Pending PM' then
    update dispatch_lots set status = 'Pending GM', pm_by = v_name, pm_at = now() where id = p_lot;
  else
    update dispatch_lots set status = 'Approved', gm_by = v_name, gm_at = now() where id = p_lot;
  end if;
  return json_build_object('ok', true);
end $$;

-- 4. Remove a lot that has not been dispatched yet
create or replace function delete_dispatch_lot(p_lot uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can remove a partial dispatch');
  end if;
  if exists (select 1 from order_deliveries where lot_id = p_lot) then
    return json_build_object('ok', false, 'error', 'Goods have already been dispatched against this lot');
  end if;
  delete from dispatch_lots where id = p_lot;
  return json_build_object('ok', true);
end $$;

grant execute on function request_dispatch_lot(uuid, jsonb, text) to authenticated;
grant execute on function qc_dispatch_lot(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function approve_lot_dispatch(uuid, text, text) to authenticated;
grant execute on function delete_dispatch_lot(uuid) to authenticated;

-- ===== migration_49 (v56) =====
-- v56: Order assignment (GM -> Production Manager -> Team Lead), today's production plan,
-- and the day-end report (generated at 6 PM IST or on demand by Admin / GM / Production Manager).
-- Run after migration_48.sql. Safe to re-run.

-- ============================================================ 1. Order assignments
create table if not exists order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_description text,                         -- null = the whole order
  work_date date not null,
  priority text not null default 'Normal' check (priority in ('Top','High','Normal','Low')),
  target_qty numeric not null default 0,
  instructions text,
  assigned_by text,
  assigned_by_role text,
  created_at timestamptz default now(),
  -- Production Manager step (assignments made by the GM wait here until the PM accepts)
  pm_status text not null default 'Accepted' check (pm_status in ('Pending PM','Accepted')),
  pm_by text, pm_at timestamptz,
  -- Team Lead step
  tl_employee_id uuid references employees(id) on delete set null,
  tl_status text not null default 'Not assigned' check (tl_status in ('Not assigned','Assigned','Accepted','In progress','Completed','Declined')),
  tl_assigned_by text, tl_assigned_at timestamptz,
  tl_accepted_at timestamptz, tl_started_at timestamptz, tl_completed_at timestamptz,
  completed_qty numeric,
  tl_note text
);
create index if not exists order_assignments_date_idx on order_assignments (work_date);
create index if not exists order_assignments_tl_idx on order_assignments (tl_employee_id);

create table if not exists assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references order_assignments(id) on delete cascade,
  at timestamptz default now(),
  by_name text,
  kind text not null,
  detail text
);
create index if not exists assignment_events_idx on assignment_events (assignment_id, at);

alter table order_assignments enable row level security;
alter table assignment_events enable row level security;
drop policy if exists "order_assignments_select" on order_assignments;
create policy "order_assignments_select" on order_assignments for select using (auth.role() = 'authenticated');
drop policy if exists "assignment_events_select" on assignment_events;
create policy "assignment_events_select" on assignment_events for select using (auth.role() = 'authenticated');
-- no write policies: everything goes through the functions below
do $$ begin alter publication supabase_realtime add table order_assignments; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table assignment_events; exception when others then null; end $$;

create or replace function asg_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from profiles where id = auth.uid()), 'System')
$$;
create or replace function asg_log(p_id uuid, p_kind text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into assignment_events (assignment_id, by_name, kind, detail) values (p_id, asg_who(), p_kind, p_detail)
$$;
create or replace function asg_manager() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','hr','gm','pm'), false)
$$;
create or replace function asg_pm_or_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','hr','pm'), false)
$$;

-- Create an assignment. GM-made assignments wait for the Production Manager to accept.
create or replace function create_assignment(
  p_order_id uuid, p_item text, p_date date, p_priority text default 'Normal',
  p_target numeric default 0, p_instructions text default null, p_tl uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_id uuid; v_item text := nullif(trim(coalesce(p_item,'')), ''); v_role text := my_role(); v_pm text;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can assign work'); end if;
  select * into o from orders where id = p_order_id;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status in ('Shipped','Completed','Rejected by Customer') then return json_build_object('ok', false, 'error', 'This order is already shipped or completed'); end if;
  if p_date is null then return json_build_object('ok', false, 'error', 'Choose the work date'); end if;
  if coalesce(p_priority,'Normal') not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if v_item is not null and not exists (select 1 from jsonb_array_elements(o.items) x where x->>'description' = v_item) then
    return json_build_object('ok', false, 'error', format('"%s" is not an item of this order', v_item));
  end if;
  if coalesce(p_target,0) < 0 or coalesce(p_target,0) <> floor(coalesce(p_target,0)) then return json_build_object('ok', false, 'error', 'Target must be a whole number'); end if;
  if p_tl is not null and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
    return json_build_object('ok', false, 'error', 'Choose a Team Lead');
  end if;
  v_pm := case when v_role = 'gm' then 'Pending PM' else 'Accepted' end;
  insert into order_assignments (order_id, item_description, work_date, priority, target_qty, instructions, assigned_by, assigned_by_role,
                                 pm_status, pm_by, pm_at, tl_employee_id, tl_status, tl_assigned_by, tl_assigned_at)
  values (p_order_id, v_item, p_date, coalesce(p_priority,'Normal'), coalesce(p_target,0), nullif(trim(coalesce(p_instructions,'')),''), asg_who(), v_role,
          v_pm, case when v_pm = 'Accepted' then asg_who() end, case when v_pm = 'Accepted' then now() end,
          p_tl, case when p_tl is null then 'Not assigned' else 'Assigned' end, case when p_tl is null then null else asg_who() end, case when p_tl is null then null else now() end)
  returning id into v_id;
  perform asg_log(v_id, 'Created', format('%s priority for %s%s%s', coalesce(p_priority,'Normal'), p_date, case when v_item is null then '' else ' — ' || v_item end,
                  case when v_pm = 'Pending PM' then ' (waiting for the Production Manager)' else '' end));
  if p_tl is not null then perform asg_log(v_id, 'Team Lead', 'Assigned to ' || (select name from employees where id = p_tl)); end if;
  return json_build_object('ok', true, 'id', v_id, 'pm_status', v_pm);
end $$;

-- Change priority / date / target / notes. After the PM has accepted, a priority or date change needs a reason.
create or replace function update_assignment(
  p_id uuid, p_priority text default null, p_date date default null, p_target numeric default null,
  p_instructions text default null, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; chg text := ''; v_role text := my_role(); pc boolean; dc boolean;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can change an assignment'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.tl_status = 'Completed' then return json_build_object('ok', false, 'error', 'This work is already completed'); end if;
  if p_priority is not null and p_priority not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if p_target is not null and (p_target < 0 or p_target <> floor(p_target)) then return json_build_object('ok', false, 'error', 'Target must be a whole number'); end if;
  pc := p_priority is not null and p_priority <> a.priority;
  dc := p_date is not null and p_date <> a.work_date;
  if (pc or dc) and a.pm_status = 'Accepted' and length(trim(coalesce(p_reason,''))) < 3 then
    return json_build_object('ok', false, 'error', 'Write the reason for changing the priority or date');
  end if;
  if pc then chg := chg || format('priority %s → %s; ', a.priority, p_priority); end if;
  if dc then chg := chg || format('date %s → %s; ', a.work_date, p_date); end if;
  if p_target is not null and p_target <> a.target_qty then chg := chg || format('target %s → %s; ', a.target_qty, p_target); end if;
  update order_assignments set
    priority = coalesce(p_priority, priority),
    work_date = coalesce(p_date, work_date),
    target_qty = coalesce(p_target, target_qty),
    instructions = case when p_instructions is null then instructions else nullif(trim(p_instructions),'') end,
    -- a GM change on a PM-accepted plan goes back to the PM; a date change asks the Team Lead to accept again
    pm_status = case when v_role = 'gm' and (pc or dc) and pm_status = 'Accepted' then 'Pending PM' else pm_status end,
    tl_status = case when dc and tl_status in ('Accepted','In progress') then 'Assigned' else tl_status end
  where id = p_id;
  if chg <> '' or p_instructions is not null then
    perform asg_log(p_id, case when pc or dc then 'Changed' else 'Edited' end, trim(chg) || case when length(trim(coalesce(p_reason,''))) > 0 then ' Reason: ' || trim(p_reason) else '' end);
  end if;
  return json_build_object('ok', true);
end $$;

-- The Production Manager accepts what the GM assigned, optionally changing priority / date.
create or replace function pm_accept_assignment(p_id uuid, p_priority text default null, p_date date default null, p_reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; chg text := '';
begin
  if not asg_pm_or_admin() then return json_build_object('ok', false, 'error', 'Only the Production Manager can accept this'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.pm_status = 'Accepted' then return json_build_object('ok', false, 'error', 'Already accepted'); end if;
  if p_priority is not null and p_priority not in ('Top','High','Normal','Low') then return json_build_object('ok', false, 'error', 'Invalid priority'); end if;
  if (p_priority is not null and p_priority <> a.priority) or (p_date is not null and p_date <> a.work_date) then
    if length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for changing the priority or date'); end if;
    if p_priority is not null and p_priority <> a.priority then chg := chg || format('priority %s → %s; ', a.priority, p_priority); end if;
    if p_date is not null and p_date <> a.work_date then chg := chg || format('date %s → %s; ', a.work_date, p_date); end if;
  end if;
  update order_assignments set priority = coalesce(p_priority, priority), work_date = coalesce(p_date, work_date),
    pm_status = 'Accepted', pm_by = asg_who(), pm_at = now() where id = p_id;
  perform asg_log(p_id, 'PM accepted', trim(chg) || case when chg <> '' then ' Reason: ' || trim(p_reason) else '' end);
  return json_build_object('ok', true);
end $$;

-- Choose (or clear) the Team Lead.
create or replace function assign_team_lead(p_id uuid, p_tl uuid)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype;
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can assign a Team Lead'); end if;
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  if a.tl_status = 'Completed' then return json_build_object('ok', false, 'error', 'This work is already completed'); end if;
  if p_tl is not null and not exists (select 1 from profiles where employee_id = p_tl and role = 'tl') then
    return json_build_object('ok', false, 'error', 'Choose a Team Lead');
  end if;
  update order_assignments set tl_employee_id = p_tl, tl_status = case when p_tl is null then 'Not assigned' else 'Assigned' end,
    tl_assigned_by = case when p_tl is null then null else asg_who() end, tl_assigned_at = case when p_tl is null then null else now() end,
    tl_accepted_at = null, tl_started_at = null where id = p_id;
  perform asg_log(p_id, 'Team Lead', case when p_tl is null then 'Team Lead removed' else 'Assigned to ' || (select name from employees where id = p_tl) end);
  return json_build_object('ok', true);
end $$;

-- The Team Lead's own actions: accept, decline, start, complete.
create or replace function tl_update_assignment(p_id uuid, p_action text, p_qty numeric default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare a order_assignments%rowtype; mine boolean;
begin
  select * into a from order_assignments where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Assignment not found'); end if;
  mine := a.tl_employee_id is not null and a.tl_employee_id = my_employee_id();
  if not (mine or asg_pm_or_admin()) then return json_build_object('ok', false, 'error', 'This work is not assigned to you'); end if;
  if a.pm_status <> 'Accepted' then return json_build_object('ok', false, 'error', 'Waiting for the Production Manager to accept this plan'); end if;
  if p_action = 'accept' then
    if a.tl_status <> 'Assigned' then return json_build_object('ok', false, 'error', 'Nothing to accept'); end if;
    update order_assignments set tl_status = 'Accepted', tl_accepted_at = now() where id = p_id;
    perform asg_log(p_id, 'TL accepted', null);
  elsif p_action = 'decline' then
    if a.tl_status not in ('Assigned','Accepted') then return json_build_object('ok', false, 'error', 'Cannot decline now'); end if;
    if length(trim(coalesce(p_note,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason'); end if;
    update order_assignments set tl_status = 'Declined', tl_note = trim(p_note) where id = p_id;
    perform asg_log(p_id, 'TL declined', trim(p_note));
  elsif p_action = 'start' then
    if a.tl_status <> 'Accepted' then return json_build_object('ok', false, 'error', 'Accept the work first'); end if;
    update order_assignments set tl_status = 'In progress', tl_started_at = now() where id = p_id;
    perform asg_log(p_id, 'Started', null);
  elsif p_action = 'complete' then
    if a.tl_status not in ('Accepted','In progress') then return json_build_object('ok', false, 'error', 'Accept the work first'); end if;
    if p_qty is not null and (p_qty < 0 or p_qty <> floor(p_qty)) then return json_build_object('ok', false, 'error', 'Pieces must be a whole number'); end if;
    update order_assignments set tl_status = 'Completed', tl_completed_at = now(), completed_qty = p_qty,
      tl_note = coalesce(nullif(trim(coalesce(p_note,'')),''), tl_note) where id = p_id;
    perform asg_log(p_id, 'Completed', coalesce(p_qty::text || ' pcs. ', '') || coalesce(trim(p_note), ''));
  else
    return json_build_object('ok', false, 'error', 'Unknown action');
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function delete_assignment(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not asg_manager() then return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can remove an assignment'); end if;
  if exists (select 1 from order_assignments where id = p_id and tl_status in ('In progress','Completed')) then
    return json_build_object('ok', false, 'error', 'Work that has started cannot be removed');
  end if;
  delete from order_assignments where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ============================================================ 2. Day-end report
create table if not exists day_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  data jsonb not null default '{}',
  generated_by text,
  generated_at timestamptz default now(),
  auto boolean not null default false
);
alter table day_reports enable row level security;
drop policy if exists "day_reports_select" on day_reports;
create policy "day_reports_select" on day_reports for select using (auth.role() = 'authenticated');
do $$ begin alter publication supabase_realtime add table day_reports; exception when others then null; end $$;

-- Builds the day's report from attendance, hourly progress, assignments, approved/submitted cutting and sales activity.
-- Admin / HR / GM / PM can run it; the 6 PM schedule runs it with no user (auth.uid() is null).
create or replace function generate_day_report(p_date date default null, p_auto boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
        att jsonb; teams jsonb; unplanned jsonb; byitem jsonb; cut jsonb; sales jsonb; res jsonb; total_out numeric; v_id uuid;
begin
  if auth.uid() is not null and not asg_manager() then
    return json_build_object('ok', false, 'error', 'Only Admin, General Manager or Production Manager can generate the day report');
  end if;

  -- attendance: operators = employees with role Production; staff = everyone else except Sales
  with e as (
    select x.id, x.name, case when x.role = 'Production' then 'operators' else 'staff' end as grp,
           (a.status in ('Present','Half Day')) as present
      from employees x left join attendance a on a.employee_id = x.id and a.date = d
     where coalesce(x.status,'Active') <> 'Inactive' and x.role <> 'Sales'
  )
  select jsonb_build_object(
    'operators', jsonb_build_object('total', count(*) filter (where grp='operators'), 'present', count(*) filter (where grp='operators' and present),
                  'absent', coalesce(jsonb_agg(name order by name) filter (where grp='operators' and not coalesce(present,false)), '[]')),
    'staff', jsonb_build_object('total', count(*) filter (where grp='staff'), 'present', count(*) filter (where grp='staff' and present),
                  'absent', coalesce(jsonb_agg(name order by name) filter (where grp='staff' and not coalesce(present,false)), '[]')))
  into att from e;

  select coalesce(sum(quantity),0) into total_out from order_progress where date = d;

  select coalesce(jsonb_agg(jsonb_build_object('team_lead', t.tl, 'order_number', t.order_number, 'customer_name', t.customer_name, 'item', t.item,
           'priority', t.priority, 'status', t.tl_status, 'target', t.target_qty, 'output', t.output) order by t.tl nulls last, t.order_number), '[]')
  into teams from (
    select e.name as tl, o.order_number, o.customer_name, a.item_description as item, a.priority, a.tl_status, a.target_qty,
           (select coalesce(sum(p.quantity),0) from order_progress p where p.order_id = a.order_id and p.date = d
               and (a.item_description is null or p.item_description = a.item_description)) as output
      from order_assignments a join orders o on o.id = a.order_id left join employees e on e.id = a.tl_employee_id
     where a.work_date = d and a.pm_status = 'Accepted') t;

  -- output on orders that were not in the day's plan
  select coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'item', p.item_description, 'output', p.q) order by o.order_number), '[]')
  into unplanned from (select order_id, item_description, sum(quantity) q from order_progress where date = d group by 1,2 having sum(quantity) > 0) p
  join orders o on o.id = p.order_id
  where not exists (select 1 from order_assignments a where a.order_id = p.order_id and a.work_date = d and a.pm_status = 'Accepted'
                      and (a.item_description is null or a.item_description = p.item_description));

  select coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'item', p.item_description, 'output', p.q) order by o.order_number, p.item_description), '[]')
  into byitem from (select order_id, item_description, sum(quantity) q from order_progress where date = d group by 1,2 having sum(quantity) > 0) p
  join orders o on o.id = p.order_id;

  select coalesce(jsonb_agg(jsonb_build_object('by', c.submitted_by, 'order_number', o.order_number, 'customer_name', o.customer_name, 'item', c.item_description,
           'sizes', c.sizes, 'kg', coalesce(c.fabric_kg_used,0), 'meters', coalesce(c.fabric_meters_used,0), 'status', c.status) order by c.created_at), '[]')
  into cut from cutting_entries c left join orders o on o.id = c.order_id where c.cut_date = d and c.status <> 'Rejected';

  select jsonb_build_object(
    'activities', coalesce((select jsonb_agg(jsonb_build_object('kind', la.kind, 'company', sl.company_name, 'location', la.location, 'contact', la.contact_person,
                   'by', la.logged_by, 'response', la.customer_response, 'next', la.next_followup_date) order by la.created_at)
                   from lead_activities la join sales_leads sl on sl.id = la.lead_id where la.activity_date = d), '[]'),
    'new_leads', coalesce((select jsonb_agg(jsonb_build_object('company', sl.company_name, 'type', sl.lead_type, 'by', e.name, 'status', sl.status) order by sl.created_at)
                   from sales_leads sl left join employees e on e.id = sl.salesperson_id
                  where (sl.created_at at time zone 'Asia/Kolkata')::date = d), '[]'),
    'customer_visits', coalesce((select jsonb_agg(jsonb_build_object('customer', c.name, 'by', v.logged_by, 'notes', v.notes) order by v.created_at)
                   from customer_visits v join sales_customers c on c.id = v.customer_id where v.visit_date = d), '[]'),
    'followups_due', (select count(*) from sales_leads where next_followup_date = d))
  into sales;

  res := jsonb_build_object('date', d, 'attendance', att, 'teams', teams, 'unplanned', unplanned, 'by_item', byitem,
                            'total_output', total_out, 'cutting', cut, 'sales', sales);
  insert into day_reports (report_date, data, generated_by, generated_at, auto)
  values (d, res, case when auth.uid() is null then 'Auto (6 PM)' else asg_who() end, now(), p_auto and auth.uid() is null)
  on conflict (report_date) do update set data = excluded.data, generated_by = excluded.generated_by, generated_at = now(), auto = excluded.auto
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- Ask Supabase to run it every day at 6 PM IST (12:30 UTC). Needs the pg_cron extension (Database -> Extensions).
-- If it is not available the app still creates the report the first time Admin / GM / PM opens the dashboard after 6 PM.
do $$
begin
  create extension if not exists pg_cron;
  begin perform cron.unschedule('tp-day-report'); exception when others then null; end;
  perform cron.schedule('tp-day-report', '30 12 * * *', 'select generate_day_report(null, true)');
exception when others then
  raise notice 'pg_cron is not available - the 6 PM report will be created from the app instead (%).', sqlerrm;
end $$;
