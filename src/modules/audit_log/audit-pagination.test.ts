/**
 * audit-pagination.test.ts — audit log keyset pagination (session D)
 *
 * First tests for the audit_log module. Pins listCursor(): stable paging on
 * the append-only audit_log table without OFFSET or the COUNT(*) scan, and
 * the offset path left intact for existing clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { AuditLogService } from "./service.js";

let __seq = 0;
const __schema = () => `auditpg_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function seedEvents(app: App, tenantId: string, n: number): Promise<void> {
  const base = Date.now();
  for (let i = 0; i < n; i++) {
    await app.db.exec(`
      INSERT INTO audit_log (id, tenant_id, actor_id, action, entity_type, entity_id, occurred_at)
      VALUES ('aud_${i}_${base}', '${tenantId}', 'usr_seed', 'thing.changed', 'thing', 'thing_${i}', ${base + i})
    `);
  }
}

test("listCursor pages the full set without duplicates or gaps", async () => {
  const app = await buildApp({ schema: __schema() });
  const svc = new AuditLogService(app.db);
  const tenantId = `ten_aud_${Date.now()}`;
  await seedEvents(app, tenantId, 5);

  const p1 = await svc.listCursor(tenantId, { limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor, "full page yields a cursor");

  const p2 = await svc.listCursor(tenantId, { limit: 2, cursor: p1.nextCursor! });
  assert.equal(p2.items.length, 2);

  const p3 = await svc.listCursor(tenantId, { limit: 2, cursor: p2.nextCursor! });
  assert.equal(p3.items.length, 1, "last page holds the remainder");
  assert.equal(p3.nextCursor, null, "short page ends the sequence");

  const ids = [...p1.items, ...p2.items, ...p3.items].map((e) => e.id);
  assert.equal(new Set(ids).size, 5, "no event duplicated or skipped");
  const times = [...p1.items, ...p2.items, ...p3.items].map((e) => e.created_at);
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest-first across pages");
});

test("listCursor respects filters and tenant scope", async () => {
  const app = await buildApp({ schema: __schema() });
  const svc = new AuditLogService(app.db);
  const tenantA = `ten_a_${Date.now()}`;
  const tenantB = `ten_b_${Date.now()}`;
  await seedEvents(app, tenantA, 3);
  await seedEvents(app, tenantB, 2);

  const a = await svc.listCursor(tenantA, { limit: 50 });
  assert.equal(a.items.length, 3, "tenant A sees only its own events");

  const filtered = await svc.listCursor(tenantA, { limit: 50, action: "nope.never" });
  assert.equal(filtered.items.length, 0, "action filter applies");
});

test("offset list() is unchanged and still returns total", async () => {
  const app = await buildApp({ schema: __schema() });
  const svc = new AuditLogService(app.db);
  const tenantId = `ten_off_${Date.now()}`;
  await seedEvents(app, tenantId, 3);

  const page = await svc.list(tenantId, { limit: 2, offset: 0 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
  assert.equal(page.offset, 0);
});
