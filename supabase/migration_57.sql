-- migration_57.sql — v65: measurements belong to an ORDER (no separate school list). Run after migration_56.sql. Safe to run twice.
alter table measurement_students add column if not exists order_id uuid references orders(id) on delete cascade;
alter table measurement_students alter column school_id drop not null;
create index if not exists measurement_students_order_idx on measurement_students(order_id);
-- students entered under a school that was linked to an order move to that order
update measurement_students s set order_id = sc.order_id
from measurement_schools sc where s.school_id = sc.id and s.order_id is null and sc.order_id is not null;
