import type { PosModule } from "../types.js";
import { SyncEngine } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";

// Mirrors db/migrations/0002_commerce.sql — db/ is the canonical DDL owner.
const CREATE_SYNC_QUEUE_TABLE = `
CREATE TABLE IF NOT EXISTS sync_queue (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  last_attempted_at BIGINT
);
CREATE INDEX IF NOT EXISTS sq_tenant_status_created_idx ON sync_queue (tenant_id, status, created_at ASC);
`;

// Import/export batch tracking and integration providers.
const CREATE_IMPORT_EXPORT_TABLES = `
CREATE TABLE IF NOT EXISTS import_batches (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  import_type   TEXT NOT NULL,
  file_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  total_rows    INTEGER NOT NULL DEFAULT 0,
  success_rows  INTEGER NOT NULL DEFAULT 0,
  failed_rows   INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_by    TEXT,
  created_at    BIGINT NOT NULL,
  completed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS import_batches_tenant_idx ON import_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_rows (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  batch_id      TEXT NOT NULL,
  row_number    INTEGER NOT NULL,
  raw_data      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at    BIGINT NOT NULL,
  processed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS import_rows_batch_idx ON import_rows (tenant_id, batch_id, row_number);

CREATE TABLE IF NOT EXISTS export_batches (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  export_type TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  total_rows  INTEGER NOT NULL DEFAULT 0,
  file_url    TEXT,
  created_by  TEXT,
  created_at  BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS export_batches_tenant_idx ON export_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_providers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    BIGINT NOT NULL
);
INSERT INTO integration_providers (id, name, provider_type, is_active, created_at) VALUES
  ('iprov_shopify', 'Shopify', 'ecommerce', true, 0),
  ('iprov_quickbooks', 'QuickBooks', 'accounting', true, 0),
  ('iprov_stripe', 'Stripe', 'payment', true, 0),
  ('iprov_avalara', 'Avalara', 'tax', true, 0),
  ('iprov_shipstation', 'ShipStation', 'shipping', true, 0),
  ('iprov_sendgrid', 'SendGrid', 'email', true, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_integrations (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  provider_id    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'inactive',
  settings       TEXT,
  last_sync_at   BIGINT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS company_integrations_unique_idx ON company_integrations (tenant_id, provider_id);
`;

let lastEngine: SyncEngine | undefined;

export function getSyncEngine(): SyncEngine | undefined {
  return lastEngine;
}

export const syncModule: PosModule = {
  name: "sync",
  migrations: [dropLegacyNoTenant("sync_queue"), CREATE_SYNC_QUEUE_TABLE, CREATE_IMPORT_EXPORT_TABLES],
  register({ db, events, router }) {
    const engine = new SyncEngine(db, events);
    lastEngine = engine;

    // Transactional outbox: every domain event is recorded as `pending`.
    events.onAny((event) => engine.enqueue(event));

    registerRoutes(router, engine);
  },
};

export { SyncEngine } from "./service.js";
export type {
  SyncRow,
  SyncStatus,
  SyncCounts,
  StatusReport,
  PushResult,
  Uploader,
} from "./service.js";
