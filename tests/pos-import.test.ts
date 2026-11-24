import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { seedDemo } from "@/db/seed";
import { businessDays, locations, memberships, organizations, posImports, salesLines, users } from "@/db/schema";
import {
  businessDateOf,
  detectDateFormat,
  normalizeRows,
  parseCsv,
  parseExportAmount,
  suggestMapping,
  type Mapping,
} from "@/lib/pos-import";
import { getDay, saveManualSales, todayIn, UserError } from "@/server/operations";
import {
  createImportDraft,
  getImport,
  listProfiles,
  postImport,
  readUpload,
  saveMapping,
  undoImport,
} from "@/server/pos-import";

const SAMPLE = readFileSync("public/samples/sample-pos-export.csv");

// ---------------------------------------------------------------- pure

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const t = parseCsv('﻿A,B,C\r\n1,"x, y","say ""hi"""\r\n\r\n2,,"multi\nline"\r\n');
    expect(t.headers).toEqual(["A", "B", "C"]);
    expect(t.rows).toEqual([
      ["1", "x, y", 'say "hi"'],
      ["2", "", "multi\nline"],
    ]);
  });

  it("detects semicolons and tabs, and names duplicate or empty headers", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("Amount,Amount,\n1,2,3").headers).toEqual(["Amount", "Amount (2)", "Column 3"]);
  });
});

describe("dates", () => {
  it("guesses day-first vs month-first from the values", () => {
    expect(detectDateFormat(["24/11/2026 12:00"])).toBe("DMY");
    expect(detectDateFormat(["11/24/2026 12:00"])).toBe("MDY");
    expect(detectDateFormat(["2026-11-24T12:00:00"])).toBe("YMD");
    expect(detectDateFormat(["05/06/2026"])).toBe("DMY"); // ambiguous: Lebanon writes day first
  });

  it("puts late-night sales on the previous business day", () => {
    expect(businessDateOf("25/11/2026 00:30", "DMY", 5)).toBe("2026-11-24");
    expect(businessDateOf("25/11/2026 05:00", "DMY", 5)).toBe("2026-11-25");
    expect(businessDateOf("25/11/2026", "DMY", 5)).toBe("2026-11-25");
    expect(businessDateOf("11/25/2026 12:30 AM", "MDY", 5)).toBe("2026-11-24");
    expect(businessDateOf("2026-11-25T01:00:00", "YMD", 0)).toBe("2026-11-25");
    expect(businessDateOf("2026-01-01 03:00", "YMD", 5)).toBe("2025-12-31");
  });

  it("rejects impossible dates", () => {
    expect(businessDateOf("31/02/2026", "DMY", 5)).toBeNull();
    expect(businessDateOf("yesterday", "DMY", 5)).toBeNull();
  });
});

describe("amounts", () => {
  it("reads common export formats", () => {
    expect(parseExportAmount("1,250.50", "USD")).toEqual({ minor: 125050n, negative: false });
    expect(parseExportAmount("(12.00)", "USD")).toEqual({ minor: 1200n, negative: true });
    expect(parseExportAmount("-450,000", "LBP")).toEqual({ minor: 450000n, negative: true });
    expect(parseExportAmount("4500000.00", "LBP")).toEqual({ minor: 4500000n, negative: false });
    expect(parseExportAmount("$18.5", "USD")).toEqual({ minor: 1850n, negative: false });
    expect(parseExportAmount("12.345", "USD")).toBeNull();
    expect(parseExportAmount("", "USD")).toBeNull();
  });
});

