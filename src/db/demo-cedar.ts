// Demo business: Cedar Hospitality Group (fictional), from the FINCTRL spec
// section 16. Three venues, the last 12 days, one active rate of 89,700.
//
//   Gemmayzeh Bistro (restaurant), Hamra Roastery (café), Mar Mikhael Taproom (pub)
//   11 closed days per venue plus today, open, with the spec's "today" figures
//   One flagged day: Hamra Roastery two days ago, short $20 and 45,000 LBP,
//   with the spec's exact drawer figures, waiting for owner review
//   Operating expenses near 68% of collected sales (salaries near 25%), so
//   collected minus expenses lands around 30-35%, not 95%
//
// Everything is fictional and deterministic: the same date always produces the
// same figures. It is added once (by name) in a single transaction and never
// touches another business. The figures are planned here in plain numbers and
// stored as integer amounts; expected cash, counts and closings are worked out
// by the app's own closing functions, so the demo balances the way real days do.
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { computeExpected, reconcile, type ExpenseInput, type MovementInput, type SalesLineInput, type Tender } from "@/lib/closing";
import { UNIVERSAL_CATEGORIES } from "@/lib/expense-buckets";
import { convert, parseRate, type Currency, type Pair } from "@/lib/money";
import { hashPassword } from "@/lib/password";
import { zonedInstant } from "@/lib/rates";
import { todayIn } from "@/server/operations";
import { OMEGA_DEMO_MAPPING, OMEGA_FORMAT_NAME, OMEGA_FORMAT_NOTE } from "@/lib/pos-import";
import type { Database, Tx } from "./database";
import {
  businessDays,
  cashCounts,
  cashMovements,
  dayClosings,
  exchangeRates,
  expenseCategories,
  expenses,
  locations,
  membershipLocations,
  memberships,
  organizations,
  posProfiles,
  salesLines,
  users,
  type VarianceReason,
  type VenueType,
} from "./schema";
import { DEMO_PASSWORD, toNotes } from "./seed";

export const CEDAR_NAME = "Cedar Hospitality Group";
const TZ = "Asia/Beirut";
const RATE_TEXT = "89700.0000";
const RATE = parseRate("89700");
const CLOSED_DAYS = 11;

type Category = (typeof UNIVERSAL_CATEGORIES)[number];
type ExpenseSeed = {
  category: Category;
  note: string;
  vendor?: string;
  currency: Currency;
  amountMinor: bigint;
  paidFrom: "drawer" | "bank";
  time: string;
};
type MovementSeed = { kind: "safe_drop" | "partner_withdrawal"; currency: Currency; amountMinor: bigint; reason: string; partnerName?: string };
type DaySeed = {
  daysAgo: number;
  date: string;
  float: Pair;
  cashUsd: bigint;
  cashLbp: bigint;
  card: bigint;
  toters: bigint;
  noknok: bigint;
  expenses: ExpenseSeed[];
  movements: MovementSeed[];
  /** null while the day is still open. */
  close: { short: Pair; reason: VarianceReason | null; note: string | null } | null;
};

type Venue = {
  name: string;
  venueType: VenueType;
  float: Pair;
  /** Average collected per day, in dollars. */
  avg: number;
  /** Shares of collected sales; NokNok takes whatever is left. */
  mix: { cashUsd: number; cashLbp: number; card: number; toters: number };
  /** Share of collected sales spent per category over the period. */
  cost: Record<"salaries" | "food" | "beverage" | "generator" | "rent" | "packaging" | "cleaning" | "misc", number>;
  partnerWithdrawal: bigint;
  /** Fictional partner who takes the venue's one withdrawal. */
  partnerName: string;
  today: { cashUsd: bigint; cashLbp: bigint; card: bigint; toters: bigint; noknok: bigint; expense: ExpenseSeed };
  words: { wages: string; payroll: string; produce: string; food: string; beverage: string; packaging: string; repair: string };
};

