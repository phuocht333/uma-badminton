/**
 * Integration test harness — wraps better-sqlite3 in a minimal `D1Database`
 * shim so server-side functions (signed as `(d1: D1Database, …)`) can run
 * against an in-memory SQLite database in the test environment.
 *
 * Why a shim instead of `drizzle-orm/better-sqlite3` directly: production
 * server modules call `getDb(env.DB)` where `env.DB: D1Database`. Refactoring
 * every signature to accept either driver would touch ~15 files; the shim
 * keeps the production code path unchanged.
 *
 * Drizzle's d1 driver only uses `prepare().bind().all()` / `.run()` / `.first()`
 * — verified via grep across the repo. No `db.batch`, no `db.exec` from app
 * code. So the shim implements just those entry points; `exec()` and `batch()`
 * are stubbed for completeness (only `exec` is needed for running migrations
 * at setup, called against the underlying better-sqlite3 directly).
 *
 * Each call to `createTestEnv()` opens a fresh in-memory DB and applies all
 * `migrations/*.sql` in lexical order. Foreign keys are enabled. Discard the
 * env (drops out of scope) at end of test — no teardown needed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database, { type Database as Sqlite3Database } from "better-sqlite3";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "..", "migrations");

function loadMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
}

type D1Meta = {
  duration: number;
  changes: number;
  last_row_id: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
};

function buildMeta(info?: { changes: number; lastInsertRowid: number | bigint }): D1Meta {
  return {
    duration: 0,
    changes: info?.changes ?? 0,
    last_row_id: info ? Number(info.lastInsertRowid) : 0,
    size_after: 0,
    rows_read: 0,
    rows_written: info?.changes ?? 0,
  };
}

function shimD1(sqlite: Sqlite3Database): D1Database {
  const prepare = (sql: string) => {
    const stmt = sqlite.prepare(sql);
    let params: unknown[] = [];
    const wrap = {
      bind(...args: unknown[]) {
        params = args;
        return wrap;
      },
      async all<T = unknown>() {
        // better-sqlite3 marks SELECT-style statements as `reader`. Drizzle
        // calls `.all()` for INSERT…RETURNING too, which is still a reader.
        if (stmt.reader) {
          const results = stmt.all(...params) as T[];
          return { results, success: true as const, meta: buildMeta() };
        }
        const info = stmt.run(...params);
        return { results: [] as T[], success: true as const, meta: buildMeta(info) };
      },
      async first<T = unknown>(col?: string): Promise<T | null> {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (row == null) return null;
        if (col) return (row[col] ?? null) as T | null;
        return row as unknown as T;
      },
      async run() {
        const info = stmt.run(...params);
        return { results: [], success: true as const, meta: buildMeta(info) };
      },
      async raw<T = unknown[]>() {
        const rows = stmt.raw().all(...params) as unknown[][];
        return rows as T[];
      },
    };
    return wrap;
  };

  return {
    prepare(sql: string) {
      return prepare(sql) as unknown as D1PreparedStatement;
    },
    async batch(stmts: D1PreparedStatement[]) {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await (s as unknown as { all: () => Promise<unknown> }).all());
      return out as D1Result[];
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      throw new Error("dump() not implemented in test shim");
    },
  } as unknown as D1Database;
}

export interface TestEnv {
  d1: D1Database;
  db: DrizzleD1Database<typeof schema>;
  sqlite: Sqlite3Database;
}

export function createTestEnv(): TestEnv {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const sql of loadMigrations()) {
    sqlite.exec(sql);
  }
  const d1 = shimD1(sqlite);
  const db = drizzle(d1, { schema });
  return { d1, db, sqlite };
}
