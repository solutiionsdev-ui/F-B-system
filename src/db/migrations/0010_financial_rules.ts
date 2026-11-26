// FINCTRL v2.0: the strict financial rules (spec 8.5, 9.2, 10 and 12).
//
// 1. Every business uses the eight universal expense categories. Old
//    categories are renamed where one maps cleanly onto a new one (their
//    expenses move with the name) or archived with a pointer to the category
//    they roll up into for reports. No expense row is rewritten.
// 2. Cash movements: a partner withdrawal carries the partner's name, and an
//    opening float adjustment is its own movement type. The opening float a
//    day was opened with can no longer be overwritten: adjustments are added
//    beside it and the adjusted float is used once in the expected cash.
// 3. Toters and NokNok become payment types of their own, so delivery-app
//    sales are shown apart from other non-cash payments and never treated as
//    drawer cash.
// 4. A saved POS format can carry a short note (for example that a mapping is
//    a demo one, still to be confirmed against a real export).
//
// Additive: existing sales, expenses, movements, counts and closings are not
// changed. Down steps are listed at the end.
export const migration0010 = /* sql */ `
-- ---------- 1. the eight universal categories
alter table expense_categories add column rolls_up_to uuid;
alter table expense_categories
  add constraint expense_categories_rolls_up foreign key (rolls_up_to, org_id) references expense_categories(id, org_id);

do $$
declare
  o record;
  m record;
  target uuid;
  names text[] := array[
    'Salaries & Wages',
    'Food & Kitchen Suppliers',
    'Beverage, Coffee & Bar Suppliers',
    'Generator & Electricity',
    'Rent & Municipal Fees',
    'Packaging & Delivery Supplies',
    'Cleaning, Maintenance & Repairs',
    'Miscellaneous / Petty Cash'
  ];
begin
  for o in select id from organizations loop
    for m in select * from (values
      ('Beverage & Alcohol Suppliers', 'Beverage, Coffee & Bar Suppliers'),
      ('Maintenance & Repairs', 'Cleaning, Maintenance & Repairs'),
      ('Miscellaneous', 'Miscellaneous / Petty Cash')
    ) as t(old_name, new_name) loop
      update expense_categories set name = m.new_name
       where org_id = o.id and name = m.old_name
         and not exists (select 1 from expense_categories x where x.org_id = o.id and x.name = m.new_name);
    end loop;

    insert into expense_categories (org_id, name)
      select o.id, n from unnest(names) as n
      on conflict (org_id, name) do nothing;

    update expense_categories c set position = p.ord, archived = false, rolls_up_to = null
      from unnest(names) with ordinality as p(name, ord)
     where c.org_id = o.id and c.name = p.name;

    -- Folded into a universal category: kept on past expenses, rolled up in reports.
    for m in select * from (values
      ('Cleaning', 'Cleaning, Maintenance & Repairs'),
      ('Maintenance & Repairs', 'Cleaning, Maintenance & Repairs'),
      ('Beverage & Alcohol Suppliers', 'Beverage, Coffee & Bar Suppliers'),
      ('Miscellaneous', 'Miscellaneous / Petty Cash'),
      ('Marketing', 'Miscellaneous / Petty Cash')
    ) as t(old_name, new_name) loop
      select id into target from expense_categories where org_id = o.id and name = m.new_name;
      update expense_categories set archived = true, rolls_up_to = target
       where org_id = o.id and name = m.old_name;
    end loop;
  end loop;
end $$;

-- ---------- 2. cash movements
alter table cash_movements add column partner_name text;

alter table cash_movements drop constraint if exists cash_movements_kind_check;
alter table cash_movements add constraint cash_movements_kind_check
  check (kind in ('safe_drop', 'partner_withdrawal', 'float_adjustment', 'top_up', 'other'));
alter table cash_movements drop constraint cash_movements_kind_direction;
alter table cash_movements add constraint cash_movements_kind_direction
  check (kind is null or kind = 'float_adjustment' or (kind = 'top_up') = (direction = 'in'));
-- New partner withdrawals name the partner (existing rows are left as they are).
alter table cash_movements add constraint cash_movements_partner_named
  check (kind is distinct from 'partner_withdrawal' or btrim(coalesce(partner_name, '')) <> '') not valid;
alter table cash_movements add constraint cash_movements_float_reason
  check (kind is distinct from 'float_adjustment' or btrim(reason) <> '');

-- An opening float adjustment belongs to whoever runs the drawer.
drop policy perm_insert on cash_movements;
drop policy perm_delete on cash_movements;
create policy perm_insert on cash_movements for insert with check (
  org_id = app_org_id()
  and (case when kind = 'float_adjustment' then app_can('close_days') else app_can('record_transactions') end)
);
create policy perm_delete on cash_movements for delete using (
  org_id = app_org_id()
  and (case when kind = 'float_adjustment' then app_can('close_days') else app_can('record_transactions') end)
);

-- The float a day was opened with is never overwritten.
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
  if new.opening_float_usd <> old.opening_float_usd or new.opening_float_lbp <> old.opening_float_lbp then
    raise exception 'The opening float is never overwritten. Record an opening float adjustment instead.' using errcode = 'P0001';
  end if;
  if new.status = 'closed' and not exists (select 1 from day_closings where business_day_id = new.id) then
    raise exception 'A day can only be closed through the closing workflow.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- 3. delivery apps as payment types
alter table sales_lines drop constraint if exists sales_lines_tender_check;
alter table sales_lines add constraint sales_lines_tender_check
  check (tender in ('cash', 'card', 'toters', 'noknok', 'other'));

-- ---------- 4. a note on saved POS formats
alter table pos_profiles add column note text;

-- Down:
--   alter table pos_profiles drop column note;
--   restore sales_lines_tender_check to ('cash', 'card', 'other') once no toters/noknok lines remain;
--   restore guard_business_day() from 0002; restore perm_insert/perm_delete on cash_movements from 0009;
--   drop constraints cash_movements_float_reason, cash_movements_partner_named; restore the kind checks from 0007;
--   alter table cash_movements drop column partner_name;
--   category renames reverse by name; alter table expense_categories drop constraint expense_categories_rolls_up, drop column rolls_up_to;
`;
