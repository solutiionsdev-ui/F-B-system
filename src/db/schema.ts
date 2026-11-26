// Typed view of the tables for queries. The DDL itself (constraints, foreign
// keys, row-level security, triggers) lives in ./migrations and is the source
// of truth; keep the two in step.
import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { MovementKind } from "@/lib/expense-buckets";

const money = (name: string) => bigint(name, { mode: "bigint" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type Currency = "USD" | "LBP";
export type Role = "owner" | "manager" | "accountant";
export type VenueType = "restaurant" | "cafe" | "pub" | "other";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").$type<"single" | "multi" | "enterprise">().notNull().default("single"),
  costDataVerified: boolean("cost_data_verified").notNull().default(false),
  status: text("status").$type<"active" | "suspended" | "closed">().notNull().default("active"),
  /** Superseded by the per-currency allowances below; kept for history. */
  varianceToleranceCents: money("variance_tolerance_cents").notNull().default(100n),
  /** Approved rounding allowance per currency: decides Balanced vs Flagged, never skips the explanation. */
  toleranceUsdCents: money("tolerance_usd_cents").notNull().default(0n),
  toleranceLbp: money("tolerance_lbp").notNull().default(0n),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  orgId: uuid("org_id").notNull(),
  role: text("role").$type<Role>().notNull(),
  /** Per-person overrides of the role's default permissions (lib/permissions.ts). */
  permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The venues a manager or accountant may see. Owners see every venue without rows here. */
export const membershipLocations = pgTable("membership_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  membershipId: uuid("membership_id").notNull(),
  locationId: uuid("location_id").notNull(),
  orgId: uuid("org_id").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  activeOrgId: uuid("active_org_id"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Beirut"),
  venueType: text("venue_type").$type<VenueType>().notNull().default("other"),
  /** Sales before this hour (0-11) belong to the previous business day. */
  dayCutoffHour: integer("day_cutoff_hour").notNull().default(5),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const exchangeRates = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  lbpPerUsd: numeric("lbp_per_usd", { precision: 14, scale: 4 }).notNull(),
  effectiveAt: ts("effective_at").notNull().defaultNow(),
  source: text("source").$type<"market" | "bank" | "custom">().notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const businessDays = pgTable("business_days", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  locationId: uuid("location_id").notNull(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  rateId: uuid("rate_id").notNull(),
  openingFloatUsd: money("opening_float_usd").notNull().default(0n),
  openingFloatLbp: money("opening_float_lbp").notNull().default(0n),
  openedBy: uuid("opened_by"),
  openedAt: ts("opened_at").notNull().defaultNow(),
  closedBy: uuid("closed_by"),
  closedAt: ts("closed_at"),
});

export type SalesLineType = "payment" | "refund" | "discount" | "void" | "tax" | "service_charge";
export type Tender = "cash" | "card" | "toters" | "noknok" | "other";

export const salesLines = pgTable("sales_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  locationId: uuid("location_id").notNull(),
  businessDayId: uuid("business_day_id").notNull(),
  source: text("source").$type<"manual" | "pos_import">().notNull(),
  externalRef: text("external_ref"),
  lineType: text("line_type").$type<SalesLineType>().notNull(),
  tender: text("tender").$type<Tender>(),
  currency: text("currency").$type<Currency>().notNull(),
  amountMinor: money("amount_minor").notNull(),
  importId: uuid("import_id"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
  position: integer("position").notNull().default(100),
  /** For an archived category folded into a universal one: where its expenses are reported. */
  rollsUpTo: uuid("rolls_up_to"),
});

export type PaidFrom = "drawer" | "petty_cash" | "bank" | "owner";

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  locationId: uuid("location_id").notNull(),
  businessDayId: uuid("business_day_id"),
  expenseDate: date("expense_date", { mode: "string" }).notNull(),
  categoryId: uuid("category_id").notNull(),
  /** The expense's notes; '' when none were given. */
  description: text("description").notNull(),
  vendor: text("vendor"),
  receiptRef: text("receipt_ref"),
  currency: text("currency").$type<Currency>().notNull(),
  amountMinor: money("amount_minor").notNull(),
  paidFrom: text("paid_from").$type<PaidFrom>().notNull(),
  rateId: uuid("rate_id").notNull(),
  status: text("status").$type<"active" | "voided">().notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: uuid("voided_by"),
  voidedAt: ts("voided_at"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cashMovements = pgTable("cash_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  businessDayId: uuid("business_day_id").notNull(),
  direction: text("direction").$type<"in" | "out">().notNull(),
  /** Null on rows recorded before movement types existed; see movementKindOf(). */
  kind: text("kind").$type<MovementKind>(),
  currency: text("currency").$type<Currency>().notNull(),
  amountMinor: money("amount_minor").notNull(),
  /** Optional note; '' when none was given. Required for an opening float adjustment. */
  reason: text("reason").notNull(),
  /** Who took the cash, for a partner withdrawal. */
  partnerName: text("partner_name"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cashCounts = pgTable("cash_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  businessDayId: uuid("business_day_id").notNull(),
  currency: text("currency").$type<Currency>().notNull(),
  denominations: jsonb("denominations").$type<Record<string, number>>().notNull().default({}),
  looseMinor: money("loose_minor").notNull().default(0n),
  countedMinor: money("counted_minor").notNull(),
  countedBy: uuid("counted_by"),
  countedAt: ts("counted_at").notNull().defaultNow(),
});

export type VarianceReason =
  | "counting_error"
  | "unrecorded_expense"
  | "change_shortage"
  | "rate_rounding"
  | "suspected_loss"
  | "other";

export const dayClosings = pgTable("day_closings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  businessDayId: uuid("business_day_id").notNull(),
  rateId: uuid("rate_id").notNull(),
  expectedUsd: money("expected_usd").notNull(),
  countedUsd: money("counted_usd").notNull(),
  varianceUsd: money("variance_usd").notNull(),
  expectedLbp: money("expected_lbp").notNull(),
  countedLbp: money("counted_lbp").notNull(),
  varianceLbp: money("variance_lbp").notNull(),
  varianceEquivCents: money("variance_equiv_cents").notNull(),
  withinTolerance: boolean("within_tolerance").notNull(),
  varianceReason: text("variance_reason").$type<VarianceReason>(),
  /** The written explanation; required when either currency has a difference. */
  note: text("note"),
  /** The allowances the day was judged with; null on closings from before per-currency judging. */
  toleranceUsdCents: money("tolerance_usd_cents"),
  toleranceLbp: money("tolerance_lbp"),
  /** Why a day closed with no sales recorded. */
  noSalesReason: text("no_sales_reason"),
  closedBy: uuid("closed_by"),
  closedAt: ts("closed_at").notNull().defaultNow(),
});

export const adjustments = pgTable("adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  businessDayId: uuid("business_day_id").notNull(),
  currency: text("currency").$type<Currency>().notNull(),
  amountMinor: money("amount_minor").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  orgId: uuid("org_id"),
  userId: uuid("user_id"),
  tableName: text("table_name").notNull(),
  op: text("op").notNull(),
  rowId: text("row_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  at: ts("at").notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").$type<Role>().notNull(),
  /** Venues the person is assigned when they accept. */
  locationIds: uuid("location_ids").array().notNull().default([]),
  note: text("note"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by"),
  revokedAt: ts("revoked_at"),
});

export const posProfiles = pgTable("pos_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  /** A line under the name, e.g. that a mapping is a demo one. */
  note: text("note"),
  mapping: jsonb("mapping").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const posImports = pgTable("pos_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  locationId: uuid("location_id").notNull(),
  status: text("status").$type<"draft" | "posted" | "undone">().notNull().default("draft"),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  headers: jsonb("headers").$type<string[]>().notNull(),
  rows: jsonb("rows").$type<string[][]>().notNull(),
  rowCount: integer("row_count").notNull(),
  profileId: uuid("profile_id"),
  mapping: jsonb("mapping"),
  linesImported: integer("lines_imported"),
  rowsSkipped: integer("rows_skipped"),
  daysCreated: integer("days_created"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  postedBy: uuid("posted_by"),
  postedAt: ts("posted_at"),
  undoneBy: uuid("undone_by"),
  undoneAt: ts("undone_at"),
});
