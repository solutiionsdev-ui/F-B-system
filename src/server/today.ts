// Everything the Today page shows: the greeting, headline figures, and the
// "Needs you" list (what to deal with first, by severity).
import { and, asc, eq, isNull } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { invitations, posImports, locations } from "@/db/schema";
import { formatAmount, parseRate } from "@/lib/money";
import type { IconName } from "@/components/icons";
import { getDashboard, todayIn } from "./operations";
import { computePeriodReport, dailyTotals, shiftDate } from "./reports";

export type AttentionItem = {
  key: string;
  group: "needs" | "info";
  tone: "bad" | "warn" | "accent" | "neutral" | "info";
  pill: string;
  title: string;
  detail: string;
  href: string;
  icon: IconName;
  /** Lower comes first. */
  rank: number;
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

function pctChange(cur: bigint, prev: bigint): number | null {
  if (prev === 0n) return null;
  return (Number(cur - prev) / Math.abs(Number(prev))) * 100;
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Beirut" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export async function getToday(db: DB, scope: TenantScope) {
  const today = todayIn();
  const dash = await getDashboard(db, scope, today);
  const report = await computePeriodReport(db, scope, { from: shiftDate(today, -13), to: today });
  const days = dailyTotals(report);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const ops = scope.role === "owner" || scope.role === "manager";
  const books = scope.role === "owner" || scope.role === "accountant";

  const extras = await withTenant(db, scope, async (tx) => {
    const drafts = ops
      ? await tx
          .select({ id: posImports.id, fileName: posImports.fileName, rowCount: posImports.rowCount, locationName: locations.name })
          .from(posImports)
          .innerJoin(locations, eq(locations.id, posImports.locationId))
          .where(eq(posImports.status, "draft"))
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

  // ---- headline figures
  const t = byDate.get(today)!;
  const lastWeek = byDate.get(shiftDate(today, -7))!;
  const week = days.filter((d) => d.date > shiftDate(today, -7));
  const weekClosed = week.reduce((n, d) => n + d.closed, 0);
  const weekFlagged = report.daily.filter(
    (d) =>
      d.date > shiftDate(today, -7) &&
      d.closing &&
      !d.closing.withinTolerance &&
      (d.varianceAfterEq ?? 0n) !== 0n &&
      (d.varianceAfterEq! < 0n ? -d.varianceAfterEq! : d.varianceAfterEq!) > dash.org.varianceToleranceCents,
  );
  const kpis = {
    collected: {
      value: t.collectedEq,
      delta: pctChange(t.collectedEq, lastWeek.collectedEq),
      spark: days.map((d) => Number(d.collectedEq)),
    },
    expenses: {
      value: t.expensesEq,
      delta: pctChange(t.expensesEq, lastWeek.expensesEq),
      spark: days.map((d) => Number(d.expensesEq)),
    },
    difference: {
      value: week.reduce((s, d) => s + d.varianceAfterEq, 0n),
      closed: weekClosed,
      flagged: weekFlagged.length,
    },
    compareLabel: `vs ${dayLabel(shiftDate(today, -7))}`,
  };

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
      href: "/rates",
      icon: "rate",
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
      rank: stale ? 1 : 3,
    });
  }
  if (books) {
    for (const d of weekFlagged) {
      const v = d.varianceAfterEq!;
      items.push({
        key: `flag-${d.dayId}`,
        group: "needs",
        tone: "bad",
        pill: `${v < 0n ? "Short" : "Over"} ${formatAmount(v < 0n ? -v : v, "USD")}`,
        title: `${d.locationName} · ${dayLabel(d.date)} didn't balance`,
        detail: `${d.closing!.reason ? REASONS[d.closing!.reason] : "No reason given"}. Post a correction on the day if it's explained.`,
        href: `/days/${d.dayId}`,
        icon: "alert",
        rank: 2,
      });
    }
  }
  if (ops) {
    for (const loc of dash.locations) {
      if (dash.todayByLocation[loc.id]) continue;
      items.push({
        key: `notopen-${loc.id}`,
        group: "info",
        tone: "neutral",
        pill: "Not opened",
        title: `${loc.name} hasn't opened today`,
        detail: "Open the day, or import the POS file once service is over.",
        href: `/days/new?location=${loc.id}`,
        icon: "door",
        rank: 5,
      });
    }
    for (const d of extras.drafts) {
      items.push({
        key: `draft-${d.id}`,
        group: "info",
        tone: "accent",
        pill: "Not imported",
        title: d.fileName,
        detail: `${d.rowCount} rows for ${d.locationName}, uploaded but not imported yet.`,
        href: `/import/${d.id}`,
        icon: "file",
        rank: 4,
      });
    }
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
      detail: expired ? "Send them a new link from the Team page." : "Their invitation is waiting to be opened.",
      href: "/team",
      icon: "mail",
      rank: 6,
    });
  }
  items.sort((a, b) => a.rank - b.rank);

  const collectedToday: Record<string, bigint> = {};
  for (const d of report.daily) if (d.date === today) collectedToday[d.locationId] = d.salesEq.collected;

  return {
    today,
    dash,
    kpis,
    collectedToday,
    rate: dash.rate ? { scaled: parseRate(dash.rate.lbpPerUsd), source: dash.rate.source, at: dash.rate.effectiveAt } : null,
    needs: items.filter((i) => i.group === "needs"),
    info: items.filter((i) => i.group === "info"),
  };
}
