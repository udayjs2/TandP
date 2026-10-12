-- Migration 25 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Part 1 of the new org-structure rollout: new roles (GM, PM, TL, Cutting
-- Master, Sales), HR upgraded to full admin-equivalent access, a reporting
-- manager chain on employees, and profile emails (needed so GM/PM/HR can
-- trigger a password reset for staff).

-- 1. Allow the new role values
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales'));

-- 2. HR now has the SAME access as Admin everywhere. Rather than rewrite
-- every single RLS policy in this app (there are dozens), this redefines
-- the one function almost all of them already call — is_admin() — so it
-- also returns true for 'hr'. This is the one place that needs to change.
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','hr')
  );
$$ language sql security definer stable;

-- 3. Store each login's email (captured at signup) so admin/HR/GM/PM can
-- trigger a "reset your password" email for someone without needing their
-- own elevated database credentials — just the standard, public
-- supabase.auth.resetPasswordForEmail(email) call.
alter table profiles add column if not exists email text;

create or replace function handle_new_user()
returns trigger as $$
declare
  matched_role text;
begin
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

-- 4. Reporting manager chain: every employee can have a manager, who is
-- also an employee (Team Lead -> Production Manager -> General Manager).
alter table employees add column if not exists reporting_manager_id uuid references employees(id) on delete set null;

-- Helper: is the current user GM, PM, or admin/hr? Used for Cutting
-- approvals and the limited User Management (password-reset-only) view.
create or replace function is_gm_pm_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles where id = auth.uid() and role in ('gm','pm')
  );
$$ language sql security definer stable;

-- Helper: is the current user the Cutting Master, or admin/hr?
create or replace function is_cutting_or_admin()
returns boolean as $$
  select is_admin() or exists (
    select 1 from profiles where id = auth.uid() and role = 'cutting_master'
  );
$$ language sql security definer stable;
