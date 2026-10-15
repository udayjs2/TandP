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
