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

let lastEngine: SyncEngine | undefined;

export function getSyncEngine(): SyncEngine | undefined {
  return lastEngine;
}

export const syncModule: PosModule = {
  name: "sync",
  migrations: [dropLegacyNoTenant("sync_queue"), CREATE_SYNC_QUEUE_TABLE],
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
