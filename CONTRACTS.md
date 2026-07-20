# Ascend — Module Contracts (Year 1 Foundation) — HISTORICAL

> **⚠️ Superseded (2026-07-15).** This is the Year-1 founding contract, kept
> because code comments still cite its rules (tax engine, event shapes,
> module isolation). It is **not** the source of truth anymore:
> - **Architecture**: `docs/architecture/ARCHITECTURE.md` (as-built, kept
>   truthful). The database is **PostgreSQL** (tenant-scoped tables + RLS),
>   not SQLite as written below.
> - **Schema truth**: per-module migrations in `src/**/migrations.ts` +
>   canonical SQL in `db/migrations/`. The DDL below predates multi-tenancy —
>   real tables all carry `tenant_id`.
> - **Conventions** (pagination, versioning, errors, money, IDs):
>   `docs/architecture/DESIGN_PRINCIPLES.md`.
> - **Domain model**: `docs/architecture/ARCHITECTURE.md` (team → module
>   ownership table).
>
> Still true and enforced: module isolation (no cross-module TS imports),
> integration via shared tables + EventBus events, integer-cents money.

This is the single source of truth that every bounded-context module builds
against. Modules are isolated: they never import each other's TypeScript. They
integrate only through (1) the shared tables defined here and (2) domain
events on the in-process `EventBus`.

## Architecture

Modular monolith. `buildApp()` opens one DB, runs every module's
migrations (in registration order), then mounts each module at `/api/<name>`.

Shared kernel (do **not** modify — import only):

- `src/shared/money.ts` — `Money` helpers + `Cents` type. **All money is integer cents.**
- `src/shared/db.ts` — `openDb`, `tx(db, fn)` transaction helper, `DB` type.
- `src/shared/events.ts` — `EventBus` with `.publish(type, payload, aggregateId)`, `.on(type, h)`, `.onAny(h)`.
- `src/shared/http.ts` — `handler()`, `parseBody(schema, body)`, `HttpError`, `notFound/badRequest/conflict`, `errorMiddleware`.
- `src/shared/types.ts` — `DomainEvent`, `StateCode` (`"CA"|"NY"|"TX"|"FL"`), `Page<T>`.
- `src/modules/types.ts` — `PosModule`, `ModuleContext { db, events, router }`.

Each module exports `const <name>Module: PosModule` from `src/modules/<name>/index.ts`.

## Conventions

- IDs: `uuid` v7-ish — use `import { v7 as uuidv7 } from "uuid"`. Prefix per table (`prod_`, `ord_`, `pay_`).
- Timestamps: integer unix epoch **milliseconds** (`Date.now()`).
- Money: integer **cents** everywhere. Never floats.
- Migrations: `CREATE TABLE IF NOT EXISTS` (idempotent).
- Validation: zod schemas via `parseBody`.
- Routes are mounted at `/api/<name>`, so inside a module a route `router.get("/")` answers `GET /api/<name>/`.
- Tests: `node:test` + `node:assert/strict`, files named `*.test.ts`, each builds its own app via `buildApp(":memory:")` or tests its service against an in-memory `openDb()`.

## Shared Tables (owner in brackets)

### `products` [catalog]
```sql
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  sku          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  tax_class    TEXT NOT NULL DEFAULT 'standard', -- 'standard' | 'exempt'
  barcode      TEXT,
  status       TEXT NOT NULL DEFAULT 'active',   -- 'active'|'draft'|'archived'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```
Tax rule: items with `category = 'groceries'` are tax-exempt (`tax_class='exempt'`).

### `inventory` [inventory]
```sql
CREATE TABLE IF NOT EXISTS inventory (
  product_id  TEXT PRIMARY KEY,   -- references products.id (logical)
  stock_qty   INTEGER NOT NULL DEFAULT 0,
  reorder_pt  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  delta       INTEGER NOT NULL,   -- +receiving, -sale
  reason      TEXT NOT NULL,      -- 'receiving'|'sale'|'adjustment'|'return'
  ref         TEXT,               -- order id etc.
  created_at  INTEGER NOT NULL
);
```

### `orders` + `order_lines` [orders]
```sql
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  order_number   TEXT NOT NULL,
  state_code     TEXT NOT NULL,        -- CA|NY|TX|FL
  status         TEXT NOT NULL,        -- 'open'|'completed'|'refunded'|'voided'
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  customer_id    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  unit_cents   INTEGER NOT NULL,
  tax_cents    INTEGER NOT NULL,
  line_cents   INTEGER NOT NULL,      -- (unit*qty) - line discount
  taxable      INTEGER NOT NULL       -- 1|0
);
```

### `payments` [payments]
```sql
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  method        TEXT NOT NULL,        -- 'cash'|'card'|'split'
  amount_cents  INTEGER NOT NULL,     -- amount tendered toward order total
  cash_cents    INTEGER NOT NULL DEFAULT 0,
  card_cents    INTEGER NOT NULL DEFAULT 0,
  change_cents  INTEGER NOT NULL DEFAULT 0,
  card_last4    TEXT,
  auth_code     TEXT,                 -- EMV sim auth
  status        TEXT NOT NULL,        -- 'captured'|'declined'
  created_at    INTEGER NOT NULL
);
```

### `sync_queue` [sync]
```sql
CREATE TABLE IF NOT EXISTS sync_queue (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type        TEXT NOT NULL,
  payload           TEXT NOT NULL,    -- JSON
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'synced'|'failed'
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  last_attempted_at INTEGER
);
```

## Domain Events (type → payload)

Publish via `events.publish(type, payload, aggregateId)`.

- `product.created` → `{ id, sku, name, priceCents, category, taxClass }`
- `product.updated` → `{ id, ...changed fields }`
- `inventory.adjusted` → `{ productId, delta, reason, stockQty }`
- `order.created` → `{ id, orderNumber, stateCode, totalCents, lines: [{ productId, quantity, unitCents }] }`
- `order.refunded` → `{ id, orderNumber, totalCents }`
- `payment.captured` → `{ id, orderId, method, amountCents, changeCents }`

### Cross-module reactions (wire these in `register`)
- **Inventory** subscribes to `order.created` → for each line, decrement stock (movement reason `'sale'`, ref = order id) and `order.refunded` → restock.
- **Sync** subscribes via `events.onAny` → inserts every event into `sync_queue` as `pending` (the outbox). When "online", the push worker marks rows `synced`.

## Tax Engine (orders module owns it)
State rates (apply to taxable subtotal after discount):
`CA 8.25 · NY 8.875 · TX 6.25 · FL 6.00`. A line is taxable unless its product
`tax_class='exempt'` (groceries). Loyalty: 100 pts = $5.00 off; $1 spent = 1 pt
(optional in Year 1 — wire if time permits, behind the `customer_id`).
