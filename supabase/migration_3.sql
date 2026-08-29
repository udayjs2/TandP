-- Migration 3 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: expense/bill claims for sales team (food, petrol, transport) with
-- receipt photo upload, submitted by staff and reviewed/processed by admin.

-- 1. Expense claims table
create table if not exists expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  category text not null default 'Other', -- Food, Petrol, Transport, Other
  transport_mode text, -- Bus, Auto, Own Vehicle, Train, Other (only relevant for Petrol/Transport)
  amount numeric not null default 0,
  expense_date date not null,
  description text,
  receipt_path text, -- path inside the 'bills' storage bucket
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected','Reimbursed')),
  admin_notes text,
  submitted_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table expense_claims enable row level security;

-- Staff can see their own claims (matched via their linked employee_id); admins see all
create policy "expense_claims_select" on expense_claims for select using (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);

-- Staff can submit a claim for themselves only; admins can submit for anyone
create policy "expense_claims_insert" on expense_claims for insert with check (
  is_admin() or employee_id = (select employee_id from profiles where id = auth.uid())
);

-- Staff can edit their own claim only while it's still "Submitted" (unprocessed);
-- admins can update any claim at any time (to approve/reject/mark reimbursed)
create policy "expense_claims_update" on expense_claims for update using (
  is_admin() or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Submitted'
  )
);

-- Same rule for deleting (withdraw an unprocessed claim)
create policy "expense_claims_delete" on expense_claims for delete using (
  is_admin() or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Submitted'
  )
);

alter publication supabase_realtime add table expense_claims;

-- 2. Storage bucket for receipt photos (private — access controlled by policies below)
insert into storage.buckets (id, name, public)
values ('bills', 'bills', false)
on conflict (id) do nothing;

-- Files are stored as "<employee_id>/<filename>" so folder-based policies can
-- scope access to the employee that owns them.
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
