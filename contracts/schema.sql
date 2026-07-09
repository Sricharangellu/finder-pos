-- =============================================================================
-- contracts/schema.sql — Canonical DDL, Ascend
-- Owner:   DATABASE agent  (sole editor of this file)
-- Readers: Backend agent (codes against this), Frontend agent (type-gen)
--
-- NOTE: The backend's in-app migrations (src/shared/db.ts migration runner)
-- mirror this file.  When this file is updated, the backend must update its
-- own migration SQL in the same wave so the two stay in sync.
--
-- Change protocol (§4.3 of 00_EXECUTION_PROMPT_BOOK.md):
--   1. Database agent proposes change via ADR in db/adr/.
--   2. Orchestrator merges to main; records in contracts/CHANGELOG.md.
--   3. Contracts move forward only — additive first; breaking = new /v2.
--
-- TENANT-ID CONVENTION — RECONCILED 2026-06-12
-- ─────────────────────────────────────────────
-- The LIVE system uses tenant ids as TEXT with a 'tnt_' prefix
-- (e.g. 'tnt_demo').  tenants.id is TEXT PRIMARY KEY.
--
-- Wave 0 tables (roles, users, audit_log, feature_flags, idempotency_keys)
-- were scaffolded with tenant_id UUID.  These are documented below as-is
-- for Wave 0.  They will be reconciled to TEXT in a future Wave 0 fixup
-- migration (0001b_foundation_tenant_text.sql) or addressed at Wave 2
-- hardening.
--
-- Wave 1+ tables use tenant_id TEXT NOT NULL uniformly.
-- RLS policies for Wave 1+ tables compare TEXT = TEXT (no ::uuid cast).
--
-- Conventions (cross-cutting, must not be violated):
--   • tenant_id TEXT NOT NULL on every Wave 1+ business table.
--   • RLS REQUIRED on every tenant-scoped table (see db/rls/policies.sql).
--   • Money      → BIGINT cents.
--   • Timestamps → BIGINT epoch ms.
--   • Primary keys → TEXT uuid-v7 with table prefix.
--   • Migrations   → idempotent (CREATE TABLE IF NOT EXISTS).
--   • Indexes      → tenant-leading for every tenant-scoped table.
-- =============================================================================

-- ===========================================================================
-- WAVE 0 — Platform foundation
-- Migration: db/migrations/0001_foundation.sql
-- Published: 2026-06-11
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ---------------------------------------------------------------------------
-- tenants  [platform]
-- Root aggregate. No tenant_id on this table.
-- RLS: NOT enabled — readable by gateway to resolve tenancy.
-- Prefix: tnt_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT        PRIMARY KEY,          -- tnt_<uuidv7>
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,       -- URL-safe, e.g. "acme-cafe"
    tier        TEXT        NOT NULL DEFAULT 'starter',
                            -- 'starter' | 'professional' | 'enterprise'
    status      TEXT        NOT NULL DEFAULT 'active',
                            -- 'active' | 'suspended' | 'cancelled'
    region      TEXT        NOT NULL DEFAULT 'us-east-1',
    settings    JSONB       NOT NULL DEFAULT '{}',
    created_at  BIGINT      NOT NULL,             -- epoch ms
    updated_at  BIGINT      NOT NULL
);
-- Indexes:
--   tenants_slug_idx   ON tenants (slug)
--   tenants_status_idx ON tenants (status)

-- ---------------------------------------------------------------------------
-- roles  [identity]
-- Tenant-scoped. Canonical names: owner | manager | cashier
-- RLS: ENABLED (tenant_isolation policy in db/rls/policies.sql)
-- Prefix: role_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          TEXT        PRIMARY KEY,          -- role_<uuidv7>
    tenant_id   UUID        NOT NULL,
    name        TEXT        NOT NULL,             -- 'owner'|'manager'|'cashier'
    permissions JSONB       NOT NULL DEFAULT '[]',
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  BIGINT      NOT NULL,
    updated_at  BIGINT      NOT NULL,

    CONSTRAINT roles_tenant_name_uq UNIQUE (tenant_id, name)
);
-- Tenant-leading index:
--   roles_tenant_id_idx ON roles (tenant_id)

