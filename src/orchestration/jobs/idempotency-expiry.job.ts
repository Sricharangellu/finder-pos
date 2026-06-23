/**
 * DB-10: Idempotency key expiry job.
 *
 * Deletes expired idempotency_keys rows in batches to prevent the table from
 * growing without bound. At 10K tenants × 1K keys/day = 10M rows/day;
 * without expiry the table reaches 3.65B rows after 1 year.
 *
 * Runs every 6 hours; deletes in batches of 10K to avoid long lock holds.
 * Re-enqueues itself 6 hours after completion (idempotent via enqueueOnce).
 */

import type { JobRow } from "../types.js";
import type { DB } from "../../shared/db.js";
import { moduleLogger } from "../../shared/logger.js";

const log = moduleLogger("idempotency-expiry");
const BATCH_SIZE = 10_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function idempotencyExpiryJob(job: JobRow, db: DB): Promise<void> {
  const now = Date.now();
  let totalDeleted = 0;

  // Delete in batches to avoid long table locks.
  while (true) {
    const result = await db.query<{ count: number }>(
      `WITH deleted AS (
         DELETE FROM idempotency_keys
         WHERE id IN (
           SELECT id FROM idempotency_keys
           WHERE expires_at <= @now
           ORDER BY expires_at ASC
           LIMIT @batch
         )
         RETURNING id
       )
       SELECT COUNT(*)::int AS count FROM deleted`,
      { now, batch: BATCH_SIZE },
    );

    const deleted = Number(result[0]?.count ?? 0);
    totalDeleted += deleted;

    if (deleted < BATCH_SIZE) break; // no more expired rows
    // Brief pause between batches to avoid starving concurrent requests.
    await new Promise((r) => setTimeout(r, 50));
  }

  log.info({ totalDeleted, jobId: job.id }, "idempotency key expiry complete");
}

export const IDEMPOTENCY_EXPIRY_INTERVAL_MS = INTERVAL_MS;
