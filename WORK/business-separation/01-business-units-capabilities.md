# Work Package 01: Business Units, Channels, And Capabilities

## Goal

Add the core separation layer that lets one tenant operate retail, wholesale, ecommerce, warehouse, and mixed business units without creating separate databases by default.

## User Feature Separation

- Retail users see POS, register, retail orders, retail customers, store inventory, and retail reports.
- Wholesale users see quotes, sales orders, warehouse picking, invoices, AR, customer accounts, and wholesale reports.
- Admin/owner users can switch business units and configure shared platform modules.

## Data Scheme

Create a new `business` module with these tables:

```sql
business_units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (tenant_id, code)
);

business_unit_channels (
  tenant_id TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, business_unit_id, channel)
);

business_unit_locations (
  tenant_id TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_type TEXT NOT NULL,
  PRIMARY KEY (tenant_id, business_unit_id, location_id)
);

tenant_capabilities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  business_unit_id TEXT,
  module_key TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (tenant_id, business_unit_id, module_key, feature_key)
);
```

## Existing Files To Touch

- Add `src/modules/business/index.ts`
- Add `src/modules/business/service.ts`
- Add `src/modules/business/routes.ts`
- Add `src/modules/business/business.test.ts`
- Register in `src/modules/index.ts`
- Later extend `src/gateway/auth.ts`

## Backend Endpoints

```txt
GET    /api/v1/business-units
POST   /api/v1/business-units
PATCH  /api/v1/business-units/:id
GET    /api/v1/capabilities
PUT    /api/v1/capabilities/:id
GET    /api/v1/me/context
POST   /api/v1/me/switch-business-unit
```

## Frontend Work

- Add business-unit switcher.
- Render navigation from `/api/v1/me/context`.
- Hide modules not enabled for the active business unit.

## Tests

- Retail-only user cannot access wholesale business unit.
- Wholesale-only user cannot access retail business unit.
- Owner can switch between business units.
- Capability response matches enabled modules.

## Acceptance Criteria

- Every tenant can have one or more business units.
- Every business unit can have one or more channels.
- `/me/context` becomes the source of truth for frontend navigation.