/** Spec 16.1 venues, 16.6 "today" figures, and cost shares close to 16.3. */
const VENUES: Venue[] = [
  {
    name: "Gemmayzeh Bistro",
    venueType: "restaurant",
    float: { USD: 20000n, LBP: 3_000_000n },
    avg: 1850,
    mix: { cashUsd: 0.27, cashLbp: 0.03, card: 0.46, toters: 0.145 },
    cost: { salaries: 0.25, food: 0.16, beverage: 0.11, generator: 0.06, rent: 0.06, packaging: 0.015, cleaning: 0.015, misc: 0.01 },
    partnerWithdrawal: 10000n,
    partnerName: "Georges (partner)",
    today: {
      cashUsd: 35000n,
      cashLbp: 2_691_000n,
      card: 65000n,
      toters: 22000n,
      noknok: 15000n,
      expense: { category: "Salaries & Wages", note: "Daily shift wages", currency: "USD", amountMinor: 10000n, paidFrom: "drawer", time: "17:30" },
    },
    words: {
      wages: "Daily shift wages: kitchen and floor",
      payroll: "Half-month salaries: kitchen, floor and supervisor",
      produce: "Produce and bread from the market",
      food: "Meat and dairy supplier invoice",
      beverage: "Soft drinks, wine and bar supplies",
      packaging: "Takeaway boxes and delivery bags",
      repair: "Kitchen hood and fridge service",
    },
  },
  {
    name: "Hamra Roastery",
    venueType: "cafe",
    float: { USD: 15000n, LBP: 2_000_000n },
    avg: 920,
    mix: { cashUsd: 0.27, cashLbp: 0.04, card: 0.42, toters: 0.165 },
    cost: { salaries: 0.25, food: 0.09, beverage: 0.14, generator: 0.05, rent: 0.065, packaging: 0.035, cleaning: 0.02, misc: 0.015 },
    partnerWithdrawal: 15000n,
    partnerName: "Maya (partner)",
    today: {
      cashUsd: 22000n,
      cashLbp: 1_794_000n,
      card: 35000n,
      toters: 14000n,
      noknok: 7000n,
      expense: {
        category: "Beverage, Coffee & Bar Suppliers",
        note: "Coffee beans and milk",
        vendor: "Coffee roaster",
        currency: "USD",
        amountMinor: 7000n,
        paidFrom: "bank",
        time: "11:15",
      },
    },
    words: {
      wages: "Daily shift wages: baristas and floor",
      payroll: "Half-month salaries: baristas and shift supervisor",
      produce: "Pastries and fresh milk top-up",
      food: "Bakery and dairy supplier invoice",
      beverage: "Coffee beans, tea and soft drinks",
      packaging: "Takeaway cups, lids and paper bags",
      repair: "Espresso machine service",
    },
  },
  {
    name: "Mar Mikhael Taproom",
    venueType: "pub",
    float: { USD: 25000n, LBP: 1_000_000n },
    avg: 1460,
    mix: { cashUsd: 0.275, cashLbp: 0.025, card: 0.475, toters: 0.13 },
    cost: { salaries: 0.23, food: 0.07, beverage: 0.21, generator: 0.065, rent: 0.065, packaging: 0.015, cleaning: 0.02, misc: 0.015 },
    partnerWithdrawal: 20000n,
    partnerName: "Georges (partner)",
    today: {
      cashUsd: 28000n,
      cashLbp: 1_794_000n,
      card: 45000n,
      toters: 15000n,
      noknok: 10000n,
      expense: {
        category: "Beverage, Coffee & Bar Suppliers",
        note: "Bar supplies",
        currency: "USD",
        amountMinor: 8000n,
        paidFrom: "drawer",
        time: "18:00",
      },
    },
    words: {
      wages: "Daily shift wages: bar and floor",
      payroll: "Half-month salaries: bar, floor and kitchen",
      produce: "Snacks, lemons and garnish",
      food: "Kitchen and snack supplier invoice",
      beverage: "Beer kegs, spirits and wine",
      packaging: "Napkins, coasters and takeaway packs",
      repair: "Draught line cleaning and tap repair",
    },
  },
];

/** The spec's flagged day (16.7): Hamra Roastery, two days ago. */
const FLAGGED = { venue: "Hamra Roastery", daysAgo: 2 };
const FLAGGED_NOTE =
  "Cash shortages identified during the closing count. The manager reviewed the POS transactions, recorded expenses and drawer movements. The USD and LBP differences remain flagged for owner review.";

const WEEKDAY_FACTOR = [1.0, 0.82, 0.86, 0.92, 1.0, 1.2, 1.3]; // Sunday first

