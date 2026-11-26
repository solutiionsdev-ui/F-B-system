// Demo data for local development and pilot demos: two fictional restaurant
// groups, a week of closed days, and one open day ready to close.
// Logins are listed in README.md. Never run this against production.
import { count, sql } from "drizzle-orm";
import type { Database, DB, TenantScope } from "./database";
import {
  exchangeRates,
  expenseCategories,
  locations,
  membershipLocations,
  memberships,
  organizations,
  users,
} from "./schema";
import { DEFAULT_CATEGORIES } from "@/lib/expense-buckets";
import { hashPassword } from "@/lib/password";
import { DENOMINATIONS, type Currency, type Pair } from "@/lib/money";
import {
  addExpense,
  addMovement,
  closeDay,
  getDay,
  openDay,
  saveCount,
  saveManualSales,
  todayIn,
} from "@/server/operations";
import type { VarianceReason } from "./schema";

export const DEMO_PASSWORD = "pilot-demo-2027";

/** Small deterministic random generator so the demo data is the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number, step = 1) =>
  BigInt(Math.round((lo + r() * (hi - lo)) / step) * step);

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));

/** Splits an amount into notes (largest first) plus loose change. */
export function toNotes(total: bigint, currency: Currency) {
  const factor = currency === "USD" ? 100n : 1n;
  let rest = total;
  const notes: Record<string, number> = {};
  for (const note of DENOMINATIONS[currency]) {
    const value = BigInt(note) * factor;
    const qty = rest / value;
    if (qty > 0n) {
      notes[String(note)] = Number(qty);
      rest -= qty * value;
    }
  }
  return { notes, loose: rest };
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type DayPlan = {
  date: string;
  close: boolean;
  /** Cash difference to leave in the drawer when counting. */
  shortBy?: Pair;
  reason?: VarianceReason;
  note?: string;
};

async function simulateDay(db: DB, scope: TenantScope, locationId: string, categoryIds: Map<string, string>, plan: DayPlan, seed: number) {
  const r = rng(seed);
  const day = await openDay(db, scope, {
    locationId,
    businessDate: plan.date,
    openingFloat: { USD: usd(100), LBP: 2_000_000n },
  });
  await saveManualSales(db, scope, day.id, {
    cash: { USD: between(r, 550, 1150) * 100n, LBP: between(r, 14_000_000, 42_000_000, 5_000) },
    card: { USD: between(r, 280, 900) * 100n, LBP: between(r, 0, 4_500_000, 5_000) },
    toters: { USD: 0n, LBP: 0n },
    noknok: { USD: 0n, LBP: 0n },
    other: { USD: 0n, LBP: 0n },
    cashRefunds: { USD: r() < 0.3 ? between(r, 8, 25) * 100n : 0n, LBP: 0n },
    discounts: { USD: between(r, 15, 60) * 100n, LBP: 0n },
    voids: { USD: r() < 0.5 ? between(r, 5, 30) * 100n : 0n, LBP: 0n },
    tax: { USD: between(r, 90, 210) * 100n, LBP: 0n },
    serviceCharge: { USD: 0n, LBP: 0n },
  });
  const cat = (name: string) => categoryIds.get(name)!;
  await addExpense(db, scope, {
    dayId: day.id,
    categoryId: cat("Food & Kitchen Suppliers"),
    description: "Bread and kaak delivery",
    vendor: "Local bakery",
    currency: "LBP",
    amountMinor: between(r, 900_000, 1_800_000, 50_000),
    paidFrom: "drawer",
  });
  if (r() < 0.6) {
    await addExpense(db, scope, {
      dayId: day.id,
      categoryId: cat("Beverage, Coffee & Bar Suppliers"),
      description: "Ice and water gallons",
      currency: "LBP",
      amountMinor: between(r, 300_000, 700_000, 50_000),
      paidFrom: "drawer",
    });
  }
  if (r() < 0.4) {
    await addExpense(db, scope, {
      dayId: day.id,
      categoryId: cat("Cleaning, Maintenance & Repairs"),
      description: "Detergent and paper towels",
      currency: "USD",
      amountMinor: between(r, 9, 28) * 100n,
      paidFrom: "drawer",
    });
  }
  if (r() < 0.25) {
    await addExpense(db, scope, {
      dayId: day.id,
      categoryId: cat("Generator & Electricity"),
      description: "Monthly generator subscription",
      vendor: "Neighbourhood generator",
      currency: "USD",
      amountMinor: usd(185),
      paidFrom: "bank",
    });
  }
  if (r() < 0.7) {
    await addMovement(db, scope, {
      dayId: day.id,
      kind: "safe_drop",
      currency: "USD",
      amountMinor: usd(400),
      reason: "Moved to the safe",
    });
  }
  if (!plan.close) return day.id;

  const detail = (await getDay(db, scope, day.id))!;
  for (const c of ["USD", "LBP"] as const) {
    const target = detail.breakdown.expected[c] - (plan.shortBy?.[c] ?? 0n);
    const { notes, loose } = toNotes(target, c);
    await saveCount(db, scope, { dayId: day.id, currency: c, denominations: notes, looseMinor: loose });
  }
  await closeDay(db, scope, day.id, { reason: plan.reason ?? null, note: plan.note });
  return day.id;
}

/** Groups, people, locations, categories and the first rates. Runs in one transaction. */
async function seedBase(db: DB) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [cafe, bistro] = await db
    .insert(organizations)
    .values([
      { name: "Demo Café Group", plan: "multi" },
      { name: "Demo Bistro", plan: "single" },
    ])
    .returning();
  const [owner, manager, accountant, owner2] = await db
    .insert(users)
    .values([
      { email: "owner@demo.test", name: "Rana (Owner)", passwordHash },
      { email: "manager@demo.test", name: "Karim (Manager)", passwordHash },
      { email: "accountant@demo.test", name: "Nadine (Accountant)", passwordHash },
      { email: "bistro@demo.test", name: "Elie (Bistro owner)", passwordHash },
    ])
    .returning();
  const ms = await db.insert(memberships).values([
    { userId: owner.id, orgId: cafe.id, role: "owner" },
    { userId: manager.id, orgId: cafe.id, role: "manager" },
    { userId: accountant.id, orgId: cafe.id, role: "accountant" },
    { userId: accountant.id, orgId: bistro.id, role: "accountant" },
    { userId: owner2.id, orgId: bistro.id, role: "owner" },
  ]).returning();
  const [hamra, gemmayzeh] = await db
    .insert(locations)
    .values([
      { orgId: cafe.id, name: "Hamra", venueType: "cafe" },
      { orgId: cafe.id, name: "Gemmayzeh", venueType: "restaurant" },
    ])
    .returning();
  const [marMikhael] = await db.insert(locations).values({ orgId: bistro.id, name: "Mar Mikhael", venueType: "pub" }).returning();
  // Owners see every venue. Karim manages both cafe venues; Nadine was invited to every venue of both clients.
  await db.insert(membershipLocations).values([
    { membershipId: ms[1].id, locationId: hamra.id, orgId: cafe.id },
    { membershipId: ms[1].id, locationId: gemmayzeh.id, orgId: cafe.id },
    { membershipId: ms[2].id, locationId: hamra.id, orgId: cafe.id },
    { membershipId: ms[2].id, locationId: gemmayzeh.id, orgId: cafe.id },
    { membershipId: ms[3].id, locationId: marMikhael.id, orgId: bistro.id },
  ]);

  const categories = async (orgId: string) => {
    const rows = await db
      .insert(expenseCategories)
      .values(DEFAULT_CATEGORIES.map((name, i) => ({ orgId, name, position: i + 1 })))
      .returning();
    return new Map(rows.map((c) => [c.name, c.id]));
  };
  const cafeCats = await categories(cafe.id);
  const bistroCats = await categories(bistro.id);

  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  await db.insert(exchangeRates).values([
    { orgId: cafe.id, lbpPerUsd: "89500.0000", source: "market", note: "Opening rate", createdBy: owner.id, effectiveAt: monthAgo },
    { orgId: bistro.id, lbpPerUsd: "89000.0000", source: "custom", note: "House rate", createdBy: owner2.id, effectiveAt: monthAgo },
  ]);

  return { cafe, bistro, owner, manager, owner2, hamra, gemmayzeh, marMikhael, cafeCats, bistroCats };
}

