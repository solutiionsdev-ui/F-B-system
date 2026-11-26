// Everything the Today page shows: the greeting, headline figures, a 14-day
// health strip per location, plain-language insights, and the "Needs you"
// list (what to deal with first, each with the quickest way to deal with it).
import { and, asc, eq, isNull } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { invitations, posImports, locations } from "@/db/schema";
import { withinAllowance } from "@/lib/closing";
import { can } from "@/lib/permissions";
import { formatAmount, parseRate, type Pair } from "@/lib/money";
import type { IconName } from "@/components/icons";
import { getStatusSummary } from "./day-status";
import { getDashboard, todayIn } from "./operations";
import { getImport } from "./pos-import";
import { computePeriodReport, dailyTotals, shiftDate } from "./reports";

export type QuickAction =
  | { kind: "link"; label: string; href: string; primary?: boolean }
  | { kind: "import"; importId: string; label: string }
  | { kind: "discard"; importId: string; label: string }
  | { kind: "renew"; inviteId: string; label: string }
  | { kind: "open"; locationId: string; label: string };

export type AttentionItem = {
  key: string;
  group: "needs" | "info";
  tone: "bad" | "warn" | "accent" | "neutral" | "info";
  pill: string;
  title: string;
  detail: string;
  href: string;
  icon: IconName;
  actions: QuickAction[];
  /** Lower comes first. */
  rank: number;
};

export type HealthState = "balanced" | "short" | "over" | "open" | "none";
export type HealthTick = { date: string; state: HealthState; varianceEq: bigint | null; dayId: string | null };

export type Insight = {
  key: string;
  tone: "bad" | "good" | "accent" | "neutral";
  icon: IconName;
  lead: string;
  text: string;
  action?: { label: string; href: string };
};

const REASONS: Record<string, string> = {
  counting_error: "Counting error",
  unrecorded_expense: "Unrecorded expense",
  change_shortage: "Change given wrongly",
  rate_rounding: "Exchange-rate rounding",
  suspected_loss: "Suspected loss",
  other: "Other",
};

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const usd = (cents: bigint) => formatAmount(cents, "USD");
const abs = (v: bigint) => (v < 0n ? -v : v);

/** "$20.00 · LBP 45,000", leaving out a currency with no difference. */
function pairText(p: Pair) {
  const parts = [p.USD !== 0n ? formatAmount(abs(p.USD), "USD") : null, p.LBP !== 0n ? formatAmount(abs(p.LBP), "LBP") : null];
  return parts.filter(Boolean).join(" · ") || formatAmount(0n, "USD");
}
const anyShort = (p: Pair) => p.USD < 0n || p.LBP < 0n;

