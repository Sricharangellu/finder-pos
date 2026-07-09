-- =============================================================================
-- Seed: 0001_demo
-- Wave: 0 — Platform foundation
-- Owner: DATABASE agent
--
-- Creates:
--   • 1 demo tenant  (tnt_demo_finder_01)
--   • 3 system roles (owner / manager / cashier)
--   • 1 owner user   (demo owner)
--   • 2 global feature flags (defaults off)
--   • 2 tenant feature flags
--
-- IDEMPOTENT — all inserts use ON CONFLICT DO NOTHING.
-- Safe to run multiple times (e.g., in CI or local reset).
--
-- NOTE: Seeds bypass RLS because they run as the migration/service role
-- (BYPASSRLS).  Do NOT run these as the app_user role.
--
-- Timestamps: epoch ms for 2026-06-11T00:00:00Z = 1749600000000
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Demo tenant
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, name, slug, tier, status, region, settings, created_at, updated_at)
VALUES (
    'tnt_01j0000000000000000000demo',   -- fixed ID so seeds are reproducible
    'Ascend Demo Cafe',
    'finder-demo-cafe',
    'professional',
    'active',
    'us-east-1',
    '{"currency":"USD","timezone":"America/New_York","locale":"en-US"}',
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. System roles  (tenant-scoped — replicated per-tenant in production;
--    the demo seed uses the demo tenant's UUID)
-- ---------------------------------------------------------------------------

-- owner role
INSERT INTO roles (id, tenant_id, name, permissions, is_system, created_at, updated_at)
VALUES (
    'role_01j0000000000000000owner01',
    '00000000-0000-7000-a000-000000000001',   -- demo tenant UUID (see NOTE below)
    'owner',
    '[
      "tenant:read","tenant:write",
      "user:read","user:write",
      "role:read","role:write",
      "product:read","product:write",
      "inventory:read","inventory:write",
      "order:read","order:write",
      "payment:read","payment:write",
      "report:read",
      "flag:read","flag:write",
      "audit:read"
    ]'::jsonb,
    TRUE,
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- manager role
INSERT INTO roles (id, tenant_id, name, permissions, is_system, created_at, updated_at)
VALUES (
    'role_01j0000000000000000mgr0001',
    '00000000-0000-7000-a000-000000000001',
    'manager',
    '[
      "tenant:read",
      "user:read",
      "role:read",
      "product:read","product:write",
      "inventory:read","inventory:write",
      "order:read","order:write",
      "payment:read",
      "report:read",
      "flag:read",
      "audit:read"
    ]'::jsonb,
    TRUE,
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- cashier role
INSERT INTO roles (id, tenant_id, name, permissions, is_system, created_at, updated_at)
VALUES (
    'role_01j0000000000000000cash001',
    '00000000-0000-7000-a000-000000000001',
    'cashier',
    '[
      "product:read",
      "inventory:read",
      "order:read","order:write",
      "payment:read","payment:write"
    ]'::jsonb,
    TRUE,
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Demo owner user
-- ---------------------------------------------------------------------------
INSERT INTO users (
    id, tenant_id, email, name, role_id,
    password_hash, status, created_at, updated_at
)
VALUES (
    'usr_01j0000000000000000demo001',
    '00000000-0000-7000-a000-000000000001',
    'owner@finder-demo-cafe.example',
    'Demo Owner',
    'role_01j0000000000000000owner01',
    -- bcrypt hash of 'demo1234!' (cost=12); replace in production
    '$2b$12$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'active',
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Feature flags
-- ---------------------------------------------------------------------------

-- 4a. Global flags (sentinel tenant_id = all-zeros)
INSERT INTO feature_flags (
    id, tenant_id, flag_key, enabled, rollout_pct, payload, description,
    created_at, updated_at
)
VALUES
(
    'ff_01j000000000000000global01',
    '00000000-0000-0000-0000-000000000000',
    'offline_checkout',
    FALSE,
    0,
    '{}',
    'Enable offline-first checkout with sync-on-reconnect. Off in prod until Wave 1 sync validated.',
    1749600000000,
    1749600000000
),
(
    'ff_01j000000000000000global02',
    '00000000-0000-0000-0000-000000000000',
    'loyalty_points',
    FALSE,
    0,
    '{"pointsPerDollar":1,"redeemThreshold":100,"redeemValue":500}',
    'Loyalty programme (100 pts = $5.00). Off until Wave 1 customer_id wired.',
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- 4b. Tenant-specific flags (demo tenant)
INSERT INTO feature_flags (
    id, tenant_id, flag_key, enabled, rollout_pct, payload, description,
    created_at, updated_at
)
VALUES
(
    'ff_01j000000000000000demo0001',
    '00000000-0000-7000-a000-000000000001',
    'receipt_email',
    TRUE,
    100,
    '{"provider":"sendgrid"}',
    'Email receipts enabled for demo tenant.',
    1749600000000,
    1749600000000
),
(
    'ff_01j000000000000000demo0002',
    '00000000-0000-7000-a000-000000000001',
    'split_tender',
    TRUE,
    100,
    '{}',
    'Allow cash+card split tender at checkout.',
    1749600000000,
    1749600000000
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- NOTE on demo tenant UUID
-- ─────────────────────────
-- The tenants table uses a TEXT primary key (tnt_...) but the tenant_id
-- foreign-key columns in child tables are UUID.  We use a fixed UUID
-- '00000000-0000-7000-a000-000000000001' for the demo tenant so seeds are
-- reproducible.  In production, each tenant row's UUID is derived from its
-- TEXT id via uuid_generate_v5 or passed explicitly by the provisioning API.
-- The backend must store and expose this UUID for JWT/RLS use.
--
-- Wave 1 will add a column tenants.uuid UUID UNIQUE DEFAULT gen_random_uuid()
-- and back-fill it; for now the mapping is:
--   tnt_01j0000000000000000000demo  ↔  00000000-0000-7000-a000-000000000001
-- =============================================================================
