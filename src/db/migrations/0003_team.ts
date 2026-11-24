// Team management: invitations, owners changing roles and removing members,
// and a guarantee that every group keeps at least one owner.
export const migration0003 = /* sql */ `
create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null check (email = lower(email)),
  role text not null check (role in ('owner', 'manager', 'accountant')),
  token_hash text not null unique, -- sha256 of the link token; the link itself is never stored
  expires_at timestamptz not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  revoked_at timestamptz
);
create unique index invitations_one_pending on invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

alter table invitations enable row level security;
alter table invitations force row level security;
grant select, insert on invitations to app_user;
grant update (token_hash, expires_at, revoked_at) on invitations to app_user;
create policy owner_read on invitations for select using (org_id = app_org_id() and app_role() = 'owner');
create policy owner_insert on invitations for insert with check (org_id = app_org_id() and app_role() = 'owner');
create policy owner_update on invitations for update
  using (org_id = app_org_id() and app_role() = 'owner') with check (org_id = app_org_id());

-- Owners change roles and remove people. New memberships are only created
-- when someone accepts an invitation, never directly.
grant update (role), delete on memberships to app_user;
create policy owner_update on memberships for update
  using (org_id = app_org_id() and app_role() = 'owner') with check (org_id = app_org_id());
create policy owner_delete on memberships for delete
  using (org_id = app_org_id() and app_role() = 'owner');

create or replace function keep_an_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from memberships where org_id = old.org_id and role = 'owner' and id <> old.id) then
      raise exception 'Every group needs at least one owner.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger keep_an_owner before update or delete on memberships
  for each row execute function keep_an_owner();

create trigger audit after insert or update or delete on invitations
  for each row execute function audit_row();
`;
