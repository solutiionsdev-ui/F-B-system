// Portability for hosted Postgres (Neon, Supabase, RDS), where the app logs in
// as the tables' owner but not as a superuser.
//
// Row-level security stays ENABLED on every table, so the restricted
// app_user role (what every tenant request switches to) is always filtered.
// It is no longer FORCED, so the owning login itself (used only for sign-in,
// sessions, invitations, migrations and seeding) isn't filtered. With FORCE,
// sign-in would find no users on a provider whose login lacks BYPASSRLS.
export const migration0006 = /* sql */ `
do $$
declare t text;
begin
  foreach t in array array['organizations', 'memberships', 'users', 'locations', 'exchange_rates',
    'business_days', 'sales_lines', 'expense_categories', 'expenses', 'cash_movements',
    'cash_counts', 'day_closings', 'adjustments', 'audit_log', 'invitations', 'pos_profiles', 'pos_imports'] loop
    execute format('alter table %I no force row level security', t);
  end loop;
end $$;
`;
