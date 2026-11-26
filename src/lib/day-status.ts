// Business-day statuses (spec 6.3) and the counts every screen shows.
// One definition, used by Today, Cash Close, Reports and the exports, so the
// same filter always gives the same numbers (spec 15, acceptance test G).
//
// A closed day's status is frozen at closing: Balanced when each currency's
// difference was within its allowance, otherwise Flagged. Corrections posted
// later are shown beside it but never change the status. A flagged day counts
// as closed, never as open.

export type DayStatus = "open" | "closed_balanced" | "closed_flagged";

export const DAY_STATUS_LABELS: Record<DayStatus | "not_opened", string> = {
  not_opened: "Not opened",
  open: "Open",
  closed_balanced: "Closed — Balanced",
  closed_flagged: "Closed — Flagged",
};

export function dayStatusOf(day: { status: "open" | "closed" }, closing: { withinTolerance: boolean } | null | undefined): DayStatus {
  if (day.status === "open") return "open";
  return closing?.withinTolerance ? "closed_balanced" : "closed_flagged";
}

export type StatusSummary = { records: number; closed: number; balanced: number; flagged: number; open: number };

export function summarizeStatuses(statuses: DayStatus[]): StatusSummary {
  const s: StatusSummary = { records: statuses.length, closed: 0, balanced: 0, flagged: 0, open: 0 };
  for (const st of statuses) {
    if (st === "open") s.open++;
    else {
      s.closed++;
      if (st === "closed_balanced") s.balanced++;
      else s.flagged++;
    }
  }
  return s;
}
