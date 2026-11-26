// POS import operations: upload a file (kept as a draft), map its columns,
// preview exactly what would be posted, post it in one transaction, undo it.
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { readSheet } from "read-excel-file/node";
import { type DB, type TenantScope, type Tx, withTenant } from "@/db/database";
import {
  businessDays,
  exchangeRates,
  locations,
  posImports,
  posProfiles,
  salesLines,
  users,
  type Role,
} from "@/db/schema";
import { CURRENCIES, parseRate, usdEquivalent, zeroPair, type Currency, type Pair } from "@/lib/money";
import { pickRateForDate } from "@/lib/rates";
import {
  completeMapping,
  isMapping,
  MAX_BYTES,
  normalizeRows,
  parseCsv,
  suggestMapping,
  toTable,
  type DateFormat,
  type LineType,
  type Mapping,
  type NormalizedLine,
  type Tender,
} from "@/lib/pos-import";
import { UserError } from "./operations";

export const IMPORT_ROLES: Role[] = ["owner", "manager"];

function requireImporter(scope: TenantScope) {
  if (!IMPORT_ROLES.includes(scope.role)) throw new UserError("Only owners and managers can import POS files.");
}

// ---------------------------------------------------------------- reading files

export async function readUpload(fileName: string, bytes: Uint8Array): Promise<{ headers: string[]; rows: string[][] }> {
  if (bytes.byteLength === 0) throw new UserError("That file is empty.");
  if (bytes.byteLength > MAX_BYTES) throw new UserError("Files can be up to 5 MB. Export a shorter period.");
  const name = fileName.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) {
      const data = await readSheet(Buffer.from(bytes), { parseNumber: (s: string) => s });
      return toTable(data as unknown[][]);
    }
    if (name.endsWith(".xls")) throw new UserError("Old .xls files aren't supported. Save it as .xlsx or CSV and upload again.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Older Windows exports, often with Arabic menu item names.
      text = new TextDecoder("windows-1256").decode(bytes);
    }
    return parseCsv(text);
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(`Couldn't read that file: ${e instanceof Error ? e.message : "unknown format"}. Upload a CSV or .xlsx export.`);
  }
}

// ---------------------------------------------------------------- preview

type DayPreview = {
  date: string;
  dayId: string | null;
  dayStatus: "new" | "open" | "closed";
  /** Why lines for this day can't be imported, if they can't. */
  blocked: string | null;
  rate: string | null;
  rateNote: string | null;
  toImport: number;
  alreadyImported: number;
  cash: Pair;
  card: Pair;
  other: Pair;
  refunds: Pair;
  memo: Pair; // discounts, voids, tax, service: shown, not collected
  collectedEq: bigint;
};