-- ---------------------------------------------------------------------------
-- users  [identity]
-- Tenant-scoped. One user belongs to exactly one tenant.
-- RLS: ENABLED
-- Prefix: usr_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              TEXT        PRIMARY KEY,      -- usr_<uuidv7>
    tenant_id       UUID        NOT NULL,
    email           TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    role_id         TEXT        NOT NULL REFERENCES roles(id),
    password_hash   TEXT,                         -- null = SSO-only
    status          TEXT        NOT NULL DEFAULT 'active',
                                -- 'active' | 'invited' | 'disabled'
    last_login_at   BIGINT,                       -- epoch ms, nullable
    created_at      BIGINT      NOT NULL,
    updated_at      BIGINT      NOT NULL,

    CONSTRAINT users_tenant_email_uq UNIQUE (tenant_id, email)
);
-- Tenant-leading indexes:
--   users_tenant_id_idx     ON users (tenant_id)
--   users_tenant_email_idx  ON users (tenant_id, email)
--   users_tenant_status_idx ON users (tenant_id, status)

-- ---------------------------------------------------------------------------
-- audit_log  [platform — written by every module]
-- Tenant-scoped, append-only. Written on every mutating operation.
-- Backend must write one row per mutation: (actor, action, entity, before, after)
-- RLS: ENABLED (SELECT + INSERT only; no UPDATE/DELETE for app role)
-- Prefix: aud_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT        PRIMARY KEY,      -- aud_<uuidv7>
    tenant_id       UUID        NOT NULL,
    actor_id        TEXT        NOT NULL,         -- usr_ id or 'system'
    action          TEXT        NOT NULL,         -- e.g. 'order.created'
    entity_type     TEXT        NOT NULL,         -- e.g. 'order'
    entity_id       TEXT        NOT NULL,         -- affected row id
    before_json     JSONB,                        -- null on INSERT
    after_json      JSONB,                        -- null on DELETE
    request_id      TEXT,                         -- HTTP trace correlation
    ip_address      TEXT,
    ts              BIGINT      NOT NULL          -- epoch ms
);
-- Tenant-leading indexes:
--   audit_log_tenant_ts_idx     ON audit_log (tenant_id, ts DESC)
--   audit_log_tenant_entity_idx ON audit_log (tenant_id, entity_type, entity_id)
--   audit_log_tenant_actor_idx  ON audit_log (tenant_id, actor_id, ts DESC)

-- ---------------------------------------------------------------------------
-- feature_flags  [platform]
-- Tenant-scoped + global (sentinel tenant_id = all-zeros UUID).
-- Global flags: tenant_id = '00000000-0000-0000-0000-000000000000'
-- RLS policy: tenant sees own flags AND global flags (read); writes own only.
-- RLS: ENABLED
-- Prefix: ff_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feature_flags (
    id          TEXT        PRIMARY KEY,          -- ff_<uuidv7>
    tenant_id   UUID        NOT NULL,
    flag_key    TEXT        NOT NULL,             -- e.g. 'offline_checkout'
    enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    rollout_pct SMALLINT    NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
    payload     JSONB       NOT NULL DEFAULT '{}',
    description TEXT,
    created_at  BIGINT      NOT NULL,
    updated_at  BIGINT      NOT NULL,

    CONSTRAINT feature_flags_tenant_key_uq UNIQUE (tenant_id, flag_key)
);
-- Tenant-leading indexes:
--   feature_flags_tenant_id_idx  ON feature_flags (tenant_id)
--   feature_flags_tenant_key_idx ON feature_flags (tenant_id, flag_key)

