-- Migration 18 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Fixes "Database error saving new user" on signup. This happens when the
-- handle_new_user() trigger throws an error — and because it runs on every
-- signup, a single bad reference in it (e.g. querying a table that isn't
-- there yet) blocks EVERYONE from creating an account, not just one person.
--
-- This migration is self-healing: it re-creates anything the trigger
-- depends on (in case an earlier migration was missed) AND rewrites the
-- trigger itself to never hard-fail a signup again, even if something it
-- expects is missing in the future.

-- 1. Make sure role_invitations exists (in case migration_7 was skipped)
create table if not exists role_invitations (
  email text primary key,
  intended_role text not null check (intended_role in ('admin','user','hr')),
  name_hint text,
  invited_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table role_invitations enable row level security;
drop policy if exists "role_invitations_admin_only" on role_invitations;
create policy "role_invitations_admin_only" on role_invitations for all using (is_admin()) with check (is_admin());

-- 2. Make sure 'hr' is a valid role (in case migration_6 was skipped)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','user','hr'));

-- 3. Rewrite the signup trigger to be exception-safe: if looking up an
-- invitation fails for ANY reason, it just falls back to the default
-- 'user' role instead of blocking the signup entirely.
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

  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), coalesce(matched_role, 'user'));

  begin
    delete from role_invitations where lower(email) = lower(new.email);
  exception when others then
    null; -- cleanup failing should never block the signup that already succeeded
  end;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
