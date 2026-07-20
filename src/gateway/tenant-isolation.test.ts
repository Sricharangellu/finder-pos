import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../app.js";
import { openDb, type DB } from "../shared/db.js";
import { runWithTenant } from "../shared/tenant-context.js";

/**
 * Cross-tenant isolation regression suite (real Postgres).
 *
 * Proves both layers of tenant isolation:
 *   1. Application layer — handlers scope by the JWT tenant, so tenant B's
 *      token cannot address tenant A's rows through the API.
 *   2. RLS backstop — a query that FORGETS its WHERE tenant_id clause still
 *      returns only the context tenant's rows, because the gateway enters an
 *      AsyncLocalStorage tenant scope and shared/db.ts sets app.tenant_id on
 *      every query inside it.
 */

let __seq = 0;
const __schema = () => `rls_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const TENANT_A = "tnt_demo"; // seeded demo tenant
const TENANT_B = "tnt_isotest";

function token(tenantId: string, userId: string): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign({ sub: userId, tenantId, role: "owner" }, secret, { expiresIn: "1h" });
}

function call(
  app: App,
  method: string,
  path: string,
  tenantId: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to bind test server"));
        return;
      }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token(tenantId, `usr_${tenantId}`)}`,
            ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test("tenant isolation: API layer + RLS backstop (real Postgres)", async () => {
  const schema = __schema();
  const app = await buildApp({ schema });
  const { db } = app;

  // RLS does not apply to superusers (test harness connects as one), so the
  // backstop assertions run through a dedicated non-superuser role — the same
  // posture production requires (see db/rls/policies.sql SERVICE ACCOUNT
  // BYPASS: application roles must NOT have BYPASSRLS or superuser).
  await db.exec(
    `DO $$ BEGIN
       CREATE ROLE iso_app LOGIN PASSWORD 'iso_pw' NOSUPERUSER NOBYPASSRLS;
     EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
  await db.exec(`GRANT USAGE ON SCHEMA "${schema}" TO iso_app`);
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO iso_app`);
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = "iso_app";
  appUrl.password = "iso_pw";
  const appDb: DB = openDb({ connectionString: appUrl.toString(), schema, max: 1 });

  // Tenant A creates a product through the API.
  let r = await call(app, "POST", "/api/v1/catalog", TENANT_A, {
    sku: "ISO-001", name: "Isolation Widget", price_cents: 1500, category: "general",
  });
  assert.equal(r.status, 201);
  const productId: string = r.json.id;

  // 1. Application layer: tenant B cannot read tenant A's product by id.
  r = await call(app, "GET", `/api/v1/catalog/${productId}`, TENANT_B);
  assert.equal(r.status, 404, "cross-tenant GET by id must 404");

  // Tenant B's list view must not contain tenant A's product either.
  r = await call(app, "GET", "/api/v1/catalog?limit=200", TENANT_B);
  assert.equal(r.status, 200);
  const ids = (r.json.items ?? []).map((p: { id: string }) => p.id);
  assert.ok(!ids.includes(productId), "cross-tenant list must not leak rows");

  // 2. RLS backstop: a deliberately broken query with NO tenant WHERE clause,
  //    issued through the non-superuser role like a production app would.
  const leakySql = "SELECT id FROM products WHERE id = @id"; // forgot tenant_id!
  const inB = await runWithTenant(TENANT_B, () => appDb.query(leakySql, { id: productId }));
  assert.equal(inB.length, 0, "RLS must hide other tenants' rows from a scoped context");

  const inA = await runWithTenant(TENANT_A, () => appDb.query(leakySql, { id: productId }));
  assert.equal(inA.length, 1, "RLS must still show the owning tenant its own rows");

  // Unscoped (background/bootstrap) code keeps the permissive legacy behavior.
  const unscoped = await appDb.query(leakySql, { id: productId });
  assert.equal(unscoped.length, 1, "no context → permissive (backwards compatible)");

  // 3. Scoped INSERT for another tenant is rejected by the policy WITH CHECK.
  await assert.rejects(
    runWithTenant(TENANT_B, () =>
      appDb.query(
        `INSERT INTO products (id, tenant_id, sku, name, price_cents, created_at, updated_at)
         VALUES ('prod_iso_forged', @t, 'ISO-FORGED', 'Forged', 1, 1, 1)`,
        { t: TENANT_A },
      ),
    ),
    /row-level security|policy/i,
    "scoped context must not be able to write rows for another tenant",
  );

  // 4. Platform-global rows (tenant_id IS NULL) stay visible inside a scope.
  await db.query(
    `INSERT INTO feature_flags (id, tenant_id, flag_key, enabled, created_at, updated_at)
     VALUES ('flag_iso_global', NULL, 'iso_global_flag', TRUE, 1, 1)
     ON CONFLICT DO NOTHING`,
  );
  const flags = await runWithTenant(TENANT_B, () =>
    appDb.query("SELECT id FROM feature_flags WHERE flag_key = 'iso_global_flag'"),
  );
  assert.equal(flags.length, 1, "global (NULL-tenant) rows must stay visible in a scope");

  // 5. System rows (tenant_id = 'system') stay visible — /jobs endpoint reads them.
  await db.query(
    `INSERT INTO job_queue (id, tenant_id, type, payload, status, attempts, max_attempts, run_at, created_at)
     VALUES ('job_iso_system', 'system', 'iso.test', '{}', 'pending', 0, 1, 0, 0)
     ON CONFLICT DO NOTHING`,
  );
  const jobs = await runWithTenant(TENANT_B, () =>
    appDb.query("SELECT id FROM job_queue WHERE id = 'job_iso_system'"),
  );
  assert.equal(jobs.length, 1, "'system' rows must stay visible in a scope");

  // 6. Regression: the generic per-table RLS migration (src/modules/rls/
  //    index.ts) scans information_schema for ANY table with a tenant_id
  //    column and is registered LAST in src/modules/index.ts specifically so
  //    it covers tables created by modules built after it was written. Prove
  //    that still holds for a table that didn't exist when this test was
  //    first written — notification_alert_rules, added during the 2026-07-19
  //    Phase 0 wave — using the same leaky-query pattern as step 2.
  await db.query(
    `INSERT INTO notification_alert_rules (id, tenant_id, name, trigger, condition, channels, enabled, fires_count, created_at)
     VALUES ('rule_iso_a', @t, 'Iso Rule A', 'low_stock', 'qty < 5', '[]', true, 0, 1)`,
    { t: TENANT_A },
  );
  const leakyRuleSql = "SELECT id FROM notification_alert_rules WHERE id = 'rule_iso_a'"; // forgot tenant_id!
  const ruleInB = await runWithTenant(TENANT_B, () => appDb.query(leakyRuleSql));
  assert.equal(ruleInB.length, 0, "RLS must hide another tenant's alert rule even without a WHERE tenant_id clause");
  const ruleInA = await runWithTenant(TENANT_A, () => appDb.query(leakyRuleSql));
  assert.equal(ruleInA.length, 1, "RLS must still show the owning tenant its own alert rule");

  await appDb.close();
  await db.close();
});
