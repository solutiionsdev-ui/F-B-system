import { migration0001 } from "./0001_init";
import { migration0002 } from "./0002_security";
import { migration0003 } from "./0003_team";
import { migration0004 } from "./0004_pos_import";
import { migration0005 } from "./0005_discard_drafts";
import { migration0006 } from "./0006_hosted_postgres";
import { migration0007 } from "./0007_expense_buckets";

// Append new migrations to the end. Never edit one that has shipped.
export const migrations: { id: string; sql: string }[] = [
  { id: "0001_init", sql: migration0001 },
  { id: "0002_security", sql: migration0002 },
  { id: "0003_team", sql: migration0003 },
  { id: "0004_pos_import", sql: migration0004 },
  { id: "0005_discard_drafts", sql: migration0005 },
  { id: "0006_hosted_postgres", sql: migration0006 },
  { id: "0007_expense_buckets", sql: migration0007 },
];
