// Typed view of the tables for queries. The DDL itself (constraints, foreign
// keys, row-level security, triggers) lives in ./migrations and is the source
// of truth; keep the two in step.
import {
  bigint,
  bigserial,
  boolean,
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "bigint" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type Currency = "USD" | "LBP";
export type Role = "owner" | "manager" | "accountant";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").$type<"single" | "multi" | "enterprise">().notNull().default("single"),
  costDataVerified: boolean("cost_data_verified").notNull().default(false),
  varianceToleranceCents: money("variance_tolerance_cents").notNull().default(100n),
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
export type Tender = "cash" | "card" | "other";

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
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
});

export type PaidFrom = "drawer" | "petty_cash" | "bank" | "owner";

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  locationId: uuid("location_id").notNull(),
  businessDayId: uuid("business_day_id"),
  expenseDate: date("expense_date", { mode: "string" }).notNull(),
  categoryId: uuid("category_id").notNull(),
  description: text("description").notNull(),
  vendor: text("vendor"),
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
  currency: text("currency").$type<Currency>().notNull(),
  amountMinor: money("amount_minor").notNull(),
  reason: text("reason").notNull(),
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
  note: text("note"),
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
