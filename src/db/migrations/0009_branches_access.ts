// FINCTRL v2.0, Phase 2: branches and access (spec 2.3, 6.1, 17.2, 17.3,
// screen 8 and acceptance test A).
//
// - Venues get a type, a business-day cutoff hour and a status.
// - Managers and accountants see only the venues assigned to them
//   (membership_locations). Owners always see every venue. Enforced by
//   restrictive row-level security on every venue's records, so a query that
//   forgets a filter still can't reach another venue.
// - Each membership can carry permission overrides; the app works out the
//   final list from the role's defaults (lib/permissions.ts) and hands it to
//   the database as app.permissions, which the write policies check.
// - The audit trail shows each person only their venues' events; team changes
//   stay with owners.
//
// Existing data: every existing manager and accountant is assigned every
// existing venue, existing managers keep the right to change the rate and
// existing accountants keep the right to post corrections, so nobody loses
// access they had. Owners can narrow this in Team & Access. No financial
// record is changed.
export const migration0009 = /* sql */ `
-- ---------- venues
alter table locations
  add column venue_type text not null default 'other' check (venue_type in ('restaurant', 'cafe', 'pub', 'other')),
  add column day_cutoff_hour smallint not null default 5 check (day_cutoff_hour between 0 and 11),
  add column status text not null default 'active' check (status in ('active', 'archived'));

alter table organizations
  add column status text not null default 'active' check (status in ('active', 'suspended', 'closed'));

-- ---------- per-person permission overrides
alter table memberships
  add column permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object');
alter table memberships add constraint memberships_id_org unique (id, org_id);
grant update (permissions) on memberships to app_user;

update memberships set permissions = permissions || '{"change_rate": true}'::jsonb where role = 'manager';
update memberships set permissions = permissions || '{"post_corrections": true}'::jsonb where role = 'accountant';

-- ---------- assigned venues
create table membership_locations (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null,
  location_id uuid not null,
  org_id uuid not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (membership_id, location_id),
  foreign key (membership_id, org_id) references memberships(id, org_id) on delete cascade,
  foreign key (location_id, org_id) references locations(id, org_id)
);
create index membership_locations_location on membership_locations (location_id);

insert into membership_locations (membership_id, location_id, org_id)
  select m.id, l.id, m.org_id
    from memberships m join locations l on l.org_id = m.org_id
   where m.role <> 'owner';

alter table invitations
  add column location_ids uuid[] not null default '{}',
  add column note text;

-- ---------- who may do what, and where
create or replace function app_permissions() returns text[] language sql stable as
  $$ select string_to_array(coalesce(current_setting('app.permissions', true), ''), ',') $$;

create or replace function app_can(p text) returns boolean language sql stable as
  $$ select app_role() = 'owner' or p = any(app_permissions()) $$;

-- The venues the current person may see; null for owners, who see every venue.
create or replace function app_location_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when app_role() = 'owner' then null else coalesce((
    select array_agg(ml.location_id)
      from membership_locations ml
      join memberships m on m.id = ml.membership_id
     where m.user_id = app_user_id() and m.org_id = app_org_id()
  ), '{}') end
$$;

alter table membership_locations enable row level security;
grant select, insert, delete on membership_locations to app_user;
create policy tenant_read on membership_locations for select using (
  org_id = app_org_id()
  and (app_role() = 'owner' or membership_id in (select id from memberships where user_id = app_user_id()))
);
create policy owner_insert on membership_locations for insert with check (org_id = app_org_id() and app_role() = 'owner');
create policy owner_delete on membership_locations for delete using (org_id = app_org_id() and app_role() = 'owner');
create trigger audit after insert or update or delete on membership_locations
  for each row execute function audit_row();

-- Venue scoping. Restrictive policies are ANDed with the existing ones.
-- (select ...) makes Postgres work the venue list out once per query.
create policy venue_scope on locations as restrictive for all to app_user
  using ((select app_role()) = 'owner' or id = any((select app_location_ids())::uuid[]))
  with check ((select app_role()) = 'owner' or id = any((select app_location_ids())::uuid[]));

do $$
declare t text;
begin
  foreach t in array array['business_days', 'sales_lines', 'expenses', 'pos_imports'] loop
    execute format($p$create policy venue_scope on %I as restrictive for all to app_user
      using ((select app_role()) = 'owner' or location_id = any((select app_location_ids())::uuid[]))
      with check ((select app_role()) = 'owner' or location_id = any((select app_location_ids())::uuid[]))$p$, t);
  end loop;
  -- These hang off a business day, which is itself venue-scoped.
  foreach t in array array['cash_movements', 'cash_counts', 'day_closings', 'adjustments'] loop
    execute format($p$create policy venue_scope on %I as restrictive for all to app_user
      using (business_day_id in (select id from business_days))
      with check (business_day_id in (select id from business_days))$p$, t);
  end loop;
end $$;

-- Writes follow the permission matrix instead of the role alone.
do $$
declare t text;
begin
  foreach t in array array['business_days', 'sales_lines', 'expenses', 'cash_movements', 'cash_counts',
    'day_closings', 'expense_categories', 'exchange_rates', 'pos_imports', 'pos_profiles'] loop
    execute format('drop policy if exists ops_insert on %I', t);
    execute format('drop policy if exists ops_update on %I', t);
    execute format('drop policy if exists ops_delete on %I', t);
  end loop;
end $$;
drop policy draft_delete on pos_imports;
drop policy adjust_insert on adjustments;

create or replace function create_write_policies(t text, rule text) returns void language plpgsql as $f$
begin
  execute format('create policy perm_insert on %I for insert with check (org_id = app_org_id() and (%s))', t, rule);
  execute format('create policy perm_update on %I for update using (org_id = app_org_id() and (%s)) with check (org_id = app_org_id() and (%s))', t, rule, rule);
  execute format('create policy perm_delete on %I for delete using (org_id = app_org_id() and (%s))', t, rule);
end $f$;

-- Opening, counting and closing a day.
select create_write_policies('business_days', $r$app_can('close_days') or app_can('import_pos')$r$);
select create_write_policies('cash_counts', $r$app_can('close_days')$r$);
select create_write_policies('day_closings', $r$app_can('close_days')$r$);
-- Sales, typed in from the POS report or imported.
select create_write_policies('sales_lines', $r$app_can('import_pos')$r$);
select create_write_policies('pos_profiles', $r$app_can('import_pos')$r$);
create policy perm_insert on pos_imports for insert with check (org_id = app_org_id() and app_can('import_pos'));
create policy perm_update on pos_imports for update
  using (org_id = app_org_id() and app_can('import_pos')) with check (org_id = app_org_id() and app_can('import_pos'));
create policy draft_delete on pos_imports for delete
  using (org_id = app_org_id() and app_can('import_pos') and status = 'draft');
-- Operating expenses and cash movements.
select create_write_policies('expenses', $r$app_can('record_transactions')$r$);
select create_write_policies('cash_movements', $r$app_can('record_transactions')$r$);
-- The rate and the category list.
select create_write_policies('exchange_rates', $r$app_can('change_rate')$r$);
select create_write_policies('expense_categories', $r$app_role() = 'owner'$r$);
-- Corrections on closed days.
create policy perm_insert on adjustments for insert with check (org_id = app_org_id() and app_can('post_corrections'));

drop function create_write_policies(text, text);

-- ---------- audit trail: each person's venues; team changes stay with owners
create or replace function audit_location(t text, n jsonb, o jsonb) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when t = 'locations' then (coalesce(n, o) ->> 'id')::uuid
    when coalesce(n, o) ? 'location_id' then (coalesce(n, o) ->> 'location_id')::uuid
    when coalesce(n, o) ? 'business_day_id' then
      (select d.location_id from business_days d where d.id = (coalesce(n, o) ->> 'business_day_id')::uuid)
    else null
  end
$$;

drop policy audit_read on audit_log;
create policy audit_read on audit_log for select using (
  org_id = app_org_id() and (
    app_role() = 'owner'
    or (
      app_can('view_audit')
      and table_name not in ('memberships', 'membership_locations', 'invitations')
      and case
        when audit_location(table_name, new_data, old_data) is null then app_role() = 'accountant'
        else audit_location(table_name, new_data, old_data) = any((select app_location_ids())::uuid[])
      end
    )
  )
);

-- Down (reverse order):
--   restore audit_read (owner/accountant), the ops_* policies, adjust_insert and draft_delete from 0002, 0004 and 0005;
--   drop policy venue_scope on each scoped table; drop table membership_locations;
--   drop function audit_location, app_location_ids, app_can, app_permissions;
--   alter table invitations drop column location_ids, drop column note;
--   alter table memberships drop constraint memberships_id_org, drop column permissions;
--   alter table organizations drop column status;
--   alter table locations drop column venue_type, drop column day_cutoff_hour, drop column status;
`;