describe("mapping", () => {
  const { headers, rows } = parseCsv(SAMPLE.toString("utf8"));

  it("guesses the sample export's columns", () => {
    const m = suggestMapping(headers, rows);
    expect(m.dateColumn).toBe("Closed At");
    expect(m.idColumns).toEqual(["Receipt No", "Pay Line"]);
    expect(m.amount).toMatchObject({ mode: "single", column: "Amount", currency: { mode: "column", column: "Currency" } });
    expect(m.tender).toMatchObject({ mode: "column", column: "Payment Method" });
    if (m.tender.mode === "column") {
      expect(m.tender.values).toEqual({ Cash: "cash", Mastercard: "card", Visa: "card", "Whish Money": "other" });
    }
    if (m.type.mode === "column") expect(m.type.values).toEqual({ Paid: "payment", Refund: "refund", Void: "void" });
  });

  it("turns the sample into lines on one business day", () => {
    const n = normalizeRows(headers, rows, suggestMapping(headers, rows));
    expect(n.problems).toEqual([]);
    expect(n.lines).toHaveLength(rows.length);
    expect(new Set(n.lines.map((l) => l.businessDate))).toEqual(new Set(["2026-11-24"]));
    const refunds = n.lines.filter((l) => l.lineType === "refund");
    expect(refunds.map((l) => [l.tender, l.amountMinor])).toEqual([
      ["cash", 1200n],
      ["card", 2450n],
    ]);
    const voids = n.lines.filter((l) => l.lineType === "void");
    expect(voids).toHaveLength(1);
    expect(voids[0].tender).toBeNull();
  });

  const base: Mapping = {
    dateColumn: "Date",
    dateFormat: "auto",
    dayCutoffHour: 5,
    idColumns: ["Bill"],
    amount: { mode: "split", usdColumn: "USD", lbpColumn: "LBP" },
    tender: { mode: "column", column: "Method", values: { Cash: "cash", Card: "card", Staff: "skip" } },
    type: { mode: "fixed", value: "payment" },
  };

  it("splits a row paid in both currencies into two lines", () => {
    const t = parseCsv("Bill,Date,Method,USD,LBP\nB1,24/11/2026 20:00,Cash,10.00,895000\nB2,24/11/2026 20:05,Card,25,\n");
    const n = normalizeRows(t.headers, t.rows, base);
    expect(n.lines.map((l) => [l.externalRef, l.currency, l.amountMinor])).toEqual([
      ["B1|USD", "USD", 1000n],
      ["B1|LBP", "LBP", 895000n],
      ["B2|USD", "USD", 2500n],
    ]);
  });

  it("reports unreadable rows, unmapped values, skips and repeated IDs", () => {
    const t = parseCsv(
      [
        "Bill,Date,Method,USD,LBP",
        "B1,24/11/2026,Cash,10,",
        "B1,24/11/2026,Cash,10,", // same ID again
        "B2,not a date,Cash,10,",
        "B3,24/11/2026,Cash,ten,",
        ",24/11/2026,Cash,10,",
        "B4,24/11/2026,Crypto,10,", // not in the mapping
        "B5,24/11/2026,Staff,10,", // mapped to skip
      ].join("\n"),
    );
    const n = normalizeRows(t.headers, t.rows, base);
    expect(n.lines).toHaveLength(1);
    expect(n.duplicatesInFile).toBe(1);
    expect(n.skipped).toBe(1);
    expect(n.problems.map((p) => [p.row, p.problem])).toEqual([
      [4, 'Can\'t read the date "not a date"'],
      [5, 'Can\'t read the USD amount "ten"'],
      [6, "No record ID"],
      [7, 'Payment method "Crypto" isn\'t mapped'],
    ]);
  });

  it("says what's missing from an incomplete mapping", () => {
    const t = parseCsv("Bill,Date\nB1,24/11/2026\n");
    const n = normalizeRows(t.headers, t.rows, { ...base, idColumns: [] });
    expect(n.setup.length).toBeGreaterThan(0);
    expect(n.lines).toHaveLength(0);
  });
});