-- ---------------------------------------------------------------------------
-- idempotency_keys  [platform — used by payments module]
-- Tenant-scoped. Enables safe at-most-once payment retries.
-- Application should purge rows older than 24 hours via a background job.
-- RLS: ENABLED
-- Prefix: idk_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id              TEXT        PRIMARY KEY,      -- idk_<uuidv7>
    tenant_id       UUID        NOT NULL,
    key             TEXT        NOT NULL,         -- caller-supplied key
    request_hash    TEXT        NOT NULL,         -- SHA-256(method+path+body)
    response_json   JSONB,                        -- null while in-flight
    status          TEXT        NOT NULL DEFAULT 'processing',
                                -- 'processing' | 'completed' | 'failed'
    ts              BIGINT      NOT NULL,         -- epoch ms of first request

    CONSTRAINT idempotency_keys_tenant_key_uq UNIQUE (tenant_id, key)
);
-- Tenant-leading indexes:
--   idempotency_keys_tenant_id_idx  ON idempotency_keys (tenant_id)
--   idempotency_keys_tenant_key_idx ON idempotency_keys (tenant_id, key)
--   idempotency_keys_ts_idx         ON idempotency_keys (ts)  -- expiry sweeps

-- ===========================================================================
-- WAVE 1 — Core commerce
-- Migration: db/migrations/0002_commerce.sql
-- Published: 2026-06-12
--
-- All Wave 1 tables use tenant_id TEXT NOT NULL (tnt_<slug> convention).
-- RLS ENABLED on all tables; policies use TEXT comparison (no ::uuid cast).
-- See db/rls/policies.sql for per-table policies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- products  [catalog]
-- Prefix: prod_
-- Domain rules:
--   • category = 'groceries' → tax_class = 'exempt'  (CHECK enforced)
--   • UNIQUE (tenant_id, sku)
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id           TEXT    NOT NULL,
    tenant_id    TEXT    NOT NULL,              -- tnt_<slug>, e.g. 'tnt_demo'
    sku          TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    price_cents  BIGINT  NOT NULL,              -- cents; >= 0
    category     TEXT    NOT NULL DEFAULT 'general',
    tax_class    TEXT    NOT NULL DEFAULT 'standard',
                         -- 'standard' | 'exempt'
    barcode      TEXT,
    status       TEXT    NOT NULL DEFAULT 'active',
                         -- 'active' | 'draft' | 'archived'
    created_at   BIGINT  NOT NULL,              -- epoch ms
    updated_at   BIGINT  NOT NULL,              -- epoch ms

    CONSTRAINT products_pk PRIMARY KEY (id),
    CONSTRAINT products_tenant_sku_uq UNIQUE (tenant_id, sku),
    CONSTRAINT products_price_nonneg CHECK (price_cents >= 0),
    CONSTRAINT products_tax_class_values CHECK (tax_class IN ('standard', 'exempt')),
    CONSTRAINT products_status_values CHECK (status IN ('active', 'draft', 'archived')),
    CONSTRAINT products_grocery_exempt CHECK (
        category <> 'groceries' OR tax_class = 'exempt'
    )
);
-- Indexes:
--   products_tenant_sku_idx            ON products (tenant_id, sku)
--   products_tenant_status_created_idx ON products (tenant_id, status, created_at DESC)
--   products_tenant_category_idx       ON products (tenant_id, category)
--   products_barcode_idx               ON products (barcode) WHERE barcode IS NOT NULL

-- ---------------------------------------------------------------------------
-- inventory  [inventory]
-- PK: (tenant_id, product_id) — composite, avoids a separate surrogate key.
-- stock_qty updated in-place; full history in inventory_movements.
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    product_id   TEXT    NOT NULL,
    tenant_id    TEXT    NOT NULL,
    stock_qty    INTEGER NOT NULL DEFAULT 0,
    reorder_pt   INTEGER NOT NULL DEFAULT 0,
    updated_at   BIGINT  NOT NULL,              -- epoch ms

    CONSTRAINT inventory_pk PRIMARY KEY (tenant_id, product_id),
    CONSTRAINT inventory_stock_nonneg   CHECK (stock_qty >= 0),
    CONSTRAINT inventory_reorder_nonneg CHECK (reorder_pt >= 0)
);
-- Indexes:
--   inventory_tenant_product_idx ON inventory (tenant_id, product_id)
--   inventory_tenant_reorder_idx ON inventory (tenant_id, stock_qty)
--                                   WHERE stock_qty <= reorder_pt  [low-stock alert]