type SeedBase = Awaited<ReturnType<typeof seedBase>>;

/** A week of history, through the same operations the app uses. */
async function seedHistory(db: DB, b: SeedBase) {
  const { cafe, bistro, owner, manager, owner2, hamra, gemmayzeh, marMikhael, cafeCats, bistroCats } = b;
  const today = todayIn();
  const cafeScope: TenantScope = { orgId: cafe.id, userId: manager.id, role: "manager" };
  const bistroScope: TenantScope = { orgId: bistro.id, userId: owner2.id, role: "owner" };

  // Older days at 89,500.
  for (let i = 7; i >= 3; i--) {
    const plan: DayPlan = { date: addDays(today, -i), close: true };
    if (i === 5) {
      plan.shortBy = { USD: 0n, LBP: 1_790_000n };
      plan.reason = "unrecorded_expense";
      plan.note = "Paid the plumber from the drawer; receipt to follow.";
    }
    await simulateDay(db, cafeScope, hamra.id, cafeCats, plan, 100 + i);
    if (i <= 4) await simulateDay(db, cafeScope, gemmayzeh.id, cafeCats, { date: addDays(today, -i), close: true }, 200 + i);
  }
  for (let i = 3; i >= 1; i--) {
    const short = i === 2;
    await simulateDay(
      db,
      bistroScope,
      marMikhael.id,
      bistroCats,
      {
        date: addDays(today, -i),
        close: true,
        shortBy: short ? { USD: usd(20), LBP: 0n } : undefined,
        reason: short ? "counting_error" : undefined,
        note: short ? "Counted twice at closing and came up $20 short both times." : undefined,
      },
      300 + i,
    );
  }

  // The rate moved; newer days use the new rate while older days keep theirs.
  await db.insert(exchangeRates).values({
    orgId: cafe.id,
    lbpPerUsd: "89700.0000",
    source: "market",
    note: "Market moved",
    createdBy: owner.id,
    effectiveAt: new Date(Date.now() - 2.5 * 86_400_000),
  });
  for (let i = 2; i >= 1; i--) {
    await simulateDay(db, cafeScope, hamra.id, cafeCats, { date: addDays(today, -i), close: true }, 100 + i);
    await simulateDay(db, cafeScope, gemmayzeh.id, cafeCats, { date: addDays(today, -i), close: true }, 200 + i);
  }
  // Today: Hamra is open with sales and expenses entered, waiting to be counted and closed.
  await simulateDay(db, cafeScope, hamra.id, cafeCats, { date: today, close: false }, 999);
}

export async function seedDemo(db: DB) {
  const base = await db.transaction((tx) => seedBase(tx as unknown as DB));
  await seedHistory(db, base);
}

/**
 * Seeds only an empty database. The check and the first inserts happen under
 * an advisory lock, so two servers starting together can't both seed.
 */
export async function seedIfEmpty(database: Database): Promise<boolean> {
  const base = await database.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(727101)`);
    const [{ value }] = await tx.select({ value: count() }).from(organizations);
    if (value > 0) return null;
    return seedBase(tx as unknown as DB);
  });
  if (!base) return false;
  await seedHistory(database.db, base);
  return true;
}
