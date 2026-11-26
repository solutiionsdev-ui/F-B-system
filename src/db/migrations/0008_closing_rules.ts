// FINCTRL v2.0, Phase 1: how a closing is judged (spec 12.4, 12.5 and 13.2).
//
// - Each currency is judged on its own. The single combined USD tolerance is
//   replaced by one allowance per currency, default zero, so a USD overage can
//   no longer hide an LBP shortage. The old column stays for history.
// - Any difference in either currency needs a reason and a written
//   explanation. Enforced for new closings only (NOT VALID): closings already
//   signed off keep exactly what they were closed with.
// - A day with no sales can only close with a written reason.
// - Each closing records the allowances it was judged with.
//
// Additive only: no existing row is changed. To undo, drop the new columns
// and the constraint (see the down note at the end).
export const migration0008 = /* sql */ `
alter table organizations
  add column tolerance_usd_cents bigint not null default 0 check (tolerance_usd_cents >= 0),
  add column tolerance_lbp bigint not null default 0 check (tolerance_lbp >= 0);
grant update (tolerance_usd_cents, tolerance_lbp) on organizations to app_user;

alter table day_closings
  add column tolerance_usd_cents bigint check (tolerance_usd_cents >= 0),
  add column tolerance_lbp bigint check (tolerance_lbp >= 0),
  add column no_sales_reason text check (no_sales_reason is null or btrim(no_sales_reason) <> '');

alter table day_closings add constraint day_closings_difference_explained
  check (
    (variance_usd = 0 and variance_lbp = 0)
    or (variance_reason is not null and btrim(coalesce(note, '')) <> '')
  ) not valid;

-- Down:
--   alter table day_closings drop constraint day_closings_difference_explained;
--   alter table day_closings drop column tolerance_usd_cents, drop column tolerance_lbp, drop column no_sales_reason;
--   alter table organizations drop column tolerance_usd_cents, drop column tolerance_lbp;
`;
