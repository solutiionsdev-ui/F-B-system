"use server";
// Every action re-reads the session and role on the server; nothing from the
// browser is trusted. Database errors from triggers and row-level security
// come back as plain-language messages.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DB } from "@/db/database";
import type { Currency, PaidFrom, VarianceReason } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { PAYMENT_METHODS, type MovementKind } from "@/lib/expense-buckets";
import { MoneyError, parseAmount, parseOptionalAmount, type Pair } from "@/lib/money";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { createSession, requireContext, setActiveOrg, signIn, signOut, type AppContext } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  addAdjustment,
  addExpense,
  addMovement,
  closeDay,
  deleteMovement,
  openDay,
  saveCount,
  saveManualSales,
  setRate,
  todayIn,
  UserError,
  voidExpense,
  type SalesTotalsInput,
} from "@/server/operations";
import {
  acceptInvite,
  addLocation,
  setLocationStatus,
  setMemberAccess,
  updateLocation,
  changeRole,
  createInvite,
  removeMember,
  renewInvite,
  revokeInvite,
  updateSettings,
} from "@/server/team";
import {
  createRecipeImport,
  discardRecipeImport,
  postRecipeImport,
  saveIngredient,
  saveRecipe,
  setIngredientPrice,
  setRecipeArchived,
  updateFoodCostSettings,
} from "@/server/kitchen";
import {
  applyProfile,
  createImportDraft,
  fetchGoogleSheet,
  deleteProfile,
  discardImport,
  mappingFromForm,
  postImport,
  saveMapping,
  undoImport,
} from "@/server/pos-import";

function pgError(e: unknown): { code?: string; message?: string } {
  let cur = e as { code?: string; message?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 5; i++) {
    if (typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) return cur;
    cur = cur.cause as typeof cur;
  }
  return {};
}

function toMessage(e: unknown): string {
  if (e instanceof UserError || e instanceof MoneyError) return e.message;
  const pg = pgError(e);
  if (pg.code === "P0001" && pg.message) return pg.message;
  if (pg.code === "42501") return "You don't have permission to do that.";
  if (pg.code === "23505") return "That has already been recorded.";
  console.error(e);
  return "Something went wrong and nothing was saved. Please try again.";
}

async function run(
  fn: (ctx: AppContext, db: DB) => Promise<unknown>,
  revalidate: string[],
  ok = "Saved",
): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    await fn(ctx, db);
  } catch (e) {
    return { error: toMessage(e) };
  }
  // Three tabs read the same figures, so every save refreshes all of them.
  void revalidate;
  revalidatePath("/", "layout");
  return { ok, at: Date.now() };
}

const str = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

function field(fd: FormData, name: string, currency: Currency, label: string, optional = true): bigint {
  try {
    return optional ? parseOptionalAmount(str(fd, name), currency) : parseAmount(str(fd, name), currency);
  } catch (e) {
    if (e instanceof MoneyError) throw new UserError(`${label}: ${e.message}`);
    throw e;
  }
}

const currencyOf = (v: string): Currency => {
  if (v !== "USD" && v !== "LBP") throw new UserError("Pick a currency.");
  return v;
};

const paidFromOf = (v: string): PaidFrom => {
  if (!v) return "drawer";
  if (!(PAYMENT_METHODS as readonly string[]).includes(v)) throw new UserError("Pick how the expense was paid.");
  return v as PaidFrom;
};

// ---------------------------------------------------------------- session

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ok = await signIn(str(fd, "email"), String(fd.get("password") ?? ""));
  if (!ok) return { error: "That email and password don't match." };
  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

export async function switchOrgAction(fd: FormData) {
  const ctx = await requireContext();
  await setActiveOrg(ctx, str(fd, "orgId"));
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------- rates

export async function setRateAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      setRate(db, ctx.scope, {
        lbpPerUsd: str(fd, "rate"),
        // Required: setRate refuses a rate without a source.
        source: str(fd, "source") as "market" | "bank" | "custom",
        note: str(fd, "note"),
      }),
    ["/", "/rates", "/settings"],
    "New rate saved. Days opened from now on will use it.",
  );
}

// ---------------------------------------------------------------- days