-- ---------------------------------------------------------------------------
-- inventory_movements  [inventory]
-- Append-only ledger. Never UPDATE or DELETE app-side.
-- Prefix: ivm_
-- RLS: ENABLED (SELECT + INSERT only; no UPDATE/DELETE for app role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
    id           TEXT    NOT NULL,
    tenant_id    TEXT    NOT NULL,
    product_id   TEXT    NOT NULL,
    delta        INTEGER NOT NULL,
                         -- positive: receiving/return; negative: sale/adjustment
    reason       TEXT    NOT NULL,
                         -- 'receiving' | 'sale' | 'adjustment' | 'return'
    ref          TEXT,   -- order_id for sale/return; PO ref for receiving; etc.
    created_at   BIGINT  NOT NULL,              -- epoch ms

    CONSTRAINT inventory_movements_pk PRIMARY KEY (id),
    CONSTRAINT inventory_movements_reason_values
        CHECK (reason IN ('receiving', 'sale', 'adjustment', 'return'))
);
-- Indexes:
--   ivm_tenant_product_created_idx ON inventory_movements (tenant_id, product_id, created_at DESC)
--   ivm_tenant_created_idx         ON inventory_movements (tenant_id, created_at DESC)
--   ivm_tenant_ref_idx             ON inventory_movements (tenant_id, ref) WHERE ref IS NOT NULL

-- ---------------------------------------------------------------------------
-- orders  [orders]
-- Prefix: ord_
-- Status lifecycle: open → completed → refunded | voided
-- State codes: CA | NY | TX | FL  (drives tax engine)
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id             TEXT    NOT NULL,
    tenant_id      TEXT    NOT NULL,
    order_number   TEXT    NOT NULL,
    state_code     TEXT    NOT NULL,
                           -- 'CA' | 'NY' | 'TX' | 'FL'
    status         TEXT    NOT NULL DEFAULT 'open',
                           -- 'open' | 'completed' | 'refunded' | 'voided'
    subtotal_cents BIGINT  NOT NULL,
    discount_cents BIGINT  NOT NULL DEFAULT 0,
    tax_cents      BIGINT  NOT NULL DEFAULT 0,
    total_cents    BIGINT  NOT NULL,
    customer_id    TEXT,                        -- nullable; loyalty hook (Wave 2+)
    created_at     BIGINT  NOT NULL,            -- epoch ms
    updated_at     BIGINT  NOT NULL,            -- epoch ms

    CONSTRAINT orders_pk PRIMARY KEY (id),
    CONSTRAINT orders_tenant_number_uq UNIQUE (tenant_id, order_number),
    CONSTRAINT orders_state_code_values
        CHECK (state_code IN ('CA', 'NY', 'TX', 'FL')),
    CONSTRAINT orders_status_values
        CHECK (status IN ('open', 'completed', 'refunded', 'voided')),
    CONSTRAINT orders_subtotal_nonneg CHECK (subtotal_cents >= 0),
    CONSTRAINT orders_discount_nonneg CHECK (discount_cents >= 0),
    CONSTRAINT orders_tax_nonneg      CHECK (tax_cents >= 0),
    CONSTRAINT orders_total_nonneg    CHECK (total_cents >= 0)
);
-- Indexes:
--   orders_tenant_status_created_idx ON orders (tenant_id, status, created_at DESC)
--   orders_tenant_created_idx        ON orders (tenant_id, created_at DESC)
--   orders_tenant_number_idx         ON orders (tenant_id, order_number)
--   orders_tenant_customer_idx       ON orders (tenant_id, customer_id) WHERE customer_id IS NOT NULL

