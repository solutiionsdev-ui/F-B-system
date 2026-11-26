// Opens the database. Locally it runs PGlite (real Postgres compiled to
// WebAssembly, stored in .data/pglite) so no install is needed. In production
// set DATABASE_URL to any Postgres 15+ (Neon, Supabase, RDS...).
import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { migrations } from "./migrations";
import { memberships, type Role } from "./schema";
import { resolvePermissions, type Permission } from "@/lib/permissions";

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

type RawTx = {
  /** Runs one or more SQL statements with no parameters (migrations only). */
  exec(statements: string): Promise<void>;
  query<T>(statement: string): Promise<T[]>;
};

export type Database = RawTx & {
  db: DB;
  /** Runs raw statements inside one transaction (migrations only). */
  inTransaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** Pass an existing PGlite to run as a particular role (tests), or a data dir. */
export async function openPglite(dataDirOrClient?: string | PGlite): Promise<Database> {
  let client: PGlite;
  if (typeof dataDirOrClient === "object") client = dataDirOrClient;
  else {
    const { PGlite } = await import("@electric-sql/pglite");
    client = new PGlite(dataDirOrClient);
  }
  await client.waitReady;
  return {
    db: drizzlePglite(client, { schema }),
    exec: async (s) => {
      await client.exec(s);
    },
    query: async <T,>(s: string) => (await client.query<T>(s)).rows,
    inTransaction: (fn) =>
      client.transaction((tx) =>
        fn({
          exec: async (s) => {
            await tx.exec(s);
          },
          query: async <T,>(s: string) => (await tx.query<T>(s)).rows,
        }),
      ),
    close: () => client.close(),
  };
}

export async function openPostgres(url: string): Promise<Database> {
  const postgres = (await import("postgres")).default;
  // prepare: false keeps it compatible with transaction-mode poolers (Neon, Supabase, PgBouncer).
  // A small pool per server instance; the provider's pooler fans out.
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
  return {
    db: drizzlePostgres(client, { schema }) as unknown as DB,
    exec: async (s) => {
      await client.unsafe(s);
    },
    query: async <T,>(s: string) => (await client.unsafe(s)) as unknown as T[],
    inTransaction: <T,>(fn: (tx: RawTx) => Promise<T>) =>
      client.begin((t) =>
        fn({
          exec: async (s) => {
            await t.unsafe(s);
          },
          query: async <U,>(s: string) => (await t.unsafe(s)) as unknown as U[],
        }),
      ) as Promise<T>,
    close: () => client.end(),
  };
}

/**
 * Applies pending migrations in one transaction, holding an advisory lock so
 * two servers starting at the same moment can't both run them.
 */
export async function migrate(database: Database): Promise<string[]> {
  return database.inTransaction(async (tx) => {
    await tx.exec("select pg_advisory_xact_lock(727100)");
    await tx.exec(
      "create table if not exists _migrations (id text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await tx.query<{ id: string }>("select id from _migrations")).map((r) => r.id));
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await tx.exec(m.sql);
      await tx.exec(`insert into _migrations (id) values ('${m.id}')`);
      applied.push(m.id);
    }
    return applied;
  });
}

/**
 * Who is acting, in which business. `role` and `permissions` are what the app
 * shows and checks first; withTenant() always re-reads the membership from the
 * database and that is what the database enforces.
 */
export type TenantScope = { orgId: string; userId: string; role: Role; permissions?: Permission[] };

/** A person's scope in a business, from their membership; null if they aren't a member. */
export async function loadScope(db: DB, userId: string, orgId: string): Promise<TenantScope | null> {
  const [m] = await db
    .select({ role: memberships.role, permissions: memberships.permissions })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  if (!m) return null;
  return { orgId, userId, role: m.role, permissions: resolvePermissions(m.role, m.permissions) };
}

/**
 * Runs `fn` in a transaction scoped to one business and one person's access.
 * The membership is read again here, so the database applies the person's
 * current role, permissions and venues (row-level security), whatever the
 * caller passed. A query that forgets a filter still can't see or change
 * another business's or another venue's data.
 */
export function withTenant<T>(db: DB, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ role: memberships.role, permissions: memberships.permissions })
      .from(memberships)
      .where(and(eq(memberships.userId, scope.userId), eq(memberships.orgId, scope.orgId)));
    if (!m) throw new Error("Not a member of this business.");
    const permissions = resolvePermissions(m.role, m.permissions).join(",");
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.orgId}, true),
                 set_config('app.user_id', ${scope.userId}, true),
                 set_config('app.role', ${m.role}, true),
                 set_config('app.permissions', ${permissions}, true)`,
    );
    await tx.execute(sql`set local role app_user`);
    return fn(tx);
  });
}
