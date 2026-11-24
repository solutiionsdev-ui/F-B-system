"use server";
// Every action re-reads the session and role on the server; nothing from the
// browser is trusted. Database errors from triggers and row-level security
// come back as plain-language messages.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DB } from "@/db/database";
import type { Currency, PaidFrom, VarianceReason } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { MoneyError, parseAmount, parseOptionalAmount, type Pair } from "@/lib/money";
import { requireContext, setActiveOrg, signIn, signOut, type AppContext } from "@/server/auth";
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
  UserError,
  voidExpense,
  type SalesTotalsInput,
} from "@/server/operations";

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
  for (const p of revalidate) revalidatePath(p);
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
        source: (str(fd, "source") || "market") as "market" | "bank" | "custom",
        note: str(fd, "note"),
      }),
    ["/", "/rates"],
    "New rate saved. Days opened from now on will use it.",
  );
}

// ---------------------------------------------------------------- days

export async function openDayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const db = await getDb();
  let id: string;
  try {
    const day = await openDay(db, ctx.scope, {
      locationId: str(fd, "locationId"),
      businessDate: str(fd, "businessDate"),
      openingFloat: {
        USD: field(fd, "float_USD", "USD", "Opening float (USD)"),
        LBP: field(fd, "float_LBP", "LBP", "Opening float (LBP)"),
      },
    });
    id = day.id;
  } catch (e) {
    return { error: toMessage(e) };
  }
  revalidatePath("/");
  redirect(`/days/${id}`);
}

const SALES_FIELDS: { key: keyof SalesTotalsInput; label: string }[] = [
  { key: "cash", label: "Cash payments" },
  { key: "card", label: "Card payments" },
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
        currency,
        amountMinor: field(fd, "amount", currency, "Amount", false),
        paidFrom: (str(fd, "paidFrom") || "drawer") as PaidFrom,
      });
    },
    [`/days/${dayId}`],
    "Expense recorded",
  );
}

export async function voidExpenseAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run(
    (ctx, db) => voidExpense(db, ctx.scope, str(fd, "expenseId"), str(fd, "reason")),
    [`/days/${dayId}`],
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
        direction: str(fd, "direction") === "in" ? "in" : "out",
        currency,
        amountMinor: field(fd, "amount", currency, "Amount", false),
        reason: str(fd, "reason"),
      });
    },
    [`/days/${dayId}`],
    "Cash movement recorded",
  );
}

export async function deleteMovementAction(_: ActionState, fd: FormData) {
  const dayId = str(fd, "dayId");
  return run((ctx, db) => deleteMovement(db, ctx.scope, str(fd, "movementId")), [`/days/${dayId}`], "Removed");
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
