-- Migration 22 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds offer letter generation: fill in a form (father/husband name,
-- address, salary breakup, joining date, etc.) and get a printable offer
-- letter with your company letterhead, matching your standard template.

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

alter table offer_letters enable row level security;
create policy "offer_letters_admin_only" on offer_letters for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table offer_letters;