function pctChange(cur: bigint, prev: bigint): number | null {
  if (prev === 0n) return null;
  return (Number(cur - prev) / Math.abs(Number(prev))) * 100;
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Beirut" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** `locationId`: the branch picked in the sidebar, or null for every branch the person may see. */
export async function getToday(db: DB, scope: TenantScope, today = todayIn(), locationId: string | null = null) {
  const from = shiftDate(today, -13);
  const weekStart = shiftDate(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const dash = await getDashboard(db, scope, today, locationId);
  const report = await computePeriodReport(db, scope, { from, to: today, locationId });
  // Month to date, through the same status query Reports and Cash Closing use.
  const status = await getStatusSummary(db, scope, { from: monthStart, to: today, locationId });
  const days = dailyTotals(report);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const canClose = can(scope, "close_days");
  const canImport = can(scope, "import_pos");
  const canReports = can(scope, "view_reports");
  // Flagged days are reviewed by owners and accountants (spec: "owner review").
  const reviews = scope.role !== "manager";
  const tol: Pair = { USD: dash.org.toleranceUsdCents, LBP: dash.org.toleranceLbp };
  /** A closed day whose difference is still outside the allowance after corrections. */
  const unresolved = (d: (typeof report.daily)[number]) => d.varianceAfter != null && !withinAllowance(d.varianceAfter, tol);

  const extras = await withTenant(db, scope, async (tx) => {
    const drafts = canImport
      ? await tx
          .select({ id: posImports.id, fileName: posImports.fileName, rowCount: posImports.rowCount, locationName: locations.name })
          .from(posImports)
          .innerJoin(locations, eq(locations.id, posImports.locationId))
          .where(and(eq(posImports.status, "draft"), locationId ? eq(posImports.locationId, locationId) : undefined))
          .orderBy(asc(posImports.createdAt))
      : [];
    const invites =
      scope.role === "owner"
        ? await tx
            .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
            .from(invitations)
            .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        : [];
    return { drafts, invites };
  });
  // A draft can be imported straight from here only if its preview is clean.
  const draftPreviews = await Promise.all(extras.drafts.map((d) => getImport(db, scope, d.id)));

  // ---- 14-day health strip per location
  const health: Record<string, HealthTick[]> = {};
  for (const loc of dash.locations) {
    const ticks: HealthTick[] = [];
    for (let d = from; d <= today; d = shiftDate(d, 1)) {
      const row = report.daily.find((r) => r.locationId === loc.id && r.date === d);
      let state: HealthState = "none";
      if (row?.dayStatus === "closed_balanced") state = "balanced";
      else if (row?.dayStatus === "closed_flagged") state = anyShort(row.closing!.variance) ? "short" : "over";
      else if (row) state = "open";
      ticks.push({ date: d, state, varianceEq: row?.varianceAfterEq ?? null, dayId: row?.dayId ?? null });
    }
    health[loc.id] = ticks;
  }

  // ---- headline figures
  const t = byDate.get(today)!;
  const lastWeek = byDate.get(shiftDate(today, -7))!;
  const weekDays = report.daily.filter((d) => d.date >= weekStart);
  const weekClosed = weekDays.filter((d) => d.dayStatus !== "open");
  // Flagged days still waiting for an explanation or correction: what "Needs you" lists.
  const weekFlagged = weekDays.filter((d) => d.dayStatus === "closed_flagged" && unresolved(d));
  const weekDifference: Pair = { USD: 0n, LBP: 0n };
  for (const d of weekClosed) {
    weekDifference.USD += d.varianceAfter!.USD;
    weekDifference.LBP += d.varianceAfter!.LBP;
  }
  const kpis = {
    collected: { value: t.collectedEq, delta: pctChange(t.collectedEq, lastWeek.collectedEq), spark: days.map((d) => Number(d.collectedEq)) },
    expenses: { value: t.expensesEq, delta: pctChange(t.expensesEq, lastWeek.expensesEq), spark: days.map((d) => Number(d.expensesEq)) },
    difference: {
      /** After corrections, per currency: never combined into one number. */
      value: weekDifference,
      closed: weekClosed.length,
      /** Same count as Reports for the same 7 days. */
      flagged: weekDays.filter((d) => d.dayStatus === "closed_flagged").length,
    },
    compareLabel: `vs ${dayLabel(shiftDate(today, -7))}`,
  };

  // ---- insights: patterns worth a sentence, most useful first, at most two
  const insights: Insight[] = [];
  for (const loc of dash.locations) {
    const short = report.daily.filter((d) => d.locationId === loc.id && unresolved(d) && anyShort(d.varianceAfter!));
    if (short.length < 2) continue;
    const total: Pair = { USD: 0n, LBP: 0n };
    for (const d of short) {
      total.USD += d.varianceAfter!.USD < 0n ? d.varianceAfter!.USD : 0n;
      total.LBP += d.varianceAfter!.LBP < 0n ? d.varianceAfter!.LBP : 0n;
    }
    const reasons = new Map<string, number>();
    for (const d of short) if (d.closing!.reason) reasons.set(d.closing!.reason, (reasons.get(d.closing!.reason) ?? 0) + 1);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    const latest = short[short.length - 1];
    insights.push({
      key: `short-${loc.id}`,
      tone: "bad",
      icon: "alert",
      lead: `${loc.name} came up short ${short.length} times in the last 14 days.`,
      text: `${pairText(total)} missing in total${top ? `; most often "${REASONS[top[0]]}"` : ""}. Worth a word with whoever closes there.`,
      action: canReports
        ? {
            label: "See those days",
            href: `/branch?${new URLSearchParams({ location: loc.id, next: `/reports?from=${from}&to=${today}` })}`,
          }
        : { label: "Review the latest", href: `/days/${latest.dayId}` },
    });
  }
  const lastDays = report.daily.filter((d) => d.date >= weekStart);
  const prevDays = report.daily.filter((d) => d.date < weekStart);
  const comparable = prevDays.length >= Math.max(3, lastDays.length * 0.6);
  const sum = (rows: typeof report.daily, f: (d: (typeof report.daily)[number]) => bigint) => rows.reduce((s, d) => s + f(d), 0n);
  if (comparable) {
    const expLast = report.expenses.filter((e) => e.status === "active" && e.date >= weekStart).reduce((s, e) => s + e.eq, 0n);
    const expPrev = report.expenses.filter((e) => e.status === "active" && e.date < weekStart).reduce((s, e) => s + e.eq, 0n);
    const expPct = pctChange(expLast, expPrev);
    if (expPct != null && expPct >= 40 && expLast - expPrev >= 5000n) {
      const byCat = new Map<string, bigint>();
      for (const e of report.expenses) if (e.status === "active" && e.date >= weekStart) byCat.set(e.category, (byCat.get(e.category) ?? 0n) + e.eq);
      const [cat, amt] = [...byCat.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
      insights.push({
        key: "expenses",
        tone: "accent",
        icon: "cash",
        lead: `Expenses are up ${expPct.toFixed(0)}% on the week before.`,
        text: `${usd(expLast)} this week against ${usd(expPrev)}. Biggest: ${cat}, ${usd(amt)}.`,
        action: canReports ? { label: "Open reports", href: `/reports?from=${weekStart}&to=${today}` } : undefined,
      });
    }
    const salesLast = sum(lastDays, (d) => d.salesEq.collected);
    const salesPrev = sum(prevDays, (d) => d.salesEq.collected);
    const salesPct = pctChange(salesLast, salesPrev);
    if (salesPct != null && Math.abs(salesPct) >= 15) {
      insights.push({
        key: "sales",
        tone: salesPct > 0 ? "good" : "accent",
        icon: "reports",
        lead: `Sales are ${salesPct > 0 ? "up" : "down"} ${Math.abs(salesPct).toFixed(0)}% on the week before.`,
        text: `${usd(salesLast)} collected in the last 7 days against ${usd(salesPrev)}.`,
        action: canReports ? { label: "Open reports", href: `/reports?from=${weekStart}&to=${today}` } : undefined,
      });
    }
  }
  if (!insights.some((i) => i.tone === "bad") && weekClosed.length >= 5 && kpis.difference.flagged === 0) {
    insights.push({
      key: "balanced",
      tone: "good",
      icon: "check",
      lead: "Every drawer balanced this week.",
      text: `${weekClosed.length} days closed, none flagged.`,
    });
  }

  // ---- needs you
  const items: AttentionItem[] = [];
  if (!dash.rate) {
    items.push({
      key: "rate",
      group: "needs",
      tone: "bad",
      pill: "Blocking",
      title: "Set today's exchange rate",
      detail: "Business days can't be opened until a rate is set.",
      href: "/settings",
      icon: "rate",
      actions: [{ kind: "link", label: "Set the rate", href: "/settings", primary: true }],
      rank: 0,
    });
  }
  for (const d of dash.openDays) {
    const stale = d.businessDate < today;
    const age = Math.round((Date.parse(today) - Date.parse(d.businessDate)) / 86_400_000);
    items.push({
      key: `open-${d.id}`,
      group: "needs",
      tone: stale ? "bad" : "accent",
      pill: stale ? `Open ${age} day${age === 1 ? "" : "s"}` : "Waiting",
      title: stale ? `Close ${d.locationName} · ${dayLabel(d.businessDate)}` : `Count and close ${d.locationName}`,
      detail: stale
        ? "Still open from an earlier day. Its figures aren't final until it's closed."
        : "Count the drawer when service ends, then close the day.",
      href: `/days/${d.id}`,
      icon: "cash",
      actions: canClose ? [{ kind: "link", label: "Count now", href: `/days/${d.id}#count`, primary: true }] : [],
      rank: stale ? 1 : 3,
    });
  }
  if (reviews) {
    for (const d of weekFlagged) {
      const v = d.varianceAfter!;
      items.push({
        key: `flag-${d.dayId}`,
        group: "needs",
        tone: "bad",
        pill: `${anyShort(v) ? "Short" : "Over"} ${pairText(v)}`,
        title: `${d.locationName} · ${dayLabel(d.date)} didn't balance`,
        detail: `${d.closing!.reason ? REASONS[d.closing!.reason] : "No reason given"}. Post a correction on the day if it's explained.`,
        href: `/days/${d.dayId}`,
        icon: "alert",
        actions: [{ kind: "link", label: "Review day", href: `/days/${d.dayId}` }],
        rank: 2,
      });
    }
  }
  if (canClose || canImport) {
    for (const loc of dash.locations) {
      if (dash.todayByLocation[loc.id]) continue;
      items.push({
        key: `notopen-${loc.id}`,
        group: "info",
        tone: "neutral",
        pill: "Not opened",
        title: `${loc.name} hasn't opened today`,
        detail: "Open the day now, or import the POS file once service is over.",
        href: `/days/new?location=${loc.id}`,
        icon: "door",
        actions: dash.rate
          ? [
              ...(canClose ? [{ kind: "open" as const, locationId: loc.id, label: "Open today" }] : []),
              ...(canImport ? [{ kind: "link" as const, label: "Import POS file", href: "/import" }] : []),
            ]
          : [],
        rank: 5,
      });
    }
    extras.drafts.forEach((d, i) => {
      const p = draftPreviews[i]?.preview;
      const clean = p && p.setup.length === 0 && p.counts.problems === 0 && p.counts.blocked === 0 && p.counts.toImport > 0;
      items.push({
        key: `draft-${d.id}`,
        group: "info",
        tone: "accent",
        pill: "Not imported",
        title: d.fileName,
        detail: p && p.counts.toImport === 0
          ? `${d.rowCount} rows for ${d.locationName}; nothing new left to import.`
          : `${d.rowCount} rows for ${d.locationName}, uploaded but not imported yet.`,
        href: `/import/${d.id}`,
        icon: "file",
        actions: [
          ...(clean ? [{ kind: "import" as const, importId: d.id, label: `Import ${p.counts.toImport} lines` }] : []),
          { kind: "link" as const, label: "Review", href: `/import/${d.id}`, primary: !clean },
          { kind: "discard" as const, importId: d.id, label: "Discard" },
        ],
        rank: 4,
      });
    });
  }
  for (const inv of extras.invites) {
    const expired = inv.expiresAt < new Date();
    items.push({
      key: `invite-${inv.id}`,
      group: "info",
      tone: expired ? "warn" : "neutral",
      pill: expired
        ? "Link expired"
        : `Expires ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Beirut" }).format(inv.expiresAt)}`,
      title: `${inv.email} hasn't joined yet`,
      detail: expired ? "Make a new link and send it again." : "Their invitation is waiting to be opened.",
      href: "/team",
      icon: "mail",
      actions: [{ kind: "renew", inviteId: inv.id, label: "New link" }],
      rank: 6,
    });
  }
  items.sort((a, b) => a.rank - b.rank);

  const collectedToday: Record<string, bigint> = {};
  for (const d of report.daily) if (d.date === today) collectedToday[d.locationId] = d.salesEq.collected;

  return {
    today,
    dash,
    status,
    kpis,
    health,
    insights: insights.slice(0, 2),
    collectedToday,
    rate: dash.rate ? { scaled: parseRate(dash.rate.lbpPerUsd), source: dash.rate.source, at: dash.rate.effectiveAt } : null,
    needs: items.filter((i) => i.group === "needs"),
    info: items.filter((i) => i.group === "info"),
  };
}
