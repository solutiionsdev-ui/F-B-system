// The cost alert on Performance: the owner chooses how big a rise in the
// share of sales going to running costs triggers it (5% unless changed).
//
// Additive only: one new column with a default; nothing existing changes.
export const migration0013 = /* sql */ `
alter table organizations
  add column cost_alert_bp int not null default 500 check (cost_alert_bp between 100 and 5000);
comment on column organizations.cost_alert_bp is 'Cost alert: how much bigger the cost share of sales must get, relative, in basis points (500 = 5%)';
grant update (cost_alert_bp) on organizations to app_user;

-- Down: alter table organizations drop column cost_alert_bp;
`;
