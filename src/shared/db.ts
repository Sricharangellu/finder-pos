import pg from "pg";

const { Pool, types } = pg;

// node-postgres returns BIGINT (int8, OID 20) and NUMERIC (OID 1700) as strings
// to avoid precision loss. Every bigint in this schema (cents, ms timestamps,
// sync_queue ids, COUNT(*) results) is well within Number.MAX_SAFE_INTEGER, and
// the app models them as `number`, so parse them back to numbers globally.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

/** Parameters may be positional (?) via an array, or named (@key) via an object. */
export type Params = unknown[] | Record<string, unknown> | undefined;

/**
 * Minimal async database interface backing the modular monolith. Backed by
 * Postgres (node-postgres). SQL is written with SQLite-style `?` (positional)
 * or `@name` (named) placeholders and compiled to Postgres `$n` here, so the
 * service-layer SQL stays portable.
 */
export interface PoolStats {
  /** Total connections currently open (idle + active). */
  total: number;
  /** Connections available for immediate use. */
  idle: number;
  /** Requests queued waiting for a free connection. */
  waiting: number;
}

export interface DB {
  query<T = any>(sql: string, params?: Params): Promise<T[]>;
  one<T = any>(sql: string, params?: Params): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  /**
   * Returns a DB view where every query runs inside an explicit transaction
   * with `set_config('app.tenant_id', tenantId, true)` so Postgres RLS
   * policies can use `current_setting('app.tenant_id', true)` to enforce
   * tenant isolation at the database layer. Safe with connection pools:
   * `set_config(..., true)` is transaction-local and resets at COMMIT/ROLLBACK.
   */
  withTenant(tenantId: string): DB;
  close(): Promise<void>;
  /**
   * Returns live connection pool statistics. Null when called on a
   * transaction-scoped DB (which shares the parent pool's connection).
   * Use in health checks to detect pool exhaustion.
   */
  poolStats(): PoolStats | null;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** Compile `?`/`@name` placeholders to Postgres `$n`, returning text + ordered values. */
export function compile(sql: string, params: Params): { text: string; values: unknown[] } {
  if (params === undefined) return { text: sql, values: [] };

  if (Array.isArray(params)) {
    let i = 0;
    const text = sql.replace(/\?/g, () => `$${++i}`);
    return { text, values: params };
  }

  const values: unknown[] = [];
  const slots = new Map<string, number>();
  const text = sql.replace(/@(\w+)/g, (_m, key: string) => {
    let slot = slots.get(key);
    if (slot === undefined) {
      values.push((params as Record<string, unknown>)[key]);
      slot = values.length;
      slots.set(key, slot);
    }
    return `$${slot}`;
  });
  return { text, values };
}

function makeDb(q: Queryable, opts: { isTx: boolean; pool?: pg.Pool }): DB {
  const db: DB = {
    async query<T = any>(sql: string, params?: Params): Promise<T[]> {
      const { text, values } = compile(sql, params);
      const res = await q.query(text, values);
      return res.rows as T[];
    },
    async one<T = any>(sql: string, params?: Params): Promise<T | undefined> {
      const rows = await db.query<T>(sql, params);
      return rows[0];
    },
    async exec(sql: string): Promise<void> {
      await q.query(sql);
    },
    async tx<T>(fn: (tdb: DB) => Promise<T>): Promise<T> {
      if (opts.isTx) return fn(db); // nested: outer BEGIN holds
      const pool = opts.pool!;
      const client = await pool.connect();
      const tdb = makeDb(client, { isTx: true });
      try {
        // Prevent runaway transactions from holding locks indefinitely.
        // 30 s is generous for any single business transaction; tune via PG_TX_TIMEOUT_MS.
        const txTimeoutMs = Number(process.env["PG_TX_TIMEOUT_MS"] ?? 30_000);
        await client.query(`SET LOCAL statement_timeout = ${txTimeoutMs}`);
        await client.query("BEGIN");
        const out = await fn(tdb);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    withTenant(tenantId: string): DB {
      const parent = db;
      const scoped: DB = {
        async query<T = any>(sql: string, params?: Params): Promise<T[]> {
          return parent.tx(async (tdb) => {
            await tdb.query(`SELECT set_config('app.tenant_id', ?, true)`, [tenantId]);
            return tdb.query<T>(sql, params);
          });
        },
        async one<T = any>(sql: string, params?: Params): Promise<T | undefined> {
          const rows = await scoped.query<T>(sql, params);
          return rows[0];
        },
        async exec(sql: string): Promise<void> {
          await parent.tx(async (tdb) => {
            await tdb.query(`SELECT set_config('app.tenant_id', ?, true)`, [tenantId]);
            await tdb.exec(sql);
          });
        },
        async tx<T>(fn: (tdb: DB) => Promise<T>): Promise<T> {
          return parent.tx(async (tdb) => {
            await tdb.query(`SELECT set_config('app.tenant_id', ?, true)`, [tenantId]);
            return fn(tdb);
          });
        },
        withTenant(newTenantId: string): DB {
          return parent.withTenant(newTenantId);
        },
        async close(): Promise<void> {
          // Scoped view — does not own the pool.
        },
        poolStats(): PoolStats | null {
          return parent.poolStats();
        },
      };
      return scoped;
    },
    async close(): Promise<void> {
      if (!opts.isTx && opts.pool) await opts.pool.end();
    },
    poolStats(): PoolStats | null {
      if (!opts.pool || opts.isTx) return null;
      return {
        total: opts.pool.totalCount,
        idle: opts.pool.idleCount,
        waiting: opts.pool.waitingCount,
      };
    },
  };
  return db;
}

export interface OpenDbOptions {
  connectionString?: string;
  schema?: string;
  max?: number;
}

/**
 * Open a Postgres-backed DB. Sets each connection's search_path to the requested
 * schema (created on first use) so unqualified table names and IF NOT EXISTS
 * migrations resolve within it. A unique schema gives tests full isolation
 * against one shared Postgres instance.
 */
export function openDb(options: OpenDbOptions = {}): DB {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Provide a Postgres connection string via env or openDb({ connectionString }).",
    );
  }
  const schema = options.schema ?? "public";
  const pool = new Pool({
    connectionString,
    max: options.max ?? Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    options: `-c search_path=${schema}`,
  });
  return makeDb(pool, { isTx: false, pool });
}