const dollars = (n: number) => BigInt(Math.max(0, Math.round(n))) * 100n;
const lbpOf = (usd: number, step: number) => BigInt(Math.max(0, Math.round((usd * 89_700) / step)) * step);
const floorTo = (v: bigint, step: bigint) => (v <= 0n ? 0n : (v / step) * step);
const usdOf = (currency: Currency, minor: bigint) => convert(minor, currency, "USD", RATE);

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The 12 days of one venue: what was sold, spent and moved, before any database work. */
export function planVenue(v: Venue, venueIndex: number, today: string): DaySeed[] {
  const days: DaySeed[] = [];
  for (let n = CLOSED_DAYS; n >= 1; n--) {
    const date = shift(today, -n);
    if (v.name === FLAGGED.venue && n === FLAGGED.daysAgo) {
      days.push({
        daysAgo: n,
        date,
        float: { USD: 20000n, LBP: 1_000_000n },
        cashUsd: 135000n,
        cashLbp: 3_000_000n,
        card: 60000n,
        toters: 20000n,
        noknok: 10000n,
        expenses: [
          { category: "Salaries & Wages", note: "Shift wages", currency: "USD", amountMinor: 25000n, paidFrom: "drawer", time: "22:40" },
          {
            category: "Cleaning, Maintenance & Repairs",
            note: "Repair/maintenance expense",
            currency: "LBP",
            amountMinor: 250_000n,
            paidFrom: "drawer",
            time: "15:20",
          },
        ],
        movements: [
          { kind: "safe_drop", currency: "USD", amountMinor: 10000n, reason: "Moved to the safe" },
          { kind: "safe_drop", currency: "LBP", amountMinor: 250_000n, reason: "Bank deposit" },
        ],
        close: { short: { USD: 2000n, LBP: 45_000n }, reason: "other", note: FLAGGED_NOTE },
      });
      continue;
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const jitter = (((n * 7 + venueIndex * 3) % 5) - 2) * 0.01;
    const c = v.avg * WEEKDAY_FACTOR[weekday] * (1 + jitter);
    days.push({
      daysAgo: n,
      date,
      float: v.float,
      cashUsd: dollars(c * v.mix.cashUsd),
      cashLbp: lbpOf(c * v.mix.cashLbp, 5_000),
      card: dollars(c * v.mix.card),
      toters: dollars(c * v.mix.toters),
      noknok: dollars(c * (1 - v.mix.cashUsd - v.mix.cashLbp - v.mix.card - v.mix.toters)),
      expenses: [
        { category: "Salaries & Wages", note: v.words.wages, currency: "USD", amountMinor: dollars(c * 0.05), paidFrom: "drawer", time: "23:10" },
        {
          category: "Food & Kitchen Suppliers",
          note: v.words.produce,
          currency: "LBP",
          amountMinor: lbpOf(c * 0.012, 50_000),
          paidFrom: "drawer",
          time: "10:30",
        },
      ],
      movements: [],
      close: { short: { USD: 0n, LBP: 0n }, reason: null, note: null },
    });
  }
  days.push({
    daysAgo: 0,
    date: today,
    float: v.float,
    cashUsd: v.today.cashUsd,
    cashLbp: v.today.cashLbp,
    card: v.today.card,
    toters: v.today.toters,
    noknok: v.today.noknok,
    expenses: [v.today.expense],
    movements: [],
    close: null,
  });

  // Period budgets per category, as a share of everything collected in the 12 days.
  const collected = (d: DaySeed) => d.cashUsd + d.card + d.toters + d.noknok + usdOf("LBP", d.cashLbp);
  const total = Number(days.reduce((s, d) => s + collected(d), 0n));
  const spent = (cat: Category) =>
    Number(days.flatMap((d) => d.expenses).filter((e) => e.category === cat).reduce((s, e) => s + usdOf(e.currency, e.amountMinor), 0n));
  const left = (cat: Category, share: number) => Math.max(0, total * share - spent(cat)) / 100; // dollars
  const on = (n: number) => days.find((d) => d.daysAgo === n)!;
  const add = (n: number, e: Omit<ExpenseSeed, "amountMinor">, usd: number, inLbp = false) => {
    const amountMinor = inLbp ? lbpOf(usd, 50_000) : dollars(usd);
    if (amountMinor > 0n) on(n).expenses.push({ ...e, currency: inLbp ? "LBP" : "USD", amountMinor });
  };

  const salaries = left("Salaries & Wages", v.cost.salaries);
  for (const n of [10, 3]) add(n, { category: "Salaries & Wages", note: v.words.payroll, currency: "USD", paidFrom: "bank", time: "12:00" }, salaries / 2);
  const food = left("Food & Kitchen Suppliers", v.cost.food);
  for (const n of [9, 6, 3, 1]) {
    add(n, { category: "Food & Kitchen Suppliers", note: v.words.food, vendor: "Food supplier", currency: "USD", paidFrom: "bank", time: "11:40" }, food / 4);
  }
  const beverage = left("Beverage, Coffee & Bar Suppliers", v.cost.beverage);
  for (const n of [10, 7, 4, 2]) {
    add(
      n,
      { category: "Beverage, Coffee & Bar Suppliers", note: v.words.beverage, vendor: "Beverage supplier", currency: "USD", paidFrom: "bank", time: "13:15" },
      beverage / 4,
    );
  }
  const generator = left("Generator & Electricity", v.cost.generator);
  add(8, { category: "Generator & Electricity", note: "Generator subscription", vendor: "Neighbourhood generator", currency: "USD", paidFrom: "bank", time: "10:00" }, generator * 0.65);
  add(4, { category: "Generator & Electricity", note: "EDL electricity bill", vendor: "EDL", currency: "LBP", paidFrom: "bank", time: "10:20" }, generator * 0.35, true);
  add(9, { category: "Rent & Municipal Fees", note: "Rent instalment", vendor: "Landlord", currency: "USD", paidFrom: "bank", time: "09:30" }, left("Rent & Municipal Fees", v.cost.rent));
  const packaging = left("Packaging & Delivery Supplies", v.cost.packaging);
  for (const n of [7, 1]) {
    add(n, { category: "Packaging & Delivery Supplies", note: v.words.packaging, vendor: "Packaging supplier", currency: "USD", paidFrom: "bank", time: "14:00" }, packaging / 2);
  }
  const cleaning = left("Cleaning, Maintenance & Repairs", v.cost.cleaning);
  add(5, { category: "Cleaning, Maintenance & Repairs", note: v.words.repair, currency: "USD", paidFrom: "bank", time: "15:30" }, cleaning * 0.6);
  for (const n of [8, 1]) {
    add(n, { category: "Cleaning, Maintenance & Repairs", note: "Cleaning supplies", currency: "USD", paidFrom: "drawer", time: "16:10" }, cleaning * 0.2);
  }
  const misc = left("Miscellaneous / Petty Cash", v.cost.misc);
  for (const n of [9, 6, 3]) {
    add(n, { category: "Miscellaneous / Petty Cash", note: "Petty cash: small purchases", currency: "USD", paidFrom: "drawer", time: "17:00" }, misc / 3);
  }

  // Cash leaving the drawer that isn't an expense: safe drops, deposits, one partner withdrawal.
  for (const d of days) {
    if (!d.close || (v.name === FLAGGED.venue && d.daysAgo === FLAGGED.daysAgo)) continue;
    const drawer = (cur: Currency) => d.expenses.filter((e) => e.paidFrom === "drawer" && e.currency === cur).reduce((s, e) => s + e.amountMinor, 0n);
    if (d.daysAgo === 6) {
      d.movements.push({
        kind: "partner_withdrawal",
        currency: "USD",
        amountMinor: v.partnerWithdrawal,
        reason: "Partner drawing",
        partnerName: v.partnerName,
      });
    } else {
      const available = d.float.USD + d.cashUsd - drawer("USD") - 5000n;
      const wanted = floorTo((d.cashUsd * 6n) / 10n, 5000n);
      const drop = wanted < available ? wanted : floorTo(available, 5000n);
      if (drop > 0n) d.movements.push({ kind: "safe_drop", currency: "USD", amountMinor: drop, reason: "Moved to the safe" });
    }
    if ([8, 4, 1].includes(d.daysAgo)) {
      const available = d.float.LBP + d.cashLbp - drawer("LBP") - 500_000n;
      const wanted = floorTo(d.cashLbp / 2n, 500_000n);
      const deposit = wanted < available ? wanted : floorTo(available, 500_000n);
      if (deposit > 0n) d.movements.push({ kind: "safe_drop", currency: "LBP", amountMinor: deposit, reason: "Bank deposit" });
    }
  }
  return days;
}

function drawerOf(d: DaySeed) {
  const sales: SalesLineInput[] = [
    { lineType: "payment", tender: "cash", currency: "USD", amountMinor: d.cashUsd },
    { lineType: "payment", tender: "cash", currency: "LBP", amountMinor: d.cashLbp },
    { lineType: "payment", tender: "card", currency: "USD", amountMinor: d.card },
    { lineType: "payment", tender: "toters", currency: "USD", amountMinor: d.toters },
    { lineType: "payment", tender: "noknok", currency: "USD", amountMinor: d.noknok },
  ];
  const exps: ExpenseInput[] = d.expenses.map((e) => ({ paidFrom: e.paidFrom, status: "active", currency: e.currency, amountMinor: e.amountMinor }));
  const moves: MovementInput[] = d.movements.map((m) => ({ direction: "out", currency: m.currency, amountMinor: m.amountMinor }));
  return computeExpected({ openingFloat: d.float, sales, expenses: exps, movements: moves });
}

/** The demo's saved POS format (a demo mapping, labelled as such), added once per business. */
async function ensureOmegaFormat(tx: Tx, orgId: string) {
  await tx
    .insert(posProfiles)
    .values({ orgId, name: OMEGA_FORMAT_NAME, note: OMEGA_FORMAT_NOTE, mapping: OMEGA_DEMO_MAPPING })
    .onConflictDoNothing({ target: [posProfiles.orgId, posProfiles.name] });
}

/**
 * Adds Cedar Hospitality Group if it isn't there yet. Returns true when it
 * was created. Safe to call on every start: one transaction, under a lock,
 * skipped as soon as a business with that name exists.
 */
export async function ensureCedarDemo(database: Database, today = todayIn(), now = new Date()): Promise<boolean> {
  const plans = VENUES.map((v, i) => ({ venue: v, days: planVenue(v, i, today) }));
  for (const p of plans) {
    for (const d of p.days) {
      const e = drawerOf(d).expected;
      if (e.USD < 0n || e.LBP < 0n) throw new Error(`Demo plan for ${p.venue.name} ${d.date} would leave a negative drawer.`);
    }
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const at = (date: string, time: string) => {
    const t = zonedInstant(date, time, TZ);
    return t > now ? now : t;
  };

  return database.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(727103)`);
    const [exists] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, CEDAR_NAME));
    if (exists) {
      await ensureOmegaFormat(tx, exists.id);
      return false;
    }

    // The demo's three people; reused if the demo users are already there.
    const people = [
      { email: "owner@demo.test", name: "Rana (Owner)" },
      { email: "manager@demo.test", name: "Karim (Manager)" },
      { email: "accountant@demo.test", name: "Nadine (Accountant)" },
    ];
    const found = await tx.select().from(users).where(inArray(users.email, people.map((p) => p.email)));
    const missing = people.filter((p) => !found.some((f) => f.email === p.email));
    const created = missing.length ? await tx.insert(users).values(missing.map((p) => ({ ...p, passwordHash }))).returning() : [];
    const idOf = (email: string) => [...found, ...created].find((u) => u.email === email)!.id;
    const rana = idOf("owner@demo.test");
    const karim = idOf("manager@demo.test");
    const nadine = idOf("accountant@demo.test");

    await tx.execute(sql`select set_config('app.user_id', ${rana}, true)`);
    const [org] = await tx.insert(organizations).values({ name: CEDAR_NAME, plan: "multi" }).returning();
    const ms = await tx
      .insert(memberships)
      .values([
        { userId: rana, orgId: org.id, role: "owner" as const },
        { userId: karim, orgId: org.id, role: "manager" as const },
        // The demo accountant is read-only plus additive corrections (an owner allowed it).
        { userId: nadine, orgId: org.id, role: "accountant" as const, permissions: { post_corrections: true } },
      ])
      .returning();
    const locs = await tx
      .insert(locations)
      .values(VENUES.map((v) => ({ orgId: org.id, name: v.name, venueType: v.venueType })))
      .returning();
    await tx.insert(membershipLocations).values(
      [ms[1], ms[2]].flatMap((m) => locs.map((l) => ({ membershipId: m.id, locationId: l.id, orgId: org.id, createdBy: rana }))),
    );
    const cats = await tx
      .insert(expenseCategories)
      .values(UNIVERSAL_CATEGORIES.map((name, i) => ({ orgId: org.id, name, position: i + 1 })))
      .returning();
    const catId = (name: Category) => cats.find((c) => c.name === name)!.id;
    const [rate] = await tx
      .insert(exchangeRates)
      .values({
        orgId: org.id,
        lbpPerUsd: RATE_TEXT,
        source: "market",
        note: "Market rate",
        createdBy: rana,
        effectiveAt: zonedInstant(shift(today, -30), "09:00", TZ),
      })
      .returning();

    await ensureOmegaFormat(tx, org.id);

    // The manager runs the days.
    await tx.execute(sql`select set_config('app.user_id', ${karim}, true)`);
    const dayRows: (typeof businessDays.$inferInsert)[] = [];
    const saleRows: (typeof salesLines.$inferInsert)[] = [];
    const expenseRows: (typeof expenses.$inferInsert)[] = [];
    const movementRows: (typeof cashMovements.$inferInsert)[] = [];
    const countRows: (typeof cashCounts.$inferInsert)[] = [];
    const closingRows: (typeof dayClosings.$inferInsert)[] = [];
    const closed: { id: string; closedAt: Date }[] = [];

    plans.forEach((p, i) => {
      const loc = locs[i];
      for (const d of p.days) {
        const id = randomUUID();
        dayRows.push({
          id,
          orgId: org.id,
          locationId: loc.id,
          businessDate: d.date,
          rateId: rate.id,
          openingFloatUsd: d.float.USD,
          openingFloatLbp: d.float.LBP,
          openedBy: karim,
          openedAt: at(d.date, "09:00"),
        });
        const sale = (tender: Tender, currency: Currency, amountMinor: bigint) => {
          if (amountMinor > 0n) {
            saleRows.push({
              orgId: org.id,
              locationId: loc.id,
              businessDayId: id,
              source: "manual",
              lineType: "payment",
              tender,
              currency,
              amountMinor,
              createdBy: karim,
              createdAt: at(d.date, "23:30"),
            });
          }
        };
        sale("cash", "USD", d.cashUsd);
        sale("cash", "LBP", d.cashLbp);
        sale("card", "USD", d.card);
        sale("toters", "USD", d.toters);
        sale("noknok", "USD", d.noknok);
        for (const e of d.expenses) {
          expenseRows.push({
            orgId: org.id,
            locationId: loc.id,
            businessDayId: id,
            expenseDate: d.date,
            categoryId: catId(e.category),
            description: e.note,
            vendor: e.vendor ?? null,
            currency: e.currency,
            amountMinor: e.amountMinor,
            paidFrom: e.paidFrom,
            rateId: rate.id,
            createdBy: karim,
            createdAt: at(d.date, e.time),
          });
        }
        for (const m of d.movements) {
          movementRows.push({
            orgId: org.id,
            businessDayId: id,
            kind: m.kind,
            direction: "out",
            currency: m.currency,
            amountMinor: m.amountMinor,
            reason: m.reason,
            partnerName: m.partnerName ?? null,
            createdBy: karim,
            createdAt: at(d.date, "22:15"),
          });
        }
        if (!d.close) continue;
        const expected = drawerOf(d).expected;
        const counted: Pair = { USD: expected.USD - d.close.short.USD, LBP: expected.LBP - d.close.short.LBP };
        const recon = reconcile(expected, counted, RATE, { USD: 0n, LBP: 0n });
        const countedAt = at(shift(d.date, 1), "00:40");
        for (const c of ["USD", "LBP"] as const) {
          const { notes, loose } = toNotes(counted[c], c);
          countRows.push({
            orgId: org.id,
            businessDayId: id,
            currency: c,
            denominations: notes,
            looseMinor: loose,
            countedMinor: counted[c],
            countedBy: karim,
            countedAt,
          });
        }
        const closedAt = at(shift(d.date, 1), "00:45");
        closingRows.push({
          orgId: org.id,
          businessDayId: id,
          rateId: rate.id,
          expectedUsd: expected.USD,
          countedUsd: counted.USD,
          varianceUsd: recon.variance.USD,
          expectedLbp: expected.LBP,
          countedLbp: counted.LBP,
          varianceLbp: recon.variance.LBP,
          varianceEquivCents: recon.varianceEquivCents,
          withinTolerance: recon.withinTolerance,
          varianceReason: d.close.reason,
          note: d.close.note,
          toleranceUsdCents: 0n,
          toleranceLbp: 0n,
          closedBy: karim,
          closedAt,
        });
        closed.push({ id, closedAt });
      }
    });

    await tx.insert(businessDays).values(dayRows);
    await tx.insert(salesLines).values(saleRows);
    await tx.insert(expenses).values(expenseRows);
    if (movementRows.length) await tx.insert(cashMovements).values(movementRows);
    await tx.insert(cashCounts).values(countRows);
    await tx.insert(dayClosings).values(closingRows);
    for (const c of closed) {
      await tx.update(businessDays).set({ status: "closed", closedBy: karim, closedAt: c.closedAt }).where(eq(businessDays.id, c.id));
    }
    return true;
  });
}
