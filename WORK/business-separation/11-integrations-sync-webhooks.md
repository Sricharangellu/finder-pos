# Work Package 11: Integrations, Sync, Webhooks, And Connectors

## Goal

Connect external systems without polluting core domain schemas. Every external
system connects through a connection, mapping, sync-job, and webhook-event table.

## Supported providers

Shopify · WooCommerce · QuickBooks · Stripe · Square · Clover · Distributor API ·
EDI provider · Tax/compliance provider · Email/SMS provider.

## Database changes

```sql
integration_connections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, business_unit_id TEXT,
  provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  credentials_ref TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);

external_mappings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL,
  local_entity_type TEXT NOT NULL, local_entity_id TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  UNIQUE (tenant_id, connection_id, local_entity_type, local_entity_id)
);
```

Also: `sync_jobs`, `sync_job_items`, `webhook_events`, `integration_errors`.

## Rules

- Never store external IDs as primary business keys — use `external_mappings`.
- Every sync must be idempotent.
- Webhooks must be verified; failed sync items must be retryable.
- Connections can be scoped to tenant, business unit, or channel.

## Current repo files affected

- `src/modules/sync`, `src/modules/webhooks`, `src/modules/ecommerce`, `src/modules/payments`.
- `web/app/(protected)/admin/integrations`.

## Backend endpoints

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

## Connector examples

- Retail: POS payments, terminal providers, receipt email/SMS.
- Wholesale: QuickBooks invoices, EDI orders, distributor catalogs, route delivery.
- Ecommerce: Shopify products, ecommerce orders, online inventory availability.

## Tests required

- The same product maps to different external IDs per provider.
- A failed sync does not corrupt local data (retryable items).
- Webhooks are verified, logged, and replayable.
- Integration visibility follows business-unit access.

## Acceptance criteria

- The same product can map to different external IDs per provider.
- Failed sync does not corrupt local data; webhooks are logged and replayable.
- Integration scope can be tenant-wide, business-unit-, or channel-specific.

## Implementation checklist

- [ ] Connection / mapping / sync-job / webhook-event / error tables.
- [ ] Idempotent sync with `external_mappings`; retryable `sync_job_items`.
- [ ] Verified, logged, replayable webhooks per provider.
- [ ] Connection scoping (tenant / business unit / channel).
- [ ] Admin integrations UI (connect, test, sync, job status, errors).
