# Work Package 11: Integrations, Sync, Webhooks, And Connectors

## Goal

Connect external systems without putting external IDs or provider behavior directly into domain tables.

## Data Scheme

```sql
integration_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  business_unit_id TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  credentials_ref TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

external_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  local_entity_type TEXT NOT NULL,
  local_entity_id TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  UNIQUE (tenant_id, connection_id, local_entity_type, local_entity_id)
);
```

Additional tables:

```txt
sync_jobs
sync_job_items
webhook_events
integration_errors
```

## Existing Files To Touch

- `src/modules/sync`
- `src/modules/webhooks`
- `src/modules/ecommerce`
- `src/modules/payments`
- `web/app/(protected)/admin/integrations`

## Backend Endpoints

```txt
GET  /api/v1/integrations/connections
POST /api/v1/integrations/connections
PATCH /api/v1/integrations/connections/:id
POST /api/v1/integrations/:id/test
POST /api/v1/integrations/:id/sync/products
POST /api/v1/integrations/:id/sync/customers
POST /api/v1/integrations/:id/sync/orders
POST /api/v1/webhooks/:provider
GET  /api/v1/sync/jobs
GET  /api/v1/sync/jobs/:id
```

## Tests

- Same product maps to different external IDs per provider.
- Failed sync items are retryable.
- Webhooks are verified, logged, and replayable.

## Acceptance Criteria

- Integration scope can be tenant-wide, business-unit-specific, or channel-specific.

