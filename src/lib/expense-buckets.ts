// The two buckets an outgoing payment can fall into.
//
//   Bucket A, operating expenses: they reduce profit. Each one has a category,
//   a currency, how it was paid (cash drawer or bank / Whish) and optional
//   notes and a receipt number.
//
//   Bucket B, cash movements: cash changes place but profit doesn't change.
//   Safe drops and bank deposits, partner withdrawals, and cash put into the
//   drawer.
//
// Only drawer expenses and movements change the cash expected in the drawer.

/** Operating-expense categories every new organisation starts with, in the order the picker shows them. */
export const DEFAULT_CATEGORIES = [
  "Salaries & Wages",
  "Beverage & Alcohol Suppliers",
  "Food & Kitchen Suppliers",
  "Generator & Electricity",
  "Rent & Municipal Fees",
  "Cleaning",
  "Maintenance & Repairs",
  "Marketing",
  "Miscellaneous",
] as const;

/** Extra words under a category name where the name alone could be read narrowly. */
export const CATEGORY_HINTS: Record<string, string> = {
  "Salaries & Wages": "Monthly salaries and daily shift wages.",
};

/** How an expense can be paid when it's entered. Older entries may also say petty cash or owner. */
export const PAYMENT_METHODS = ["drawer", "bank"] as const;

export const PAID_FROM_LABELS: Record<string, string> = {
  drawer: "Cash drawer",
  bank: "Bank / Whish",
  petty_cash: "Petty cash",
  owner: "Owner paid",
};

export type MovementKind = "safe_drop" | "partner_withdrawal" | "top_up" | "other";

export const MOVEMENT_KINDS: readonly { kind: MovementKind; label: string; direction: "in" | "out"; hint: string }[] = [
  {
    kind: "safe_drop",
    label: "Safe drop / bank deposit",
    direction: "out",
    hint: "Cash moved from the drawer to the safe or the bank.",
  },
  {
    kind: "partner_withdrawal",
    label: "Partner withdrawal",
    direction: "out",
    hint: "A partner took cash out of the business.",
  },
  {
    kind: "top_up",
    label: "Cash added to the drawer",
    direction: "in",
    hint: "Change brought in, or cash put back.",
  },
  {
    kind: "other",
    label: "Other cash taken out",
    direction: "out",
    hint: "Anything else that left the drawer and isn't an expense.",
  },
];

export const MOVEMENT_LABELS = Object.fromEntries(MOVEMENT_KINDS.map((k) => [k.kind, k.label])) as Record<MovementKind, string>;

export function isMovementKind(v: string): v is MovementKind {
  return MOVEMENT_KINDS.some((k) => k.kind === v);
}

export function movementDirection(kind: MovementKind): "in" | "out" {
  return MOVEMENT_KINDS.find((k) => k.kind === kind)!.direction;
}

/**
 * Movements recorded before types existed only have a direction and a free-text
 * reason. Work out the type from those so old safe drops still count as safe drops.
 */
export function movementKindOf(m: { kind?: MovementKind | null; direction: "in" | "out"; reason: string }): MovementKind {
  if (m.kind) return m.kind;
  if (m.direction === "in") return "top_up";
  if (/safe|deposit|bank/i.test(m.reason)) return "safe_drop";
  if (/partner|owner|withdraw/i.test(m.reason)) return "partner_withdrawal";
  return "other";
}
