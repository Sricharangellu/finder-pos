import type { JobRow } from "../types.js";
import type { DB } from "../../shared/db.js";
import { moduleLogger } from "../../shared/logger.js";

const log = moduleLogger("outbox-retention");

/**
 * ACPA M1.4: retention sweep for the event platform's bookkeeping tables.
 *
 * - `event_outbox` rows in status 'delivered' have fully served their purpose
 *   after the retention window; 'pending' and 'failed' rows are never touched
 *   (pending = still redeliverable, failed = parked for manual review).
 * - `event_consumptions` claims only guard redelivery of their event; once the
 *   event's outbox row is past retention nothing can redeliver it, so the
 *   claim can go too.
 *
 * Runs daily (self-re-enqueued, same pattern as idempotency-expiry).
 */
export const OUTBOX_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function outboxRetentionJob(_job: JobRow, db: DB): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  const outbox = await db.query<{ id: string }>(
    "DELETE FROM event_outbox WHERE status = 'delivered' AND delivered_at < @cutoff RETURNING id",
    { cutoff },
  );
  const claims = await db.query<{ event_id: string }>(
    "DELETE FROM event_consumptions WHERE consumed_at < @cutoff RETURNING event_id",
    { cutoff },
  );
  if (outbox.length > 0 || claims.length > 0) {
    log.info({ outboxRows: outbox.length, claimRows: claims.length }, "outbox retention sweep");
  }
}
