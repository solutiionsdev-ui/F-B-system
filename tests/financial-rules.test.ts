// The strict financial rules across screens: the Omega import and its
// validation, original amounts with their applied rate, and Today's cards
// matching Reports exactly. (Expenses vs cash movements are in
// expense-buckets.test.ts; reconciliation and closing in spec-acceptance.test.ts.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadScope, migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { locations, organizations, posProfiles, salesLines, users } from "@/db/schema";
import { OMEGA_SAMPLE_HEADERS, omegaSampleCsv, omegaSampleRows } from "@/lib/omega-sample";
import { normalizeRows, OMEGA_DEMO_MAPPING, OMEGA_FORMAT_NAME, parseCsv } from "@/lib/pos-import";
import { listMovements } from "@/server/ledgers";
import { getDay, setRate } from "@/server/operations";
import { createImportDraft, getImport, listProfiles, postImport } from "@/server/pos-import";
import { getPeriodReport } from "@/server/reports";
import { getToday } from "@/server/today";

const TODAY = "2026-11-26";
const FREE_DAY = "2026-11-14"; // the day before the demo's 12 days
let database: Database;
let owner: TenantScope;
let taproom = "";

const bytes = (csv: string) => new TextEncoder().encode(csv);

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await ensureCedarDemo(database, TODAY);
  const db = database.db;
  const [org] = await db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
  const [rana] = await db.select().from(users).where(eq(users.email, "owner@demo.test"));
  owner = (await loadScope(db, rana.id, org.id))!;
  const [loc] = await db.select().from(locations).where(and(eq(locations.orgId, org.id), eq(locations.name, "Mar Mikhael Taproom")));
  taproom = loc.id;
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe("Omega POS import and validation", () => {
  it("lists the Omega format as a saved, active format, labelled as a demo mapping", async () => {
    const profiles = await listProfiles(database.db, owner);
    const omega = profiles.find((p) => p.name === OMEGA_FORMAT_NAME)!;
    expect(omega.name).toBe("Omega POS — Daily Sales & Payment Export");
    expect(omega.note).toMatch(/Demo mapping v1\.0.*\.csv \/ \.xlsx.*real Omega export/);
    // Asking again doesn't add a second copy.
    await ensureCedarDemo(database, TODAY);
    expect(await database.db.select().from(posProfiles).where(eq(posProfiles.orgId, owner.orgId))).toHaveLength(1);
  });

  it("reads the sample: every row understood, one business day, nothing dropped", () => {
    const csv = parseCsv(omegaSampleCsv(FREE_DAY));
    expect(csv.headers).toEqual(OMEGA_SAMPLE_HEADERS);
    const n = normalizeRows(csv.headers, csv.rows, OMEGA_DEMO_MAPPING);
    expect(n.setup).toEqual([]);
    expect(n.problems).toEqual([]);
    expect(n.duplicatesInFile).toBe(0);
    expect(n.lines).toHaveLength(omegaSampleRows(FREE_DAY).length);
    // The two sales after midnight belong to the same business day.
    expect(new Set(n.lines.map((l) => l.businessDate))).toEqual(new Set([FREE_DAY]));
  });

  it("previews each total before anything is posted, then posts only on confirmation", async () => {
    const db = database.db;
    const id = await createImportDraft(db, owner, { locationId: taproom, fileName: "sample-omega-export.csv", bytes: bytes(omegaSampleCsv(FREE_DAY)) });
    const draft = (await getImport(db, owner, id))!;
    const omega = (await listProfiles(db, owner)).find((p) => p.name === OMEGA_FORMAT_NAME)!;
    expect(draft.import.profileId).toBe(omega.id); // the saved format was picked up from the columns
    expect(draft.import.status).toBe("draft");

    const p = draft.preview!;
    expect(p.counts).toMatchObject({ problems: 0, alreadyImported: 0, duplicatesInFile: 0, blocked: 0 });
    expect(p.totals.byTender.cash).toEqual({ USD: 21800n, LBP: 4_485_000n });
    expect(p.totals.byTender.card.USD).toBe(50650n);
    expect(p.totals.byTender.toters.USD).toBe(9400n);
    expect(p.totals.byTender.noknok.USD).toBe(5000n);
    expect(p.totals.refunds.USD).toBe(1200n);
    expect(p.totals.discounts.USD).toBe(500n);
    expect(p.totals.voids.USD).toBe(1800n);
    expect(p.totals.tax.USD).toBeGreaterThan(0n);
    // $218 + $506.50 + $94 + $50 + $50 of LBP cash - $12 refund
    expect(p.totals.collectedEq).toBe(90650n);
    expect(p.days).toHaveLength(1);
    expect(p.days[0]).toMatchObject({ date: FREE_DAY, dayStatus: "new", otherImportLines: 0 });

    // Uploading posts nothing.
    expect(await db.select().from(salesLines).where(eq(salesLines.importId, id))).toHaveLength(0);

    await postImport(db, owner, id, { createMissingDays: true });
    const posted = (await getImport(db, owner, id))!;
    expect(posted.import.status).toBe("posted");
    const report = await getPeriodReport(db, owner, { from: FREE_DAY, to: FREE_DAY, locationId: taproom });
    const day = (await getDay(db, owner, report.daily[0].dayId))!;
    // Only cash, less the cash refund, is expected in the drawer. Discounts, voids and VAT aren't deducted again.
    expect(day.breakdown.expected).toEqual({ USD: 20600n, LBP: 4_485_000n });
    expect(day.sales.byTender.toters.USD).toBe(9400n);
    expect(report.totals.salesEq.collected).toBe(90650n);
    expect(report.totals.sales.tax.USD).toBe(p.totals.tax.USD); // VAT kept distinct
  });

  it("recognises the same file and the same rows a second time", async () => {
    const db = database.db;
    const again = await createImportDraft(db, owner, { locationId: taproom, fileName: "sample-omega-export (1).csv", bytes: bytes(omegaSampleCsv(FREE_DAY)) });
    const draft = (await getImport(db, owner, again))!;
    expect(draft.sameFilePosted).toHaveLength(1);
    expect(draft.preview!.counts.toImport).toBe(0);
    expect(draft.preview!.counts.alreadyImported).toBe(draft.preview!.counts.lines);
    await expect(postImport(db, owner, again, { createMissingDays: true })).rejects.toThrow(/nothing new/i);
  });

  it("warns when a day already has imported sales from a different file", async () => {
    const db = database.db;
    // The same evening exported again with different receipt numbers.
    const other = omegaSampleCsv(FREE_DAY).replaceAll("OM-", "ZZ-");
    const id = await createImportDraft(db, owner, { locationId: taproom, fileName: "second-export.csv", bytes: bytes(other) });
    const p = (await getImport(db, owner, id))!.preview!;
    expect(p.days[0].otherImportLines).toBeGreaterThan(0);
    expect(p.counts.alreadyImported).toBe(0);
  });
});

