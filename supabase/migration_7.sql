-- Migration 7 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds a "User Management" system: admins can invite someone by email with a
-- pre-assigned role (Admin / HR / Staff). When that person signs up using
-- the exact same email, they automatically get the intended role instead of
-- the default Staff role — no manual SQL or table editing needed afterward.
--
-- Note: this does NOT let an admin set someone's password directly (that
-- would require a Supabase Edge Function with the service-role key, which
-- is extra infrastructure beyond this app's current setup — ask if you want
-- that built out too). This approach still requires the invited person to
-- complete "Create account" themselves, but the role they land with is
-- fully controlled by the admin ahead of time.

-- 1. Pending role invitations
create table if not exists role_invitations (
  email text primary key,
  intended_role text not null check (intended_role in ('admin','hr','user')),
  name_hint text,
  invited_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table role_invitations enable row level security;
create policy "role_invitations_admin_only" on role_invitations for all using (is_admin()) with check (is_admin());

alter publication supabase_realtime add table role_invitations;

-- 2. Update the signup trigger to check for a matching invitation and use
-- its intended role instead of defaulting everyone to 'user'.
create or replace function handle_new_user()
returns trigger as $$
declare
  matched_role text;
begin
  select intended_role into matched_role
  from role_invitations
  where lower(email) = lower(new.email)
  limit 1;

  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), coalesce(matched_role, 'user'));

  delete from role_invitations where lower(email) = lower(new.email);

  return new;
end;
$$ language plpgsql security definer;
