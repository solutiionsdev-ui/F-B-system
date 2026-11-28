// Importing past business days from Excel: the uploaded workbook is kept as a
// draft to check, then posted once. Posting goes through the normal day
// rules (opening, sales, expenses, cash movements, counts, closing), so this
// only adds the draft table. Owners only. Down step at the end.
export const migration0012 = /* sql */ `
create table day_imports (
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

alter table day_imports enable row level security;
create policy tenant_read on day_imports for select using (org_id = app_org_id() and app_role() = 'owner');
create policy owner_insert on day_imports for insert with check (org_id = app_org_id() and app_role() = 'owner');
create policy owner_update on day_imports for update
  using (org_id = app_org_id() and app_role() = 'owner') with check (org_id = app_org_id() and app_role() = 'owner');
grant select, insert on day_imports to app_user;
grant update (status, summary, posted_by, posted_at) on day_imports to app_user;

-- The stored workbook never changes, and a posted or discarded import is final.
create or replace function freeze_day_import() returns trigger language plpgsql as $$
begin
  if new.plan is distinct from old.plan or new.file_hash is distinct from old.file_hash then
    raise exception 'An uploaded workbook cannot be changed.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' then
    raise exception 'This import is already %.', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger freeze_day_import before update on day_imports
  for each row execute function freeze_day_import();
-- The audit trail records the import (audit_row leaves the stored plan out).
create trigger audit after insert or update or delete on day_imports
  for each row execute function audit_row();

-- Down: drop table day_imports; drop function freeze_day_import;
`;
