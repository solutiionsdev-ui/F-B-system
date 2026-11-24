// Database-level safety net. The app connects as a privileged role but runs
// every tenant request inside a transaction that switches to `app_user` and
// sets app.org_id / app.user_id / app.role. Row-level security then limits
// that request to one restaurant group and one role's permissions, even if
// application code forgets a filter.
export const migration0002 = /* sql */ `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;
grant app_user to current_user;
grant usage on schema public to app_user;

create or replace function app_org_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;
create or replace function app_user_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app_role() returns text language sql stable as
  $$ select nullif(current_setting('app.role', true), '') $$;

-- ---------- grants ----------
grant select on organizations, memberships to app_user;
grant update (name, cost_data_verified, variance_tolerance_cents) on organizations to app_user;
grant select (id, name, email) on users to app_user;
grant select, insert, update on locations, expense_categories, business_days, expenses to app_user;
grant select, insert, update, delete on sales_lines, cash_counts, cash_movements to app_user;
grant select, insert on exchange_rates, day_closings, adjustments to app_user;
grant select on audit_log to app_user;

-- ---------- row-level security ----------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'memberships', 'users', 'locations', 'exchange_rates',
    'business_days', 'sales_lines', 'expense_categories', 'expenses', 'cash_movements',
    'cash_counts', 'day_closings', 'adjustments', 'audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;

  -- Day-to-day operations: everyone in the group can read, owners and managers can write.
  foreach t in array array['business_days', 'sales_lines', 'expenses', 'cash_movements', 'cash_counts',
    'day_closings', 'expense_categories', 'exchange_rates'] loop
    execute format('create policy tenant_read on %I for select using (org_id = app_org_id())', t);
    execute format($p$create policy ops_insert on %I for insert
      with check (org_id = app_org_id() and app_role() in ('owner', 'manager'))$p$, t);
    execute format($p$create policy ops_update on %I for update
      using (org_id = app_org_id() and app_role() in ('owner', 'manager'))
      with check (org_id = app_org_id() and app_role() in ('owner', 'manager'))$p$, t);
    execute format($p$create policy ops_delete on %I for delete
      using (org_id = app_org_id() and app_role() in ('owner', 'manager'))$p$, t);
  end loop;
end $$;

create policy tenant_read on organizations for select using (id = app_org_id());
create policy owner_update on organizations for update
  using (id = app_org_id() and app_role() = 'owner') with check (id = app_org_id());

create policy tenant_read on memberships for select using (org_id = app_org_id());
create policy tenant_read on users for select
  using (exists (select 1 from memberships m where m.user_id = users.id and m.org_id = app_org_id()));

create policy tenant_read on locations for select using (org_id = app_org_id());
create policy owner_write on locations for insert with check (org_id = app_org_id() and app_role() = 'owner');
create policy owner_update on locations for update
  using (org_id = app_org_id() and app_role() = 'owner') with check (org_id = app_org_id());

-- Corrections after close: owners and accountants.
create policy tenant_read on adjustments for select using (org_id = app_org_id());
create policy adjust_insert on adjustments for insert
  with check (org_id = app_org_id() and app_role() in ('owner', 'accountant'));

-- Audit trail: owners and accountants read it; rows are only written by the trigger below.
create policy audit_read on audit_log for select
  using (org_id = app_org_id() and app_role() in ('owner', 'accountant'));
create policy audit_write on audit_log for insert with check (true);

-- ---------- closed days are locked ----------
create or replace function enforce_day_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  day_ids uuid[];
  closed_count int;
begin
  if tg_op = 'INSERT' then
    day_ids := array[new.business_day_id];
  elsif tg_op = 'DELETE' then
    day_ids := array[old.business_day_id];
  else
    day_ids := array[old.business_day_id, new.business_day_id];
  end if;
  select count(*) into closed_count from business_days
    where id = any(day_ids) and status = 'closed';
  if closed_count > 0 then
    raise exception 'This business day is closed. Record a correction as an adjustment instead.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger lock_closed_day before insert or update or delete on sales_lines
  for each row execute function enforce_day_open();
create trigger lock_closed_day before insert or update or delete on expenses
  for each row execute function enforce_day_open();
create trigger lock_closed_day before insert or update or delete on cash_movements
  for each row execute function enforce_day_open();
create trigger lock_closed_day before insert or update or delete on cash_counts
  for each row execute function enforce_day_open();

create or replace function guard_business_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Business days cannot be deleted.' using errcode = 'P0001';
  end if;
  if old.status = 'closed' then
    raise exception 'This business day is closed and cannot be changed.' using errcode = 'P0001';
  end if;
  if new.rate_id <> old.rate_id or new.location_id <> old.location_id
     or new.business_date <> old.business_date or new.org_id <> old.org_id then
    raise exception 'A business day''s date, location and rate cannot be changed after opening.' using errcode = 'P0001';
  end if;
  if new.status = 'closed' and not exists (select 1 from day_closings where business_day_id = new.id) then
    raise exception 'A day can only be closed through the closing workflow.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_business_day before update or delete on business_days
  for each row execute function guard_business_day();

-- ---------- append-only tables ----------
create or replace function deny_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; records cannot be changed or deleted.', tg_table_name
    using errcode = 'P0001';
end $$;

create trigger append_only before update or delete on exchange_rates
  for each row execute function deny_change();
create trigger append_only before update or delete on day_closings
  for each row execute function deny_change();
create trigger append_only before update or delete on adjustments
  for each row execute function deny_change();
create trigger append_only before update or delete on audit_log
  for each row execute function deny_change();
create trigger append_only_truncate before truncate on audit_log
  for each statement execute function deny_change();

-- ---------- audit trail ----------
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_j jsonb;
  new_j jsonb;
  rec jsonb;
  org uuid;
begin
  if tg_op <> 'INSERT' then old_j := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_j := to_jsonb(new); end if;
  rec := coalesce(new_j, old_j);
  if tg_table_name = 'organizations' then
    org := (rec ->> 'id')::uuid;
  else
    org := (rec ->> 'org_id')::uuid;
  end if;
  insert into audit_log (org_id, user_id, table_name, op, row_id, old_data, new_data)
  values (org, app_user_id(), tg_table_name, tg_op, rec ->> 'id', old_j, new_j);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'memberships', 'locations', 'exchange_rates', 'business_days',
    'sales_lines', 'expense_categories', 'expenses', 'cash_movements', 'cash_counts',
    'day_closings', 'adjustments'] loop
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_row()', t);
  end loop;
end $$;
`;