async function buildPreview(tx: Tx, imp: { locationId: string; headers: string[]; rows: string[][] }, mapping: Mapping) {
  const n = normalizeRows(imp.headers, imp.rows, mapping);
  const dates = [...new Set(n.lines.map((l) => l.businessDate))].sort();

  const days = dates.length
    ? await tx
        .select({ id: businessDays.id, date: businessDays.businessDate, status: businessDays.status, rate: exchangeRates.lbpPerUsd })
        .from(businessDays)
        .innerJoin(exchangeRates, eq(exchangeRates.id, businessDays.rateId))
        .where(and(eq(businessDays.locationId, imp.locationId), inArray(businessDays.businessDate, dates)))
    : [];
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const manualDays = new Set<string>();
  if (days.length) {
    const rows = await tx
      .select({ dayId: salesLines.businessDayId })
      .from(salesLines)
      .where(and(inArray(salesLines.businessDayId, days.map((d) => d.id)), eq(salesLines.source, "manual")))
      .groupBy(salesLines.businessDayId);
    for (const r of rows) manualDays.add(r.dayId);
  }

  const existingRefs = new Set<string>();
  const refs = n.lines.map((l) => l.externalRef);
  for (let i = 0; i < refs.length; i += 1000) {
    const chunk = refs.slice(i, i + 1000);
    const found = await tx
      .select({ ref: salesLines.externalRef })
      .from(salesLines)
      .where(and(eq(salesLines.locationId, imp.locationId), eq(salesLines.source, "pos_import"), inArray(salesLines.externalRef, chunk)));
    for (const f of found) if (f.ref) existingRefs.add(f.ref);
  }

  // Same rule as opening a day by hand (lib/rates.ts): the rate in force at the
  // end of that business date in the venue's time zone.
  const rates = await tx.select().from(exchangeRates);
  const [loc] = await tx.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, imp.locationId));
  const now = new Date();
  const rateFor = (date: string) => {
    const choice = pickRateForDate(rates, date, loc?.timezone ?? "Asia/Beirut", now);
    if (!choice) return null;
    return {
      id: choice.rate.id,
      rate: choice.rate.lbpPerUsd,
      at: choice.rate.effectiveAt,
      note: choice.fallback ? "No rate was set yet on this date, so the earliest rate is used." : null,
    };
  };

  const preview = new Map<string, DayPreview>();
  const postable: NormalizedLine[] = [];
  let alreadyImported = 0;
  let blockedLines = 0;
  for (const date of dates) {
    const d = dayByDate.get(date);
    const r = d ? { rate: d.rate, note: null } : rateFor(date);
    preview.set(date, {
      date,
      dayId: d?.id ?? null,
      dayStatus: d ? d.status : "new",
      blocked: d?.status === "closed"
        ? "This day is already closed. Post an adjustment on the day instead."
        : d && manualDays.has(d.id)
          ? "Totals were typed in by hand for this day. Clear them on the day page first, so sales aren't counted twice."
          : !d && !r
            ? "Set an exchange rate before importing."
            : null,
      rate: r?.rate ?? null,
      rateNote: r?.note ?? null,
      toImport: 0,
      alreadyImported: 0,
      cash: zeroPair(),
      card: zeroPair(),
      other: zeroPair(),
      refunds: zeroPair(),
      memo: zeroPair(),
      collectedEq: 0n,
    });
  }
  for (const l of n.lines) {
    const p = preview.get(l.businessDate)!;
    if (existingRefs.has(l.externalRef)) {
      p.alreadyImported++;
      alreadyImported++;
      continue;
    }
    if (p.blocked) {
      blockedLines++;
      continue;
    }
    p.toImport++;
    postable.push(l);
    if (l.lineType === "payment") p[l.tender ?? "other"][l.currency] += l.amountMinor;
    else if (l.lineType === "refund") p.refunds[l.currency] += l.amountMinor;
    else p.memo[l.currency] += l.amountMinor;
  }
  for (const p of preview.values()) {
    if (!p.rate) continue;
    const collected: Pair = zeroPair();
    for (const c of CURRENCIES) collected[c] = p.cash[c] + p.card[c] + p.other[c] - p.refunds[c];
    p.collectedEq = usdEquivalent(collected, parseRate(p.rate));
  }

  return {
    setup: n.setup,
    dateFormat: n.dateFormat,
    days: [...preview.values()],
    postable,
    counts: {
      rows: imp.rows.length,
      lines: n.lines.length,
      toImport: postable.length,
      alreadyImported,
      blocked: blockedLines,
      problems: n.problems.length,
      skipped: n.skipped,
      duplicatesInFile: n.duplicatesInFile,
    },
    problems: n.problems.slice(0, 50),
    rateFor,
  };
}

// ---------------------------------------------------------------- drafts

export async function createImportDraft(
  db: DB,
  scope: TenantScope,
  input: { locationId: string; fileName: string; bytes: Uint8Array },
) {
  requireImporter(scope);
  const fileName = input.fileName.trim().slice(0, 200) || "export";
  const { headers, rows } = await readUpload(fileName, input.bytes);
  if (rows.length === 0) throw new UserError("The file has a header row but no data.");
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  return withTenant(db, scope, async (tx) => {
    const [loc] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId));
    if (!loc) throw new UserError("Pick a location.");
    // Reuse a saved POS format whose columns all exist in this file.
    const profiles = await tx.select().from(posProfiles).orderBy(desc(posProfiles.updatedAt));
    const fits = profiles.find((p) => isMapping(p.mapping) && mappingColumns(p.mapping).every((c) => headers.includes(c)));
    const mapping = completeMapping(fits ? (fits.mapping as Mapping) : suggestMapping(headers, rows), headers, rows);
    const [row] = await tx
      .insert(posImports)
      .values({
        orgId: scope.orgId,
        locationId: loc.id,
        fileName,
        fileHash,
        headers,
        rows,
        rowCount: rows.length,
        profileId: fits?.id ?? null,
        mapping,
        createdBy: scope.userId,
      })
      .returning({ id: posImports.id });
    return row.id;
  });
}