export async function openDayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    const day = await openDay(db, ctx.scope, {
      locationId: str(fd, "locationId"),
      businessDate: str(fd, "businessDate"),
      openingFloat: {
        USD: field(fd, "float_USD", "USD", "Opening float (USD)"),
        LBP: field(fd, "float_LBP", "LBP", "Opening float (LBP)"),
      },
    });
    void day;
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/close?date=${encodeURIComponent(str(fd, "businessDate"))}`);
}

const SALES_FIELDS: { key: keyof SalesTotalsInput; label: string }[] = [
  { key: "cash", label: "Cash payments" },
  { key: "card", label: "Card payments" },
  { key: "toters", label: "Delivery apps: Toters" },
  { key: "noknok", label: "Delivery apps: NokNok" },
  { key: "other", label: "Other payments" },
  { key: "cashRefunds", label: "Cash refunds" },
  { key: "discounts", label: "Discounts" },
  { key: "voids", label: "Voids" },
  { key: "tax", label: "VAT" },
  { key: "serviceCharge", label: "Service charge" },
];

export async function saveSalesAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => {
      const totals = {} as SalesTotalsInput;
      for (const f of SALES_FIELDS) {
        const pair: Pair = {
          USD: field(fd, `${f.key}_USD`, "USD", `${f.label} (USD)`),
          LBP: field(fd, `${f.key}_LBP`, "LBP", `${f.label} (LBP)`),
        };
        totals[f.key] = pair;
      }
      return saveManualSales(db, ctx.scope, dayId, totals);
    },
    [`/days/${dayId}`],
    "Sales totals saved",
  );
}

export async function addExpenseAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => {
      const currency = currencyOf(str(fd, "currency"));
      return addExpense(db, ctx.scope, {
        dayId,
        categoryId: str(fd, "categoryId"),
        description: str(fd, "description"),
        vendor: str(fd, "vendor"),
        receiptRef: str(fd, "receiptRef"),
        currency,
        amountMinor: field(fd, "amount", currency, "Amount", false),
        paidFrom: paidFromOf(str(fd, "paidFrom")),
      });
    },
    [`/days/${dayId}`, "/expenses", "/closing"],
    "Expense recorded",
  );
}

export async function voidExpenseAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => voidExpense(db, ctx.scope, str(fd, "expenseId"), str(fd, "reason")),
    [`/days/${dayId}`, "/expenses", "/closing"],
    "Expense voided",
  );
}

export async function addMovementAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => {
      const currency = currencyOf(str(fd, "currency"));
      return addMovement(db, ctx.scope, {
        dayId,
        kind: str(fd, "kind") as MovementKind,
        currency,
        amountMinor: field(fd, "amount", currency, "Amount", false),
        reason: str(fd, "reason"),
        partnerName: str(fd, "partnerName"),
        direction: str(fd, "direction") === "out" ? "out" : str(fd, "direction") === "in" ? "in" : undefined,
      });
    },
    [`/days/${dayId}`, "/expenses", "/closing"],
    "Cash movement recorded",
  );
}

export async function deleteMovementAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run((ctx, db) => deleteMovement(db, ctx.scope, str(fd, "movementId")), [`/days/${dayId}`, "/expenses", "/closing"], "Removed");
}

export async function saveCountAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => {
      const currency = currencyOf(str(fd, "currency"));
      const denominations: Record<string, number> = {};
      for (const [k, v] of fd.entries()) {
        if (!k.startsWith("note_")) continue;
        const raw = String(v).trim();
        if (raw === "") continue;
        if (!/^\d+$/.test(raw)) throw new UserError("Note counts must be whole numbers.");
        denominations[k.slice(5)] = Number(raw);
      }
      return saveCount(db, ctx.scope, {
        dayId,
        currency,
        denominations,
        looseMinor: field(fd, "loose", currency, "Coins and other"),
      });
    },
    [`/days/${dayId}`],
    "Count saved",
  );
}

export async function closeDayAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) =>
      closeDay(db, ctx.scope, dayId, {
        reason: (str(fd, "reason") || null) as VarianceReason | null,
        note: str(fd, "note"),
        noSalesReason: str(fd, "noSalesReason"),
      }),
    [`/days/${dayId}`, "/"],
    "Day closed and locked",
  );
}

export async function addAdjustmentAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => {
      const currency = currencyOf(str(fd, "currency"));
      const sign = str(fd, "direction") === "minus" ? -1n : 1n;
      return addAdjustment(db, ctx.scope, {
        dayId,
        currency,
        amountMinor: sign * field(fd, "amount", currency, "Amount", false),
        reason: str(fd, "reason"),
      });
    },
    [`/days/${dayId}`],
    "Adjustment posted",
  );
}

// ---------------------------------------------------------------- team

export async function addLocationAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) => addLocation(db, ctx.scope, str(fd, "name"), str(fd, "venueType") || "other"),
    ["/settings", "/team", "/"],
    "Location added. Assign people to it in Team & Permissions.",
  );
}

export async function updateLocationAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      updateLocation(db, ctx.scope, str(fd, "locationId"), {
        name: str(fd, "name"),
        venueType: str(fd, "venueType"),
        dayCutoffHour: Number(str(fd, "dayCutoffHour")),
      }),
    ["/settings", "/"],
    "Location saved",
  );
}

export async function setLocationStatusAction(_: ActionState, fd: FormData) {
  const status = str(fd, "status") === "archived" ? "archived" : "active";
  return run(
    (ctx, db) => setLocationStatus(db, ctx.scope, str(fd, "locationId"), status),
    ["/settings", "/team", "/"],
    status === "archived" ? "Location archived" : "Location restored",
  );
}

export async function setMemberAccessAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      setMemberAccess(db, ctx.scope, str(fd, "membershipId"), {
        locationIds: fd.getAll("locationIds").map(String),
        // Unticked boxes mean "off"; only the role's adjustable permissions are kept.
        permissions: Object.fromEntries(ALL_PERMISSIONS.map((k) => [k, fd.has(`perm_${k}`)])),
      }),
    ["/team", "/"],
    "Access saved",
  );
}

/** Invite actions return the link path so the page can show it once to copy. */
async function inviteResult(
  fn: (ctx: AppContext, db: DB) => Promise<{ token: string; email: string }>,
  ok: string,
): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    const { token, email } = await fn(ctx, db);
    revalidatePath("/", "layout");
    return { ok, at: Date.now(), data: { path: `/invite/${token}`, email } };
  } catch (e) {
    return { error: toMessage(e) };
  }
}

export async function createInviteAction(_: ActionState, fd: FormData) {
  return inviteResult(
    (ctx, db) =>
      createInvite(db, ctx.scope, {
        email: str(fd, "email"),
        role: str(fd, "role"),
        locationIds: fd.getAll("locationIds").map(String),
        note: str(fd, "note"),
      }),
    "Invitation created",
  );
}

export async function renewInviteAction(_: ActionState, fd: FormData) {
  return inviteResult((ctx, db) => renewInvite(db, ctx.scope, str(fd, "inviteId")), "New link created");
}

export async function revokeInviteAction(_: ActionState, fd: FormData) {
  return run((ctx, db) => revokeInvite(db, ctx.scope, str(fd, "inviteId")), ["/team"], "Invitation cancelled");
}

export async function changeRoleAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) => changeRole(db, ctx.scope, str(fd, "membershipId"), str(fd, "role")),
    ["/team"],
    "Role updated",
  );
}

export async function removeMemberAction(_: ActionState, fd: FormData) {
  return run((ctx, db) => removeMember(db, ctx.scope, str(fd, "membershipId")), ["/team"], "Removed from the team");
}

export async function updateSettingsAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      updateSettings(db, ctx.scope, {
        name: str(fd, "name"),
        toleranceUsd: str(fd, "toleranceUsd"),
        toleranceLbp: str(fd, "toleranceLbp"),
      }),
    ["/settings", "/"],
    "Settings saved",
  );
}

/** Public: the person opening an invite link. Signs them in once they join. */
export async function acceptInviteAction(token: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const db = await getDb();
  let joined: { userId: string; orgId: string };
  try {
    joined = await acceptInvite(db, token, { name: str(fd, "name"), password: String(fd.get("password") ?? "") });
  } catch (e) {
    return { error: toMessage(e) };
  }
  await signOut();
  await createSession(joined.userId, joined.orgId);
  redirect("/");
}

// ---------------------------------------------------------------- POS import

/** The uploaded file, or the Google Sheet whose link was pasted instead. */
async function uploadedExport(fd: FormData): Promise<{ fileName: string; bytes: Uint8Array }> {
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  const link = str(fd, "sheetUrl");
  if (link) return fetchGoogleSheet(link);
  throw new UserError("Choose the Omega export (CSV, Excel or PDF), or paste a Google Sheets link.");
}

export async function uploadImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  let id: string;
  try {
    const upload = await uploadedExport(fd);
    id = await createImportDraft(db, ctx.scope, { locationId: str(fd, "locationId"), ...upload });
  } catch (e) {
    return { error: toMessage(e) };
  }
  redirect(`/import/${id}`);
}

export async function saveMappingAction(importId: string, _: ActionState, fd: FormData) {
  return run((ctx, db) => saveMapping(db, ctx.scope, importId, mappingFromForm(fd)), [`/import/${importId}`], "Preview updated");
}

export async function applyProfileAction(importId: string, _: ActionState, fd: FormData) {
  return run((ctx, db) => applyProfile(db, ctx.scope, importId, str(fd, "profileId")), [`/import/${importId}`], "Format applied");
}

export async function postImportAction(importId: string, _: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      postImport(db, ctx.scope, importId, {
        createMissingDays: fd.get("createMissingDays") === "on",
        saveAs: str(fd, "saveAs") || null,
      }),
    [`/import/${importId}`, "/import", "/"],
    "Imported",
  );
}

export async function undoImportAction(importId: string) {
  return run((ctx, db) => undoImport(db, ctx.scope, importId), [`/import/${importId}`, "/import", "/"], "Import undone");
}

export async function deleteProfileAction(_: ActionState, fd: FormData) {
  return run((ctx, db) => deleteProfile(db, ctx.scope, str(fd, "profileId")), ["/import"], "Format deleted");
}

export async function discardImportAction(importId: string): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    await discardImport(db, ctx.scope, importId);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "File discarded", at: Date.now() };
}

/** "Needs you": import a clean draft in one click, opening any missing days. */
export async function quickImportAction(importId: string): Promise<ActionState> {
  return run(
    (ctx, db) => postImport(db, ctx.scope, importId, { createMissingDays: true }),
    ["/", "/import", `/import/${importId}`],
    "Imported",
  );
}

/** "Needs you": open today's business day for a location; the float can be set on the day page. */
export async function quickOpenDayAction(locationId: string): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  let id: string;
  try {
    const day = await openDay(db, ctx.scope, { locationId, businessDate: todayIn(), openingFloat: { USD: 0n, LBP: 0n } });
    id = day.id;
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/days/${id}#step-3`);
}

