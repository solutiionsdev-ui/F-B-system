// POS import: uploaded export files (kept with the batch for the audit trail),
// saved column mappings per POS system, and a link from every imported sales
// line back to the batch it came from so a batch can be undone.
export const migration0004 = /* sql */ `
create table pos_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  mapping jsonb not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table pos_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'posted', 'undone')),
  file_name text not null,
  file_hash text not null,
  headers jsonb not null,
  rows jsonb not null,
  row_count int not null check (row_count >= 0),
  profile_id uuid,
  mapping jsonb,
  lines_imported int,
  rows_skipped int,
  days_created int,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  posted_by uuid references users(id),
  posted_at timestamptz,
  undone_by uuid references users(id),
  undone_at timestamptz,
  unique (id, org_id),
  foreign key (location_id, org_id) references locations(id, org_id),
  foreign key (profile_id, org_id) references pos_profiles(id, org_id) on delete set null (profile_id)
);
create index pos_imports_org on pos_imports (org_id, created_at desc);

alter table sales_lines add column import_id uuid;
alter table sales_lines add foreign key (import_id, org_id) references pos_imports(id, org_id);
alter table sales_lines add check ((source = 'pos_import') = (import_id is not null));
create index sales_lines_import on sales_lines (import_id) where import_id is not null;

do $$
declare t text;
begin
  foreach t in array array['pos_profiles', 'pos_imports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_read on %I for select using (org_id = app_org_id())', t);
    execute format($p$create policy ops_insert on %I for insert
      with check (org_id = app_org_id() and app_role() in ('owner', 'manager'))$p$, t);
    execute format($p$create policy ops_update on %I for update
      using (org_id = app_org_id() and app_role() in ('owner', 'manager'))
      with check (org_id = app_org_id() and app_role() in ('owner', 'manager'))$p$, t);
  end loop;
end $$;
create policy ops_delete on pos_profiles for delete
  using (org_id = app_org_id() and app_role() in ('owner', 'manager'));

grant select, insert, update, delete on pos_profiles to app_user;
grant select, insert on pos_imports to app_user;
grant update (status, mapping, profile_id, lines_imported, rows_skipped, days_created,
  posted_by, posted_at, undone_by, undone_at) on pos_imports to app_user;

-- An uploaded file never changes once stored.
create or replace function freeze_import_file() returns trigger language plpgsql as $$
begin
  if new.rows is distinct from old.rows or new.headers is distinct from old.headers
     or new.file_hash is distinct from old.file_hash or new.location_id is distinct from old.location_id then
    raise exception 'An uploaded POS file cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger freeze_import_file before update on pos_imports
  for each row execute function freeze_import_file();

-- Audit both tables, leaving the file contents out of the log.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_j jsonb;
  new_j jsonb;
  rec jsonb;
  org uuid;
begin
  if tg_op <> 'INSERT' then old_j := to_jsonb(old) - 'rows' - 'headers'; end if;
  if tg_op <> 'DELETE' then new_j := to_jsonb(new) - 'rows' - 'headers'; end if;
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

create trigger audit after insert or update or delete on pos_profiles
  for each row execute function audit_row();
create trigger audit after insert or update or delete on pos_imports
  for each row execute function audit_row();
`;