describe("original amounts and the applied rate", () => {
  it("keeps each entry's own currency, amount and rate when a new rate is set", async () => {
    const db = database.db;
    const before = await getPeriodReport(db, owner, { from: "2026-11-15", to: TODAY });
    const movesBefore = await listMovements(db, owner, { from: "2026-11-15", to: TODAY });
    await setRate(db, owner, { lbpPerUsd: "95,000", source: "market" });
    const after = await getPeriodReport(db, owner, { from: "2026-11-15", to: TODAY });
    const movesAfter = await listMovements(db, owner, { from: "2026-11-15", to: TODAY });

    const lbp = after.expenses.find((e) => e.currency === "LBP")!;
    expect(lbp.amountMinor % 50_000n).toBe(0n); // still the original LBP amount
    expect(lbp.rate).toBe(897_000_000n); // 89,700, the rate of its own business day
    expect(after.expenses.map((e) => [e.id, e.currency, e.amountMinor, e.rate, e.eq])).toEqual(
      before.expenses.map((e) => [e.id, e.currency, e.amountMinor, e.rate, e.eq]),
    );
    expect(after.daily.map((d) => [d.dayId, d.rate, d.salesEq.collected])).toEqual(before.daily.map((d) => [d.dayId, d.rate, d.salesEq.collected]));
    expect(movesAfter.map((m) => [m.id, m.currency, m.amountMinor, m.rate, m.eq])).toEqual(
      movesBefore.map((m) => [m.id, m.currency, m.amountMinor, m.rate, m.eq]),
    );
    expect(after.totals.cashResultEq).toBe(before.totals.cashResultEq);
  });
});

describe("Today and Reports agree", () => {
  it("shows identical closed, flagged and difference figures for this month", async () => {
    const db = database.db;
    for (const locationId of [null, taproom]) {
      const today = await getToday(db, owner, TODAY, locationId);
      const report = await getPeriodReport(db, owner, { from: "2026-11-01", to: TODAY, locationId });
      expect(today.kpis.difference.from).toBe(report.filter.from);
      expect(today.kpis.difference.to).toBe(report.filter.to);
      expect(today.kpis.difference.closed).toBe(report.cash.status.closed);
      expect(today.kpis.difference.flagged).toBe(report.cash.status.flagged);
      expect(today.kpis.difference.value).toEqual(report.cash.varianceAfter);
      expect(today.status).toEqual(report.cash.status);
    }
    const all = await getToday(db, owner, TODAY);
    // 33 closed in the demo's 12 days, plus the back-dated day imported above (still open).
    expect(all.status).toEqual({ records: 37, closed: 33, balanced: 32, flagged: 1, open: 4 });
  });
});
