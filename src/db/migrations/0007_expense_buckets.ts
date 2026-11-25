// Two buckets for money going out (see src/lib/expense-buckets.ts):
//
// - Operating expenses get the new category list, in a fixed order, and an
//   optional receipt number. Notes become optional (description may be '').
// - Cash movements get a type. Rows recorded before this keep kind = null and
//   the app works their type out from the direction and reason, so no locked
//   (closed-day) row is rewritten.
//
// Existing categories are renamed where one maps cleanly onto a new one, so
// past expenses move with them; the rest are archived (still shown on old
// expenses and in reports, no longer offered for new ones).
export const migration0007 = /* sql */ `
alter table expense_categories add column position integer not null default 100;

alter table expenses add column receipt_ref text;

alter table cash_movements add column kind text
  check (kind in ('safe_drop', 'partner_withdrawal', 'top_up', 'other'));
alter table cash_movements add constraint cash_movements_kind_direction
  check (kind is null or (kind = 'top_up') = (direction = 'in'));

do $$
declare
  o record;
  m record;
  new_names text[] := array[
    'Salaries & Wages',
    'Beverage & Alcohol Suppliers',
    'Food & Kitchen Suppliers',
    'Generator & Electricity',
    'Rent & Municipal Fees',
    'Cleaning',
    'Maintenance & Repairs',
    'Marketing',
    'Miscellaneous'
  ];
begin
  for o in select id from organizations loop
    for m in select * from (values
      ('Food supplies', 'Food & Kitchen Suppliers'),
      ('Beverages', 'Beverage & Alcohol Suppliers'),
      ('Generator subscription', 'Generator & Electricity'),
      ('Rent', 'Rent & Municipal Fees'),
      ('Cleaning supplies', 'Cleaning'),
      ('Maintenance', 'Maintenance & Repairs'),
      ('Other', 'Miscellaneous')
    ) as t(old_name, new_name) loop
      update expense_categories set name = m.new_name
       where org_id = o.id and name = m.old_name
         and not exists (select 1 from expense_categories x where x.org_id = o.id and x.name = m.new_name);
    end loop;

    insert into expense_categories (org_id, name)
      select o.id, n from unnest(new_names) as n
      on conflict (org_id, name) do nothing;

    update expense_categories set archived = true
     where org_id = o.id and name in (
       'Food supplies', 'Beverages', 'Generator subscription', 'Electricity (EDL)', 'Water', 'Gas & fuel',
       'Cleaning supplies', 'Maintenance', 'Delivery & transport', 'Staff advances', 'Rent', 'Other');

    update expense_categories c set position = p.ord, archived = false
      from unnest(new_names) with ordinality as p(name, ord)
     where c.org_id = o.id and c.name = p.name;
  end loop;
end $$;
`;
