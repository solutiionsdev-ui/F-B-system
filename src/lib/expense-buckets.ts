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

/**
 * The eight universal hospitality categories from the FINCTRL spec (9.2), the
 * same for restaurants, cafés and pubs, in the order the picker shows them.
 * Every business uses this one list.
 */
export const UNIVERSAL_CATEGORIES = [
  "Salaries & Wages",
  "Food & Kitchen Suppliers",
  "Beverage, Coffee & Bar Suppliers",
  "Generator & Electricity",
  "Rent & Municipal Fees",
  "Packaging & Delivery Supplies",
  "Cleaning, Maintenance & Repairs",
  "Miscellaneous / Petty Cash",
] as const;

/** What every new business starts with. */
export const DEFAULT_CATEGORIES = UNIVERSAL_CATEGORIES;

/** Extra words under a category name where the name alone could be read narrowly. */
export const CATEGORY_HINTS: Record<string, string> = {
  "Salaries & Wages": "Monthly salaries and daily shift wages.",
  "Food & Kitchen Suppliers": "Produce, meat, bakery, dairy, ingredients and kitchen supplies.",
  "Beverage, Coffee & Bar Suppliers": "Coffee beans, tea, soft drinks, spirits, wine, beer and bar supplies.",
  "Generator & Electricity": "EDL, generator subscription and generator fuel.",
  "Rent & Municipal Fees": "Rent, municipality fees and other premises charges.",
  "Packaging & Delivery Supplies": "Takeaway boxes, cups, bags, napkins and delivery packaging.",
  "Cleaning, Maintenance & Repairs": "Cleaning, equipment maintenance and repairs.",
  "Miscellaneous / Petty Cash": "Other documented operating costs and small petty-cash expenses.",
};

/** How an expense can be paid when it's entered. Older entries may also say petty cash or owner. */
export const PAYMENT_METHODS = ["drawer", "bank"] as const;

export const PAID_FROM_LABELS: Record<string, string> = {
  drawer: "Cash drawer",
  bank: "Bank / Whish",
  petty_cash: "Petty cash",
  owner: "Owner paid",
};

export type MovementKind = "safe_drop" | "partner_withdrawal" | "float_adjustment" | "top_up" | "other";

/**
 * Cash movements (bucket B). The spec's three types are offered for new
 * entries. "Cash added" and "Other cash taken out" exist only on older
 * entries: change brought in is now an opening float adjustment.
 * A float adjustment has no fixed direction: it adds to or reduces the float.
 */
export const MOVEMENT_KINDS: readonly {
  kind: MovementKind;
  label: string;
  direction: "in" | "out" | "either";
  hint: string;
  offered: boolean;
}[] = [
  {
    kind: "safe_drop",
    label: "Safe drop / bank deposit",
    direction: "out",
    hint: "Cash moved from the drawer to the safe or the bank.",
    offered: true,
  },
  {
    kind: "partner_withdrawal",
    label: "Partner withdrawal",
    direction: "out",
    hint: "A partner took cash out of the business.",
    offered: true,
  },
  {
    kind: "float_adjustment",
    label: "Opening float adjustment",
    direction: "either",
    hint: "Corrects the cash the drawer started with. The original float is kept.",
    offered: true,
  },
  {
    kind: "top_up",
    label: "Cash added to the drawer",
    direction: "in",
    hint: "Change brought in, or cash put back.",
    offered: false,
  },
  {
    kind: "other",
    label: "Other cash taken out",
    direction: "out",
    hint: "Anything else that left the drawer and isn't an expense.",
    offered: false,
  },
];

/** The types offered when a movement is recorded. */
export const OFFERED_MOVEMENT_KINDS = MOVEMENT_KINDS.filter((k) => k.offered);

export const MOVEMENT_LABELS = Object.fromEntries(MOVEMENT_KINDS.map((k) => [k.kind, k.label])) as Record<MovementKind, string>;

export function isMovementKind(v: string): v is MovementKind {
  return MOVEMENT_KINDS.some((k) => k.kind === v);
}

/** The direction a type always has, or null when the entry decides (a float adjustment). */
export function movementDirection(kind: MovementKind): "in" | "out" | null {
  const d = MOVEMENT_KINDS.find((k) => k.kind === kind)!.direction;
  return d === "either" ? null : d;
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
