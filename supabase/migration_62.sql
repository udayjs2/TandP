-- migration_62.sql — v72: public holidays. Run after migration_61.sql. Safe to run twice.
-- "public" = paid day off (no deduction, not counted as leave); "optional" = shown on the calendar only.
create table if not exists holidays (
  date date primary key,
  name text not null,
  kind text not null default 'public' check (kind in ('public','optional')),
  created_at timestamptz default now()
);
alter table holidays enable row level security;
drop policy if exists holidays_read on holidays;
create policy holidays_read on holidays for select to authenticated using (true);
drop policy if exists holidays_write on holidays;
create policy holidays_write on holidays for all to authenticated
  using (coalesce(is_admin(), false) or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('hr','gm')))
  with check (coalesce(is_admin(), false) or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('hr','gm')));

insert into holidays (date, name, kind) values
  ('2026-12-25','Christmas','public'),
  ('2027-01-14','Bhogi','optional'),
  ('2027-01-15','Makara Sankranti','public'),
  ('2027-01-26','Republic Day','public'),
  ('2027-04-07','Ugadi','optional'),
  ('2027-08-13','Varalakshmi Vratham','optional'),
  ('2027-08-15','Independence Day & Eid-e-Milad (tentative)','public'),
  ('2027-09-04','Vinayaka Chavithi','public'),
  ('2027-10-02','Mahatma Gandhi Jayanti','public'),
  ('2027-10-09','Vijaya Dashami (Dussehra)','public'),
  ('2027-10-29','Deepavali','public'),
  ('2027-12-25','Christmas','public')
on conflict (date) do nothing;

-- leave days skip Sundays and public holidays (no longer immutable: it reads the holidays table)
create or replace function leave_working_days(p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric from generate_series(p_from, p_to, interval '1 day') d
  where extract(dow from d) <> 0 and not exists (select 1 from holidays h where h.date = d::date and h.kind = 'public');
$$;