export function mappingColumns(m: Mapping): string[] {
  const cols = [m.dateColumn, ...m.idColumns];
  if (m.amount.mode === "single") {
    cols.push(m.amount.column);
    if (m.amount.currency.mode === "column") cols.push(m.amount.currency.column);
  } else {
    if (m.amount.usdColumn) cols.push(m.amount.usdColumn);
    if (m.amount.lbpColumn) cols.push(m.amount.lbpColumn);
  }
  if (m.tender.mode === "column") cols.push(m.tender.column);
  if (m.type.mode === "column") cols.push(m.type.column);
  return cols;
}

const importSummary = {
  id: posImports.id,
  status: posImports.status,
  fileName: posImports.fileName,
  fileHash: posImports.fileHash,
  rowCount: posImports.rowCount,
  linesImported: posImports.linesImported,
  rowsSkipped: posImports.rowsSkipped,
  daysCreated: posImports.daysCreated,
  createdAt: posImports.createdAt,
  postedAt: posImports.postedAt,
  undoneAt: posImports.undoneAt,
  locationId: posImports.locationId,
  locationName: locations.name,
  createdByName: users.name,
};

export function listImports(db: DB, scope: TenantScope) {
  return withTenant(db, scope, (tx) =>
    tx
      .select(importSummary)
      .from(posImports)
      .innerJoin(locations, eq(locations.id, posImports.locationId))
      .leftJoin(users, eq(users.id, posImports.createdBy))
      .orderBy(desc(posImports.createdAt))
      .limit(50),
  );
}

export function listProfiles(db: DB, scope: TenantScope) {
  return withTenant(db, scope, async (tx) => {
    const profiles = await tx.select().from(posProfiles).orderBy(asc(posProfiles.name));
    const uses = await tx
      .select({ profileId: posImports.profileId, n: count() })
      .from(posImports)
      .where(eq(posImports.status, "posted"))
      .groupBy(posImports.profileId);
    return profiles.map((p) => ({ ...p, uses: uses.find((u) => u.profileId === p.id)?.n ?? 0 }));
  });
}

/** Everything the import page needs: the file, its mapping, and the preview. */
export function getImport(db: DB, scope: TenantScope, importId: string) {
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(posImports).where(eq(posImports.id, importId));
    if (!imp) return null;
    const [loc] = await tx.select().from(locations).where(eq(locations.id, imp.locationId));
    const profiles = await tx.select({ id: posProfiles.id, name: posProfiles.name }).from(posProfiles).orderBy(asc(posProfiles.name));
    const sameFile = await tx
      .select({
        id: posImports.id,
        postedAt: posImports.postedAt,
        locationId: posImports.locationId,
        locationName: locations.name,
      })
      .from(posImports)
      .innerJoin(locations, eq(locations.id, posImports.locationId))
      .where(and(eq(posImports.fileHash, imp.fileHash), eq(posImports.status, "posted")));
    const mapping = completeMapping(
      isMapping(imp.mapping) ? imp.mapping : suggestMapping(imp.headers, imp.rows),
      imp.headers,
      imp.rows,
    );
    const preview = imp.status === "draft" ? await buildPreview(tx, imp, mapping) : null;

    // For a posted import, what it actually added, per day.
    const posted =
      imp.status !== "draft"
        ? await tx
            .select({
              dayId: businessDays.id,
              date: businessDays.businessDate,
              status: businessDays.status,
              lines: count(salesLines.id),
            })
            .from(salesLines)
            .innerJoin(businessDays, eq(businessDays.id, salesLines.businessDayId))
            .where(eq(salesLines.importId, imp.id))
            .groupBy(businessDays.id)
            .orderBy(asc(businessDays.businessDate))
        : [];

    return {
      import: { ...imp, rows: undefined, sample: imp.rows.slice(0, 8) },
      location: loc,
      mapping,
      profiles,
      sameFilePosted: sameFile.filter((s) => s.id !== imp.id),
      preview: preview && { ...preview, postable: undefined, rateFor: undefined },
      posted,
      canUndo: imp.status === "posted" && posted.every((p) => p.status === "open"),
      distinct: (column: string) => {
        const i = imp.headers.indexOf(column);
        if (i < 0) return [];
        return [...new Set(imp.rows.map((r) => r[i] ?? ""))].sort((a, b) => a.localeCompare(b)).slice(0, 40);
      },
    };
  });
}

