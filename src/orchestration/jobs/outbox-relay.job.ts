/**
 * DB-8: Outbox Relay job — reads un-dispatched event_outbox rows and
 * re-publishes them via the in-process EventBus.
 *
 * This gives at-least-once delivery: if the process crashes after a DB commit
 * but before EventBus.publish() returns, the outbox row remains with
 * dispatched=FALSE and is picked up on the next poll.
 *
 * Run every 5 seconds via the Postgres job queue.
 * Marks rows dispatched=TRUE before publishing so that concurrent pollers
 * don't double-dispatch (FOR UPDATE SKIP LOCKED ensures exclusive access).
 */

import type { JobRow } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { DomainEvent } from "../../shared/types.js";
import { moduleLogger } from "../../shared/logger.js";

const log = moduleLogger("outbox-relay");
const BATCH = 50;

export async function outboxRelayJob(_job: JobRow, db: DB, events: EventBus): Promise<void> {
  // Claim up to BATCH pending rows atomically.
  const rows = await db.query<{
    id: string;
    type: string;
    aggregate_id: string;
    payload: string;
    occurred_at: string;
  }>(
    `WITH claimed AS (
       SELECT id FROM event_outbox
       WHERE dispatched = FALSE
       ORDER BY created_at ASC
       LIMIT @batch
       FOR UPDATE SKIP LOCKED
     )
     UPDATE event_outbox
       SET dispatched = TRUE
     WHERE id IN (SELECT id FROM claimed)
     RETURNING id, type, aggregate_id, payload, occurred_at`,
    { batch: BATCH },
  );

  if (rows.length === 0) return;

  let dispatched = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const event: DomainEvent = {
        type: row.type,
        aggregateId: row.aggregate_id,
        payload,
        occurredAt: row.occurred_at,
      };
      await events.publish(event.type, event.payload, event.aggregateId);
      dispatched++;
    } catch {
      // Mark failed rows as NOT dispatched so they retry.
      await db.query(
        "UPDATE event_outbox SET dispatched = FALSE WHERE id = @id",
        { id: row.id },
      ).catch(() => {});
    }
  }

  if (dispatched > 0) {
    log.info({ dispatched }, "outbox relay dispatched events");
  }
}

export const OUTBOX_RELAY_INTERVAL_MS = 5_000; // 5 second poll
