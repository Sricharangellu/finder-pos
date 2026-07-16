# Audit — Race-free document numbering (deeper fix for review finding #4)

Date: 2026-07-13T00:47:01Z
Session: Claude session A (Opus 4.8)
Status label: **Built and verified**

## Why

Review finding #4 was patched in shipping with a retry-on-conflict, but the root
cause — deriving document numbers from `SELECT COUNT(*)` — is a repo-wide pattern
(invoices, quotations, sales orders, shipments, deposits, transfers, …) where two
concurrent creates pick the same number and collide on a UNIQUE constraint. This
adds the reusable **race-free primitive** and adopts it in the pipeline modules.

## Changes

- **NEW `src/shared/docnumber.ts`** — `nextDocNumber(db, tenantId, kind, prefix, pad)`
  allocates the next number with one atomic upsert-increment on
  `document_counters(tenant_id, kind)` and `RETURNING val`. The row lock serialises
  concurrent callers, so each gets a distinct, monotonic number (no COUNT race).
- **NEW `src/modules/sequences/`** — owns the `document_counters` table; registered
  **first** in `src/modules/index.ts` so its table exists before any seeding migration.
- **sales** — `nextNumber` now delegates to `nextDocNumber` (kinds `sales_orders`,
  `quotations`); seeding migration backfills counters from the current MAX numeric
  suffix so existing SO/QT numbering continues without collision.
- **shipping** — `nextNumber` delegates to `nextDocNumber` (kind `shipping_orders`);
  removed the retry-on-conflict loop from `persist` (the counter makes it unnecessary);
  seeding migration backfills from MAX suffix.

Fresh databases have no rows → no counter seeded → first number is `00001`
(format preserved). Existing data → counter seeded to MAX suffix → next = MAX+1.

## Verification

- PASS: `npm run typecheck`.
- PASS: `delivery-pipeline.test.ts` in isolation — **15/15** (new: "ship numbers are
  distinct and monotonic via the shared document counter" asserts SHP-00001/00002 and
  format preserved). Re-ran twice, deterministic.
- PASS: `npm run smoke` — 20/20 (invoice/SO/shipment numbering across the POS lifecycle
  unaffected).
- PASS: `node tools/hygiene-check.mjs` — 921 files.
- Full `npm test`: 396/397; the 1 failure (`re-picking a packed sales order …`) is the
  documented parallel-contention flake (all files in one process, `PG_POOL_MAX=1`) —
  **passes deterministically in isolation** (verified twice), not a regression.

## Scope note (not silently narrowed)

Adopted in **sales + shipping** (the finding's area). The other COUNT-based number
generators — billing `INV`/bills, accounting `DEP`, inventory `TRF`, customer_invoices,
service_orders, quotes — still use the old pattern. They can adopt `nextDocNumber` the
same way (swap the helper + add a MAX-suffix seeding migration) incrementally. Deferred
deliberately: this is a **deployed** product, and each adoption's production seeding
(untestable against real data here) warrants its own reviewed change rather than a
big-bang sweep.
