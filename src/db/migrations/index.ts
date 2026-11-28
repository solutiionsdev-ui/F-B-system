import { migration0001 } from "./0001_init";
import { migration0002 } from "./0002_security";
import { migration0003 } from "./0003_team";
import { migration0004 } from "./0004_pos_import";
import { migration0005 } from "./0005_discard_drafts";
import { migration0006 } from "./0006_hosted_postgres";
import { migration0007 } from "./0007_expense_buckets";
import { migration0008 } from "./0008_closing_rules";
import { migration0009 } from "./0009_branches_access";
import { migration0010 } from "./0010_financial_rules";
import { migration0011 } from "./0011_recipes_food_cost";
import { migration0012 } from "./0012_day_imports";
import { migration0013 } from "./0013_cost_alert";

// Append new migrations to the end. Never edit one that has shipped.
export const migrations: { id: string; sql: string }[] = [
  { id: "0001_init", sql: migration0001 },
  { id: "0002_security", sql: migration0002 },
  { id: "0003_team", sql: migration0003 },
  { id: "0004_pos_import", sql: migration0004 },
  { id: "0005_discard_drafts", sql: migration0005 },
  { id: "0006_hosted_postgres", sql: migration0006 },
  { id: "0007_expense_buckets", sql: migration0007 },
  { id: "0008_closing_rules", sql: migration0008 },
  { id: "0009_branches_access", sql: migration0009 },
  { id: "0010_financial_rules", sql: migration0010 },
  { id: "0011_recipes_food_cost", sql: migration0011 },
  { id: "0012_day_imports", sql: migration0012 },
  { id: "0013_cost_alert", sql: migration0013 },
];