/** Import page: discard the draft and go back to the list. */
export async function discardImportAndReturnAction(importId: string): Promise<ActionState> {
  const res = await discardImportAction(importId);
  if (res.error) return res;
  redirect("/settings/pos");
}

/** "Needs you": make a fresh invite link (the old one stops working). */
export async function quickRenewInviteAction(inviteId: string) {
  return inviteResult((ctx, db) => renewInvite(db, ctx.scope, inviteId), "New link created");
}

// ---------------------------------------------------------------- Daily Close (v2.1)

const closeUrl = (date: string, extra = "") => `/close?date=${encodeURIComponent(date)}${extra}`;

/** Step 1: read the file into a draft for this branch and come back to Daily Close to preview it. Nothing is posted. */
export async function uploadForCloseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  const date = str(fd, "date");
  let id: string;
  try {
    const upload = await uploadedExport(fd);
    id = await createImportDraft(db, ctx.scope, { locationId: str(fd, "locationId"), ...upload });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(closeUrl(date, `&import=${id}#step-1`));
}

/**
 * Step 1: post a previewed draft onto the open day, after the person confirms.
 * Missing days are never opened from here: the day was opened with its float
 * first. Only a file for this one date is posted. Totals typed in for the day
 * are replaced in the same transaction (the audit trail keeps them). Posting
 * twice is refused (the draft is posted once, and rows already imported are
 * skipped by their POS reference).
 */
