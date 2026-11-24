import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate, openPglite, openPostgres, type Database } from "@/db/database";
import { seedIfEmpty } from "@/db/seed";

const g = globalThis as unknown as { __fnbDatabase?: Promise<Database> };

/** The hosted database: DATABASE_URL, or the names Vercel's Neon/Supabase integrations set. */
function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || null;
}

async function init(): Promise<Database> {
  let database: Database;
  const url = databaseUrl();
  if (url) {
    database = await openPostgres(url);
  } else if (process.env.VERCEL) {
    // Vercel's filesystem isn't kept between requests, so the local database can't work there.
    throw new Error("No database configured. Connect a Postgres database (Neon or Supabase) to this Vercel project so DATABASE_URL is set.");
  } else {
    const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
    mkdirSync(dir, { recursive: true });
    database = await openPglite(dir);
  }
  const applied = await migrate(database);
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(", ")}`);
  if (process.env.SEED_DEMO !== "false" && (await seedIfEmpty(database))) {
    console.log("[db] seeded demo data (logins in README.md)");
  }
  return database;
}

/** One shared connection per server process (survives dev hot reloads). */
export async function getDb() {
  g.__fnbDatabase ??= init().catch((e) => {
    g.__fnbDatabase = undefined;
    throw e;
  });
  return (await g.__fnbDatabase).db;
}
