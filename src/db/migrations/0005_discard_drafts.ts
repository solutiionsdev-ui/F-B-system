// Owners and managers can throw away an uploaded POS file they decided not
// to import. Only drafts: a posted import is undone, never deleted.
export const migration0005 = /* sql */ `
grant delete on pos_imports to app_user;
create policy draft_delete on pos_imports for delete
  using (org_id = app_org_id() and app_role() in ('owner', 'manager') and status = 'draft');
`;
