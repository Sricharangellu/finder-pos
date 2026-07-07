# Work Package 01: Business Units, Channels, And Capabilities

## Status

**Foundation shipped** in PR #36 (issue #35): the `business` module exists with
`business_units`, `business_unit_locations`, `business_unit_channels`,
`tenant_capabilities`, `user_business_unit_access`; `GET /api/v1/me/context`;
business-unit list/create/get; and a demo retail + wholesale seed. This package
now tracks the **remaining** work (marked ☐ below): capability read/write
endpoints, PATCH + active-unit switching, `module_visibility`, and richer
capability config. Do not recreate the shipped tables/routes.

## Goal

Let one tenant operate retail, wholesale, ecommerce, warehouse, and mixed
business models on a shared tenant database, separated by `tenant_id`,
`business_unit_id`, `channel`, permissions, and feature capabilities. Separate
databases are only for explicitly configured enterprise isolation — not the
default.

## Core concepts

- `tenant` — the company account.
- `business_unit` — retail, wholesale, ecommerce, warehouse, or mixed division.
- `channel` — transaction source: `retail_pos`, `wholesale_b2b`, `ecommerce`, `manual_invoice`, `warehouse_transfer`.
- `capability` — feature access: POS checkout, quotes, invoices, AR credit, loyalty, warehouse picking, age verification.
- `user_business_unit_access` — which users reach which business units.
- `module_visibility` — which modules render per user and business unit.

## User feature separation

- Retail users see POS, register, retail orders, retail customers, store inventory, retail reports.
- Wholesale users see quotes, sales orders, warehouse picking, invoices, AR, customer accounts, wholesale reports.
- Admin/owner users switch business units and configure shared-platform modules.

## Database changes

Every table includes `tenant_id`, timestamps, status where relevant, indexes, and unique constraints.

```sql
-- SHIPPED (PR #36): business_units, business_unit_channels,
-- business_unit_locations, tenant_capabilities, user_business_unit_access.
-- Live DDL is in src/modules/business/index.ts.

-- ☐ REMAINING — per-user/BU module visibility.
module_visibility (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  user_id          TEXT,               -- NULL = applies to the whole unit
  module_key       TEXT NOT NULL,
  visible          BOOLEAN NOT NULL DEFAULT true,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL,
  UNIQUE (tenant_id, business_unit_id, user_id, module_key)
);
```

Note: shipped `tenant_capabilities` uses `(capability, enabled)`. The capability
endpoints below should evolve it toward `module_key` + `feature_key` +
`config_json` (see WP 12 for how the shell consumes visibility).

## Current repo files affected

- `src/modules/business/{index,service,routes,business.test}.ts` — extend (do not recreate).
- `src/modules/index.ts` — already registered.
- `src/gateway/auth.ts` — later, for `requireBusinessUnitAccess` / `requireCapability` (WP 02).
- `web/contexts/CapabilitiesContext.tsx`, `web/components/EnterpriseShell.tsx` — consumers (WP 12).

## Backend endpoints

```txt
GET    /api/v1/business-units            # shipped
POST   /api/v1/business-units            # shipped (owner)
GET    /api/v1/business-units/:id        # shipped (access-checked)
GET    /api/v1/me/context                # shipped
PATCH  /api/v1/business-units/:id        # ☐ update name/kind/status/route
GET    /api/v1/capabilities              # ☐ tenant + BU capability matrix
PUT    /api/v1/capabilities/:id          # ☐ toggle/configure a capability
POST   /api/v1/me/switch-business-unit   # ☐ set caller's active unit (persist pref)
```

`/me/context` returns visible modules, permissions, active business unit,
channels, landing route, and feature flags.

## Frontend screens

- Business-unit switcher in the shell header.
- Navigation rendered from `/me/context` (retail / wholesale / admin variants).
- Unavailable modules hidden completely — never rendered-then-disabled.
- Capability admin surface (owner) to toggle module/feature capabilities per unit.

## Tests required

- Retail-only user cannot access a wholesale business unit (shipped: context scoping).
- Wholesale-only user cannot access a retail business unit (shipped).
- Owner can switch between business units (☐ switch endpoint).
- Capability response matches enabled modules (☐).
- All queries scoped by `tenant_id` (shipped: tenant isolation test).

## Acceptance criteria

- A tenant can have one or more business units, each with one or more channels.
- `/me/context` is the single source of truth for frontend navigation.
- Retail-only users cannot access wholesale APIs; wholesale-only cannot access retail POS APIs.
- Owner/admin can switch business units.
- Transaction tables carry `business_unit_id` and `channel` (WP 03–07 add columns).
- The frontend enforces nothing on its own — the backend enforces the same access.

## Implementation checklist

- [x] `business` module + 5 tables + registration.
- [x] `GET /api/v1/me/context`, business-unit list/create/get, demo seed.
- [x] Backend tests: separation + tenant isolation.
- [ ] `PATCH /business-units/:id`.
- [ ] `GET /capabilities`, `PUT /capabilities/:id` (module_key/feature_key/config).
- [ ] `POST /me/switch-business-unit` + persisted active-unit preference.
- [ ] `module_visibility` table + inclusion in `/me/context`.
- [ ] Frontend switcher + context-driven navigation (see WP 12).