async function loadDraft(tx: Tx, importId: string) {
  const [imp] = await tx.select().from(posImports).where(eq(posImports.id, importId)).for("update");
  if (!imp) throw new UserError("That import doesn't exist.");
  if (imp.status !== "draft") throw new UserError("This import has already been posted.");
  return imp;
}

export async function saveMapping(db: DB, scope: TenantScope, importId: string, mapping: Mapping) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    const imp = await loadDraft(tx, importId);
    const complete = completeMapping(mapping, imp.headers, imp.rows);
    await tx.update(posImports).set({ mapping: complete }).where(eq(posImports.id, imp.id));
  });
}

export async function applyProfile(db: DB, scope: TenantScope, importId: string, profileId: string) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    const imp = await loadDraft(tx, importId);
    const [p] = await tx.select().from(posProfiles).where(eq(posProfiles.id, profileId));
    if (!p || !isMapping(p.mapping)) throw new UserError("That POS format doesn't exist.");
    const missing = mappingColumns(p.mapping).filter((c) => !imp.headers.includes(c));
    if (missing.length) throw new UserError(`This file doesn't have the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")} that "${p.name}" expects.`);
    await tx
      .update(posImports)
      .set({ mapping: completeMapping(p.mapping, imp.headers, imp.rows), profileId: p.id })
      .where(eq(posImports.id, imp.id));
  });
}

// ---------------------------------------------------------------- posting

export async function postImport(
  db: DB,
  scope: TenantScope,
  importId: string,
  opts: { createMissingDays: boolean; saveAs?: string | null },
) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    const imp = await loadDraft(tx, importId);
    if (!isMapping(imp.mapping)) throw new UserError("Map the columns first.");
    const mapping = imp.mapping;
    const preview = await buildPreview(tx, imp, mapping);
    if (preview.setup.length) throw new UserError(preview.setup[0]);

    const dayIds = new Map<string, string>();
    let daysCreated = 0;
    for (const d of preview.days) {
      if (d.dayId) dayIds.set(d.date, d.dayId);
      else if (opts.createMissingDays && !d.blocked && d.toImport > 0) {
        const rate = preview.rateFor(d.date)!;
        const [day] = await tx
          .insert(businessDays)
          .values({ orgId: scope.orgId, locationId: imp.locationId, businessDate: d.date, rateId: rate.id, openedBy: scope.userId })
          .returning({ id: businessDays.id });
        dayIds.set(d.date, day.id);
        daysCreated++;
      }
    }
    const lines = preview.postable.filter((l) => dayIds.has(l.businessDate));
    if (lines.length === 0) {
      throw new UserError(
        preview.postable.length
          ? "Every line is for a day that isn't open. Tick \"Open missing business days\" or open them first."
          : "There's nothing new to import in this file.",
      );
    }
    for (let i = 0; i < lines.length; i += 500) {
      await tx.insert(salesLines).values(
        lines.slice(i, i + 500).map((l) => ({
          orgId: scope.orgId,
          locationId: imp.locationId,
          businessDayId: dayIds.get(l.businessDate)!,
          source: "pos_import" as const,
          externalRef: l.externalRef,
          lineType: l.lineType,
          tender: l.tender,
          currency: l.currency,
          amountMinor: l.amountMinor,
          importId: imp.id,
          createdBy: scope.userId,
        })),
      );
    }

    let profileId = imp.profileId;
    const name = opts.saveAs?.trim().replace(/\s+/g, " ").slice(0, 60);
    if (name) {
      const [p] = await tx
        .insert(posProfiles)
        .values({ orgId: scope.orgId, name, mapping, createdBy: scope.userId })
        .onConflictDoUpdate({ target: [posProfiles.orgId, posProfiles.name], set: { mapping, updatedAt: new Date() } })
        .returning({ id: posProfiles.id });
      profileId = p.id;
    }

    await tx
      .update(posImports)
      .set({
        status: "posted",
        profileId,
        linesImported: lines.length,
        rowsSkipped: preview.counts.rows - new Set(lines.map((l) => l.row)).size,
        daysCreated,
        postedBy: scope.userId,
        postedAt: new Date(),
      })
      .where(eq(posImports.id, imp.id));
    return { linesImported: lines.length, daysCreated };
  });
}

