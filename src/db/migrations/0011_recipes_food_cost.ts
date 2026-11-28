// Kitchen, stage A: ingredients with a price history, recipes (dishes and
// preps such as sauces) with versioned ingredient lists, and the food cost
// settings. Stock and purchases come in a later stage.
//
// Exact numbers, no floats: quantities are stored in thousandths of the
// ingredient's base unit (g, ml or piece), prices in ten-thousandths of the
// currency, and percentages in basis points (10000 = 100%).
//
// History is never rewritten: a new price is a new row, and editing a recipe
// writes a new version; past versions and prices stay as they were.
//
// Additive only: no existing table loses or changes data. Down steps at the end.
export const migration0011 = /* sql */ `
-- ---------- food cost settings
alter table organizations
  add column food_cost_target_bp int not null default 3000 check (food_cost_target_bp between 100 and 9000),
  add column overhead_bp int not null default 0 check (overhead_bp between 0 and 10000),
  add column menu_vat_bp int check (menu_vat_bp between 0 and 5000);
comment on column organizations.menu_vat_bp is 'VAT included in menu prices, if the business says so; null means not set';
grant update (food_cost_target_bp, overhead_bp, menu_vat_bp) on organizations to app_user;

-- ---------- ingredients
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  base_unit text not null check (base_unit in ('g', 'ml', 'unit')),
  -- Conversions, all through grams: weight of 1 ml, and weight of one piece.
  grams_per_ml_e4 bigint check (grams_per_ml_e4 > 0),
  grams_per_unit_milli bigint check (grams_per_unit_milli > 0),
  -- Usable share after trimming, peeling or bones (avocado about 70%).
  yield_bp int not null default 10000 check (yield_bp between 100 and 10000),
  category text,
  supplier text,
  note text,
  archived boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index ingredients_name on ingredients (org_id, lower(name));

create table ingredient_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  ingredient_id uuid not null,
  currency text not null check (currency in ('USD', 'LBP')),
  price_e4 bigint not null check (price_e4 > 0),
  -- The quantity that price buys, in thousandths of the base unit (1 kg = 1000000).
  per_milli bigint not null check (per_milli > 0),
  pack_label text not null check (btrim(pack_label) <> ''),
  supplier text,
  source text not null check (source in ('manual', 'import', 'purchase')),
  note text,
  effective_at timestamptz not null default now(),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (ingredient_id, org_id) references ingredients(id, org_id)
);
create index ingredient_prices_latest on ingredient_prices (ingredient_id, effective_at desc, created_at desc);

-- ---------- recipes
create table recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  kind text not null check (kind in ('dish', 'prep')),
  category text,
  -- Dishes: the menu price per portion.
  price_currency text check (price_currency in ('USD', 'LBP')),
  selling_price_e4 bigint check (selling_price_e4 > 0),
  -- Packaging per delivery or takeaway order, in USD.
  packaging_e4 bigint not null default 0 check (packaging_e4 >= 0),
  -- Overrides the business's target food cost for this dish.
  target_bp int check (target_bp between 100 and 9000),
  archived boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check ((selling_price_e4 is null) = (price_currency is null))
);
create unique index recipes_name on recipes (org_id, lower(name));

create table recipe_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  recipe_id uuid not null,
  version int not null check (version > 0),
  -- Preps: what one batch makes. Estimated when worked out from the ingredients (to be confirmed).
  yield_milli bigint check (yield_milli > 0),
  yield_unit text check (yield_unit in ('g', 'ml', 'unit')),
  yield_estimated boolean not null default false,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version),
  unique (id, org_id),
  foreign key (recipe_id, org_id) references recipes(id, org_id),
  check ((yield_milli is null) = (yield_unit is null))
);

create table recipe_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  version_id uuid not null,
  position int not null,
  ingredient_id uuid,
  sub_recipe_id uuid,
  quantity_milli bigint not null check (quantity_milli >= 0),
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'unit')),
  note text,
  foreign key (version_id, org_id) references recipe_versions(id, org_id),
  foreign key (ingredient_id, org_id) references ingredients(id, org_id),
  foreign key (sub_recipe_id, org_id) references recipes(id, org_id),
  check ((ingredient_id is null) <> (sub_recipe_id is null))
);
create index recipe_lines_version on recipe_lines (version_id, position);

-- ---------- importing a costing workbook: a draft to check, then posted once
create table recipe_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  file_name text not null,
  file_hash text not null,
  plan jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'posted', 'discarded')),
  summary jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  posted_by uuid references users(id),
  posted_at timestamptz,
  unique (id, org_id)
);

-- ---------- access: everyone in the business reads; the recipe permission writes
do $$
declare t text;
begin
  foreach t in array array['ingredients', 'ingredient_prices', 'recipes', 'recipe_versions', 'recipe_lines', 'recipe_imports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_read on %I for select using (org_id = app_org_id())', t);
    execute format($p$create policy perm_insert on %I for insert with check (org_id = app_org_id() and app_can('manage_recipes'))$p$, t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_row()', t);
  end loop;
end $$;
create policy perm_update on ingredients for update
  using (org_id = app_org_id() and app_can('manage_recipes')) with check (org_id = app_org_id() and app_can('manage_recipes'));
create policy perm_update on recipes for update
  using (org_id = app_org_id() and app_can('manage_recipes')) with check (org_id = app_org_id() and app_can('manage_recipes'));
create policy perm_update on recipe_imports for update
  using (org_id = app_org_id() and app_can('manage_recipes')) with check (org_id = app_org_id() and app_can('manage_recipes'));

grant select, insert on ingredients, ingredient_prices, recipes, recipe_versions, recipe_lines, recipe_imports to app_user;
grant update (name, base_unit, grams_per_ml_e4, grams_per_unit_milli, yield_bp, category, supplier, note, archived, updated_at)
  on ingredients to app_user;
grant update (name, kind, category, price_currency, selling_price_e4, packaging_e4, target_bp, archived, updated_at)
  on recipes to app_user;
grant update (status, summary, posted_by, posted_at) on recipe_imports to app_user;

-- Prices, recipe versions and their lines are history: never changed or deleted.
create trigger append_only before update or delete on ingredient_prices
  for each row execute function deny_change();
create trigger append_only before update or delete on recipe_versions
  for each row execute function deny_change();
create trigger append_only before update or delete on recipe_lines
  for each row execute function deny_change();

-- A stored workbook never changes once uploaded.
create or replace function freeze_recipe_import() returns trigger language plpgsql as $$
begin
  if new.plan is distinct from old.plan or new.file_hash is distinct from old.file_hash then
    raise exception 'An uploaded workbook cannot be changed.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' then
    raise exception 'This import is already %.', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger freeze_recipe_import before update on recipe_imports
  for each row execute function freeze_recipe_import();

-- The audit trail records the import and what it posted, not the whole workbook again.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_j jsonb;
  new_j jsonb;
  rec jsonb;
  org uuid;
begin
  if tg_op <> 'INSERT' then old_j := to_jsonb(old) - 'rows' - 'headers' - 'plan'; end if;
  if tg_op <> 'DELETE' then new_j := to_jsonb(new) - 'rows' - 'headers' - 'plan'; end if;
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

-- Down (reverse order):
--   restore audit_row() from 0004 (without '- plan');
--   drop table recipe_imports, recipe_lines, recipe_versions, recipes, ingredient_prices, ingredients;
--   drop function freeze_recipe_import;
--   alter table organizations drop column menu_vat_bp, drop column overhead_bp, drop column food_cost_target_bp;
`;
