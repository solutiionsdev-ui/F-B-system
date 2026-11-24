// Opens the database. Locally it runs PGlite (real Postgres compiled to
// WebAssembly, stored in .data/pglite) so no install is needed. In production
// set DATABASE_URL to any Postgres 15+ (Supabase, Neon, RDS...).
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { migrations } from "./migrations";
import type { Role } from "./schema";

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type Database = {
  db: DB;
  /** Runs one or more SQL statements with no parameters (migrations only). */
  exec(statements: string): Promise<void>;
  query<T>(statement: string): Promise<T[]>;
  close(): Promise<void>;
};

export async function openPglite(dataDir?: string): Promise<Database> {
  const client = new PGlite(dataDir);
  await client.waitReady;
  return {
    db: drizzlePglite(client, { schema }),
    exec: async (s) => {
      await client.exec(s);
    },
    query: async <T,>(s: string) => (await client.query<T>(s)).rows,
    close: () => client.close(),
  };
}

export async function openPostgres(url: string): Promise<Database> {
  const postgres = (await import("postgres")).default;
  // prepare: false keeps it compatible with transaction-mode poolers (Supabase, PgBouncer).
  const client = postgres(url, { prepare: false });
  return {
    db: drizzlePostgres(client, { schema }) as unknown as DB,
    exec: async (s) => {
      await client.unsafe(s);
    },
    query: async <T,>(s: string) => (await client.unsafe(s)) as unknown as T[],
    close: () => client.end(),
  };
}

export async function migrate(database: Database): Promise<string[]> {
  await database.exec(
    "create table if not exists _migrations (id text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await database.query<{ id: string }>("select id from _migrations")).map((r) => r.id));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await database.exec(`begin;\n${m.sql}\ninsert into _migrations (id) values ('${m.id}');\ncommit;`);
    applied.push(m.id);
  }
  return applied;
}

export type TenantScope = { orgId: string; userId: string; role: Role };

/**
 * Runs `fn` in a transaction scoped to one restaurant group and one role.
 * Row-level security applies to everything inside, so a query that forgets
 * to filter by org still cannot see or change another group's data.
 */
export function withTenant<T>(db: DB, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.orgId}, true),
                 set_config('app.user_id', ${scope.userId}, true),
                 set_config('app.role', ${scope.role}, true)`,
    );
    await tx.execute(sql`set local role app_user`);
    return fn(tx);
  });
}