export async function undoImport(db: DB, scope: TenantScope, importId: string) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(posImports).where(eq(posImports.id, importId)).for("update");
    if (!imp) throw new UserError("That import doesn't exist.");
    if (imp.status !== "posted") throw new UserError("Only a posted import can be undone.");
    const closed = await tx
      .select({ date: businessDays.businessDate })
      .from(salesLines)
      .innerJoin(businessDays, eq(businessDays.id, salesLines.businessDayId))
      .where(and(eq(salesLines.importId, imp.id), eq(businessDays.status, "closed")))
      .groupBy(businessDays.businessDate);
    if (closed.length) {
      throw new UserError(
        `Can't undo: ${closed.map((c) => c.date).join(", ")} ${closed.length === 1 ? "is" : "are"} already closed. Post adjustments on those days instead.`,
      );
    }
    await tx.delete(salesLines).where(eq(salesLines.importId, imp.id));
    await tx
      .update(posImports)
      .set({ status: "undone", undoneBy: scope.userId, undoneAt: new Date() })
      .where(eq(posImports.id, imp.id));
  });
}

/** Throws away an uploaded file that was never imported. */
export async function discardImport(db: DB, scope: TenantScope, importId: string) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    const rows = await tx
      .delete(posImports)
      .where(and(eq(posImports.id, importId), eq(posImports.status, "draft")))
      .returning({ fileName: posImports.fileName });
    if (!rows.length) throw new UserError("Only a file that hasn't been imported can be discarded. Undo a posted import instead.");
    return rows[0];
  });
}

export async function deleteProfile(db: DB, scope: TenantScope, profileId: string) {
  requireImporter(scope);
  return withTenant(db, scope, async (tx) => {
    await tx.delete(posProfiles).where(eq(posProfiles.id, profileId));
  });
}

// ---------------------------------------------------------------- the mapping form

const TENDERS: Tender[] = ["cash", "card", "other"];
const TYPES: LineType[] = ["payment", "refund", "discount", "void", "tax", "service_charge"];
const FORMATS: DateFormat[] = ["auto", "DMY", "MDY", "YMD"];

/** Reads the mapping form. Value tables are dropped when their column changes. */
export function mappingFromForm(fd: FormData): Mapping {
  const s = (k: string) => String(fd.get(k) ?? "");
  const pairs = <T extends string>(prefix: string, allowed: readonly T[]) => {
    const out: Record<string, T | "skip"> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith(`${prefix}Key_`)) continue;
      const val = s(`${prefix}Val_${k.slice(prefix.length + 4)}`);
      out[String(v)] = (allowed as readonly string[]).includes(val) ? (val as T) : "skip";
    }
    return out;
  };
  const keep = <T,>(prefix: string, column: string, values: T) => (s(`${prefix}PrevColumn`) === column ? values : ({} as T));

  const amountMode = s("amountMode") === "split" ? "split" : "single";
  const amount: Mapping["amount"] =
    amountMode === "split"
      ? { mode: "split", usdColumn: s("usdColumn") || null, lbpColumn: s("lbpColumn") || null }
      : {
          mode: "single",
          column: s("amountColumn"),
          currency:
            s("currencyMode") === "column"
              ? {
                  mode: "column",
                  column: s("currencyColumn"),
                  values: keep("currency", s("currencyColumn"), pairs<Currency>("currency", CURRENCIES)),
                }
              : { mode: "fixed", value: s("currencyFixed") === "LBP" ? "LBP" : "USD" },
        };
  const cutoff = Number(s("dayCutoffHour"));
  return {
    dateColumn: s("dateColumn"),
    dateFormat: (FORMATS as string[]).includes(s("dateFormat")) ? (s("dateFormat") as DateFormat) : "auto",
    dayCutoffHour: Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 8 ? cutoff : 5,
    idColumns: fd.getAll("idColumns").map(String).filter(Boolean),
    amount,
    tender:
      s("tenderMode") === "column"
        ? { mode: "column", column: s("tenderColumn"), values: keep("tender", s("tenderColumn"), pairs<Tender>("tender", TENDERS)) }
        : { mode: "fixed", value: (TENDERS as string[]).includes(s("tenderFixed")) ? (s("tenderFixed") as Tender) : "cash" },
    type:
      s("typeMode") === "column"
        ? { mode: "column", column: s("typeColumn"), values: keep("type", s("typeColumn"), pairs<LineType>("type", TYPES)) }
        : { mode: "fixed", value: (TYPES as string[]).includes(s("typeFixed")) ? (s("typeFixed") as LineType) : "payment" },
  };
}

