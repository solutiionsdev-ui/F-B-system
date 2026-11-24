import { migration0001 } from "./0001_init";
import { migration0002 } from "./0002_security";
import { migration0003 } from "./0003_team";
import { migration0004 } from "./0004_pos_import";

// Append new migrations to the end. Never edit one that has shipped.
export const migrations: { id: string; sql: string }[] = [
  { id: "0001_init", sql: migration0001 },
  { id: "0002_security", sql: migration0002 },
  { id: "0003_team", sql: migration0003 },
  { id: "0004_pos_import", sql: migration0004 },
];
