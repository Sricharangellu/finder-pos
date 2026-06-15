# Database Review — Finder ERP

Dedicated schema review across all 19 modules (45 tables). Date: 2026-06-13. Reviewer: backend agent.

## Scope & method
Read every module's DDL (`CREATE TABLE` / index / constraint) and cross-checked it against the
service query patterns (WHERE/ORDER BY/JOIN columns) to find missing indexes, integrity gaps, and
tenant-scoping holes.

## Findings & actions

### 1. Tenant scoping — PASS
Every table carries `tenant_id`, and every service query filters on it (`WHERE tenant_id = @t`).
No query was found that reads across tenants. Cross-tenant isolation is enforced at the application
layer by the gateway (`tenantResolver` populates `res.locals.auth.tenantId`, services thread it into
every statement). No leaks found.

### 2. Missing hot-path indexes — FIXED
Added four `(tenant_id, <fk>)` indexes that back frequent lookups previously doing tenant-wide scans:
- `invoices (tenant_id, customer_id)` — customer financials, ecommerce portal, AR aging.
- `bills (tenant_id, supplier_id)` — vendor detail, AP aging.
- `orders (tenant_id, customer_id)` — customer summary, sales-by-customer.
- `sales_orders (tenant_id, customer_id)` — ecommerce portal, customer order history.
All `CREATE INDEX IF NOT EXISTS` (idempotent, additive, zero-downtime).

### 3. Primary keys / uniqueness — PASS (good coverage)
Natural uniqueness is enforced where it matters: `UNIQUE (tenant_id, sku)`, `(tenant_id, order_number)`,
`(tenant_id, so_number)`, `(tenant_id, quote_number)`, `(tenant_id, code)` on accounts/locations,
partial unique on `discounts (tenant_id, coupon_code)`, `bills (tenant_id, po_id)`,
`sales_orders (tenant_id, quotation_id)`, and `shipping_orders (tenant_id, invoice_id)` (idempotent
generation). Composite PKs on link/lookup tables (`inventory`, `product_costs`, `product_locations`,
`product_tier_prices`, `settings_kv`, `batch_deposit_items` via id).

### 4. Foreign keys — INTENTIONALLY ABSENT (documented)
There are no cross-table SQL FKs. This is a deliberate modular-monolith choice: each module owns its
tables and migrates independently, and referential integrity is enforced in the service layer (existence
checks before insert, e.g. `createDeposit` validates the account and every payment id). Adding hard FKs
would couple migration ordering across modules and is **not** recommended while the module boundary is
the unit of ownership. Revisit only if modules are ever split into separate databases (then FKs are moot).

### 5. Money & time types — PASS
All money is `BIGINT` integer cents; all timestamps are `BIGINT` epoch-ms. No floating point or
`NUMERIC` drift. Consistent across every table.

### 6. Row-Level Security — RECOMMENDATION (defense-in-depth)
Tenant isolation today is app-layer only. The canonical `db/migrations` set established RLS scaffolding
at Wave 0. Recommendation: enable Postgres RLS (`tenant_id = current_setting('app.tenant')`) on the
transactional tables as a second line of defense so a future query that forgets the `tenant_id` clause
cannot leak. Not blocking — app-layer coverage is currently complete — but the highest-value hardening.

### 7. Migration model — PASS with a note
Migrations are idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`) and
self-healing (`dropLegacyNoTenant`). This is robust for the current single-process deploy. Note for
scale: a forward-only versioned migration ledger would make rollbacks and auditing cleaner than the
"converge on boot" approach, but the current model is correct and safe.

## Net result
4 indexes added; 0 isolation defects; schema types and uniqueness solid. Top future hardening: DB-level RLS.
