-- Migration 28 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Two changes:
-- 1. Sales staff can now tag an expense claim to a specific order (or
--    "Marketing / Other" if it isn't tied to one).
-- 2. When admin marks a claim "Reimbursed", it's now automatically added
--    to the central Expenditures ledger — via a database trigger, so it
--    happens no matter which screen is used to mark it reimbursed.

alter table expense_claims add column if not exists linked_order_id uuid references orders(id) on delete set null;
alter table expenditures add column if not exists source_claim_id uuid references expense_claims(id) on delete set null;

create or replace function sync_reimbursed_expense_to_expenditure()
returns trigger as $$
begin
  if new.status = 'Reimbursed' and (old.status is distinct from 'Reimbursed') then
    -- idempotent: don't double-insert if this claim was already synced before
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