describe("Excel files", () => {
  it("reads the first sheet of an .xlsx", async () => {
    const cell = (ref: string, v: string | number) =>
      typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1">${cell("A1", "Receipt")}${cell("B1", "Date")}${cell("C1", "Amount")}</row>
      <row r="2">${cell("A2", "R-1")}${cell("B2", "24/11/2026 13:00")}${cell("C2", 12.5)}</row>
    </sheetData></worksheet>`;
    const xlsx = zipSync({
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      "xl/workbook.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Payments" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    const t = await readUpload("export.xlsx", xlsx);
    expect(t.headers).toEqual(["Receipt", "Date", "Amount"]);
    expect(t.rows).toEqual([["R-1", "24/11/2026 13:00", "12.5"]]);
  });

  it("refuses old .xls and oversized files with a clear message", async () => {
    await expect(readUpload("old.xls", new Uint8Array([1, 2, 3]))).rejects.toThrow(/\.xls/);
    await expect(readUpload("big.csv", new Uint8Array(6 * 1024 * 1024))).rejects.toThrow(/5 MB/);
  });
});

// ---------------------------------------------------------------- database

let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;
let bistro: TenantScope;
let gemmayzehId: string;
let hamraId: string;

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await seedDemo(database.db);
  const scopeFor = async (email: string, orgName: string): Promise<TenantScope> => {
    const [row] = await database.db
      .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.email, email), eq(organizations.name, orgName)));
    return row;
  };
  owner = await scopeFor("owner@demo.test", "Demo Café Group");
  manager = await scopeFor("manager@demo.test", "Demo Café Group");
  accountant = await scopeFor("accountant@demo.test", "Demo Café Group");
  bistro = await scopeFor("bistro@demo.test", "Demo Bistro");
  const locs = await database.db.select().from(locations).where(eq(locations.orgId, owner.orgId));
  gemmayzehId = locs.find((l) => l.name === "Gemmayzeh")!.id;
  hamraId = locs.find((l) => l.name === "Hamra")!.id;
});

afterAll(async () => {
  await database?.close();
});

/** The sample shifted to a date the seed has no Gemmayzeh day for. */
function sampleFor(date: string) {
  const [y, m, d] = date.split("-");
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const n = next.toISOString().slice(0, 10).split("-");
  return new TextEncoder().encode(
    SAMPLE.toString("utf8").replaceAll("24/11/2026", `${d}/${m}/${y}`).replaceAll("25/11/2026", `${n[2]}/${n[1]}/${n[0]}`),
  );
}

describe("importing", () => {
  const date = "2026-12-01";
  let importId: string;

  it("is for owners and managers", async () => {
    await expect(
      createImportDraft(database.db, accountant, { locationId: gemmayzehId, fileName: "x.csv", bytes: sampleFor(date) }),
    ).rejects.toThrow(UserError);
    await expect(
      withTenant(database.db, accountant, (tx) =>
        tx.insert(posImports).values({
          orgId: accountant.orgId,
          locationId: gemmayzehId,
          fileName: "x",
          fileHash: "x",
          headers: [],
          rows: [],
          rowCount: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("previews before posting anything", async () => {
    importId = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "pos.csv", bytes: sampleFor(date) });
    const imp = (await getImport(database.db, manager, importId))!;
    expect(imp.import.status).toBe("draft");
    expect(imp.preview!.setup).toEqual([]);
    expect(imp.preview!.counts).toMatchObject({ rows: 62, toImport: 62, alreadyImported: 0, problems: 0 });
    expect(imp.preview!.days).toHaveLength(1);
    expect(imp.preview!.days[0]).toMatchObject({ date, dayStatus: "new", blocked: null, rate: "89700.0000" });
    const lines = await database.db.select().from(salesLines).where(eq(salesLines.importId, importId));
    expect(lines).toHaveLength(0);
  });

  it("posts into a newly opened day, which the closing screen then uses", async () => {
    const res = await postImport(database.db, manager, importId, { createMissingDays: true, saveAs: "Sample POS (CSV)" });
    expect(res).toEqual({ linesImported: 62, daysCreated: 1 });
    const [day] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.locationId, gemmayzehId), eq(businessDays.businessDate, date)));
    expect(day.status).toBe("open");
    const detail = (await getDay(database.db, manager, day.id))!;
    expect(detail.sales.byTender.cash.USD).toBeGreaterThan(0n);
    expect(detail.sales.byTender.cash.LBP).toBeGreaterThan(0n);
    expect(detail.sales.refunds.USD).toBe(3650n); // $12.00 cash + $24.50 card
    expect(detail.breakdown.cashRefunds.USD).toBe(1200n); // only the cash refund leaves the drawer
    await expect(
      saveManualSales(database.db, manager, day.id, {
        cash: { USD: 100n, LBP: 0n },
        card: { USD: 0n, LBP: 0n },
        other: { USD: 0n, LBP: 0n },
        cashRefunds: { USD: 0n, LBP: 0n },
        discounts: { USD: 0n, LBP: 0n },
        voids: { USD: 0n, LBP: 0n },
        tax: { USD: 0n, LBP: 0n },
        serviceCharge: { USD: 0n, LBP: 0n },
      }),
    ).rejects.toThrow(/imported from the POS/);
  });

  it("never imports the same POS record twice", async () => {
    const again = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "pos.csv", bytes: sampleFor(date) });
    const imp = (await getImport(database.db, manager, again))!;
    expect(imp.sameFilePosted).toHaveLength(1);
    expect(imp.preview!.counts).toMatchObject({ toImport: 0, alreadyImported: 62 });
    await expect(postImport(database.db, manager, again, { createMissingDays: true })).rejects.toThrow(/nothing new/);
  });

  it("reuses a saved POS format for the next file with the same columns", async () => {
    const profiles = await listProfiles(database.db, manager);
    expect(profiles.map((p) => [p.name, p.uses])).toEqual([["Sample POS (CSV)", 1]]);
    const next = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "next.csv", bytes: sampleFor("2026-12-02") });
    const [row] = await database.db.select({ profileId: posImports.profileId }).from(posImports).where(eq(posImports.id, next));
    expect(row.profileId).toBe(profiles[0].id);
  });

  it("can be undone while the day is open", async () => {
    await undoImport(database.db, manager, importId);
    const lines = await database.db.select().from(salesLines).where(eq(salesLines.importId, importId));
    expect(lines).toHaveLength(0);
    const imp = (await getImport(database.db, manager, importId))!;
    expect(imp.import.status).toBe("undone");
    await expect(undoImport(database.db, manager, importId)).rejects.toThrow(/Only a posted import/);
  });

  it("won't touch closed days or days with hand-typed totals", async () => {
    const [closed] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.locationId, hamraId), eq(businessDays.status, "closed")))
      .limit(1);
    const closedImport = await createImportDraft(database.db, manager, {
      locationId: hamraId,
      fileName: "late.csv",
      bytes: sampleFor(closed.businessDate),
    });
    const p1 = (await getImport(database.db, manager, closedImport))!.preview!;
    expect(p1.days[0].dayStatus).toBe("closed");
    expect(p1.days[0].blocked).toMatch(/already closed/);
    expect(p1.counts.toImport).toBe(0);

    // Today's Hamra day in the demo has totals typed in by hand.
    const manualImport = await createImportDraft(database.db, manager, {
      locationId: hamraId,
      fileName: "today.csv",
      bytes: sampleFor(todayIn()),
    });
    const p2 = (await getImport(database.db, manager, manualImport))!.preview!;
    expect(p2.days[0].blocked).toMatch(/typed in by hand/);
    await expect(postImport(database.db, manager, manualImport, { createMissingDays: true })).rejects.toThrow(/nothing new/);
  });

  it("re-maps a draft and keeps uploaded files unchangeable", async () => {
    const id = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "pos.csv", bytes: sampleFor("2026-12-05") });
    const imp = (await getImport(database.db, manager, id))!;
    await saveMapping(database.db, manager, id, { ...imp.mapping, tender: { mode: "fixed", value: "card" } });
    const after = (await getImport(database.db, manager, id))!;
    expect(after.mapping.tender).toEqual({ mode: "fixed", value: "card" });
    await expect(
      database.db.update(posImports).set({ rows: [["tampered"]] }).where(eq(posImports.id, id)),
    ).rejects.toThrow();
  });

  it("is invisible to other groups", async () => {
    expect(await getImport(database.db, bistro, importId)).toBeNull();
  });
});