export async function confirmCloseImportAction(importId: string, date: string, _: ActionState, fd: FormData): Promise<ActionState> {
  void fd;
  const ctx = await requireContext();
  const db = await getDb();
  try {
    await postImport(db, ctx.scope, importId, { createMissingDays: false, replaceManual: true, onlyDate: date });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(closeUrl(date, "#step-1"));
}

export async function discardCloseImportAction(importId: string, date: string): Promise<ActionState> {
  const res = await discardImportAction(importId);
  if (res.error) return res;
  redirect(closeUrl(date, "#step-1"));
}

// ---------------------------------------------------------------- Kitchen (stage A)

function recipeLinesFrom(fd: FormData) {
  const refs = fd.getAll("line_ref").map(String);
  const qtys = fd.getAll("line_qty").map(String);
  const units = fd.getAll("line_unit").map(String);
  return refs.map((ref, i) => ({ ref, quantity: qtys[i] ?? "", unit: units[i] ?? "" }));
}

export async function saveRecipeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  let id: string;
  try {
    id = await saveRecipe(db, ctx.scope, {
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      kind: str(fd, "kind"),
      category: str(fd, "category"),
      sellingPrice: str(fd, "sellingPrice"),
      priceCurrency: str(fd, "priceCurrency"),
      packaging: str(fd, "packaging"),
      targetPct: str(fd, "targetPct"),
      yieldQty: str(fd, "yieldQty"),
      yieldUnit: str(fd, "yieldUnit"),
      note: str(fd, "note"),
      lines: recipeLinesFrom(fd),
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/kitchen/recipes/${id}`);
}

export async function archiveRecipeAction(_: ActionState, fd: FormData) {
  const archived = str(fd, "archived") === "true";
  return run((ctx, db) => setRecipeArchived(db, ctx.scope, str(fd, "recipeId"), archived), [], archived ? "Recipe archived" : "Recipe restored");
}

export async function saveIngredientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  const existing = str(fd, "id");
  let id: string;
  try {
    id = await saveIngredient(db, ctx.scope, {
      id: existing || undefined,
      name: str(fd, "name"),
      baseUnit: str(fd, "baseUnit"),
      gramsPerMl: str(fd, "gramsPerMl"),
      gramsPerUnit: str(fd, "gramsPerUnit"),
      yieldPct: str(fd, "yieldPct"),
      category: str(fd, "category"),
      supplier: str(fd, "supplier"),
      note: str(fd, "note"),
    });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  if (existing) return { ok: "Ingredient saved", at: Date.now() };
  redirect(`/kitchen/inventory/${id}`);
}

export async function setIngredientPriceAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      setIngredientPrice(db, ctx.scope, {
        ingredientId: str(fd, "ingredientId"),
        price: str(fd, "price"),
        currency: str(fd, "currency"),
        pack: str(fd, "pack"),
        packSize: str(fd, "packSize"),
        supplier: str(fd, "supplier"),
        note: str(fd, "note"),
      }),
    [],
    "New price saved. Every recipe using it is recosted.",
  );
}

export async function uploadRecipeWorkbookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the costing workbook (.xlsx)." };
  let id: string;
  try {
    id = await createRecipeImport(db, ctx.scope, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/kitchen/import/${id}`);
}

export async function postRecipeImportAction(importId: string): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    await postRecipeImport(db, ctx.scope, importId);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/kitchen/import/${importId}`);
}

export async function discardRecipeImportAction(importId: string): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  try {
    await discardRecipeImport(db, ctx.scope, importId);
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/", "layout");
  redirect("/kitchen/import");
}

export async function updateFoodCostSettingsAction(_: ActionState, fd: FormData) {
  return run(
    (ctx, db) =>
      updateFoodCostSettings(db, ctx.scope, {
        target: str(fd, "target"),
        overhead: str(fd, "overhead"),
        vat: str(fd, "vat"),
        vatIncluded: fd.get("vatIncluded") === "on",
      }),
    [],
    "Food cost settings saved",
  );
}
