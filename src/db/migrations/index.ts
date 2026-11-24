import { migration0001 } from "./0001_init";
import { migration0002 } from "./0002_security";

// Append new migrations to the end. Never edit one that has shipped.
export const migrations: { id: string; sql: string }[] = [
  { id: "0001_init", sql: migration0001 },
  { id: "0002_security", sql: migration0002 },
];