-- ---------------------------------------------------------------------------
-- order_lines  [orders]
-- Prefix: oln_
-- qty and unit_price_cents are source of truth.
-- line_total_cents is stored (denormalized) for query performance.
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_lines (
    id               TEXT    NOT NULL,
    tenant_id        TEXT    NOT NULL,
    order_id         TEXT    NOT NULL,
    product_id       TEXT    NOT NULL,
    qty              INTEGER NOT NULL,
    unit_price_cents BIGINT  NOT NULL,          -- cents at time of sale (snapshot)
    line_total_cents BIGINT  NOT NULL,          -- (unit_price * qty) - line discount

    CONSTRAINT order_lines_pk PRIMARY KEY (id),
    CONSTRAINT order_lines_qty_pos      CHECK (qty > 0),
    CONSTRAINT order_lines_unit_nonneg  CHECK (unit_price_cents >= 0),
    CONSTRAINT order_lines_total_nonneg CHECK (line_total_cents >= 0)
);
-- Indexes:
--   oln_tenant_order_idx   ON order_lines (tenant_id, order_id)
--   oln_tenant_product_idx ON order_lines (tenant_id, product_id)

-- ---------------------------------------------------------------------------
-- payments  [payments]
-- Prefix: pay_
-- One row per tender action.  Split tender: method='split',
--   tendered_cents holds total cash offered, change_cents = tendered - amount.
-- Idempotency: backend checks idempotency_keys before inserting.
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id             TEXT    NOT NULL,
    tenant_id      TEXT    NOT NULL,
    order_id       TEXT    NOT NULL,
    method         TEXT    NOT NULL,
                           -- 'cash' | 'card' | 'split'
    amount_cents   BIGINT  NOT NULL,            -- total tendered toward order
    tendered_cents BIGINT  NOT NULL DEFAULT 0,  -- cash tendered (for change calc)
    change_cents   BIGINT  NOT NULL DEFAULT 0,  -- change given back
    status         TEXT    NOT NULL,
                           -- 'captured' | 'declined' | 'refunded'
    created_at     BIGINT  NOT NULL,            -- epoch ms

    CONSTRAINT payments_pk PRIMARY KEY (id),
    CONSTRAINT payments_method_values
        CHECK (method IN ('cash', 'card', 'split')),
    CONSTRAINT payments_status_values
        CHECK (status IN ('captured', 'declined', 'refunded')),
    CONSTRAINT payments_amount_nonneg   CHECK (amount_cents >= 0),
    CONSTRAINT payments_tendered_nonneg CHECK (tendered_cents >= 0),
    CONSTRAINT payments_change_nonneg   CHECK (change_cents >= 0)
);
-- Indexes:
--   payments_tenant_order_idx          ON payments (tenant_id, order_id)
--   payments_tenant_status_created_idx ON payments (tenant_id, status, created_at DESC)
--   payments_tenant_created_idx        ON payments (tenant_id, created_at DESC)

-- ---------------------------------------------------------------------------
-- sync_queue  [sync]
-- Offline outbox.  EventBus onAny handler appends every domain event here.
-- Push worker marks rows 'synced' on reconnect.
-- id is BIGSERIAL (ordering by insert sequence, no UUID needed).
-- RLS: ENABLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         TEXT    NOT NULL,
    event_type        TEXT    NOT NULL,
    payload           JSONB   NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'pending',
                              -- 'pending' | 'synced' | 'failed'
    attempts          INTEGER NOT NULL DEFAULT 0,
    created_at        BIGINT  NOT NULL,         -- epoch ms
    last_attempted_at BIGINT,                   -- epoch ms, nullable

    CONSTRAINT sync_queue_status_values
        CHECK (status IN ('pending', 'synced', 'failed')),
    CONSTRAINT sync_queue_attempts_nonneg CHECK (attempts >= 0)
);
-- Indexes:
--   sq_tenant_status_created_idx ON sync_queue (tenant_id, status, created_at ASC)
--   sq_tenant_event_type_idx     ON sync_queue (tenant_id, event_type)

-- ===========================================================================
-- END OF SCHEMA
-- ===========================================================================
