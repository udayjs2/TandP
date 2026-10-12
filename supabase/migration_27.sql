-- Migration 27 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Part 3: leave requests. An employee submits a request; it's routed to
-- their reporting manager (set per-employee in the Employees tab) for
-- approval or rejection. Admin/HR can see and act on every request too.

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

alter table leave_requests enable row level security;

-- An employee can see their own requests; admin/hr see everything; a
-- reporting manager can see requests from people who report to them
-- (matched via their own linked employee_id being the requester's
-- reporting_manager_id).
create policy "leave_requests_select" on leave_requests for select using (
  is_admin()
  or employee_id = (select employee_id from profiles where id = auth.uid())
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
);

-- An employee can submit their own request only.
create policy "leave_requests_insert" on leave_requests for insert with check (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);

-- Approve/reject: admin/hr, or the requester's own reporting manager.
-- An employee can also edit their own request while it's still Pending
-- (e.g. to fix a typo) but not after it's been decided.
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

alter publication supabase_realtime add table leave_requests;
