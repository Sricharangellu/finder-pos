import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "../events/event-types.js";

export interface ReverseLedgerEntryOptions {
  referenceId: string;
  referenceType: string;
  tenantId: string;
}

/**
 * Standalone compensation: reverse a posted journal entry.
 * Creates a mirror entry with swapped debits/credits and marks the
 * original as 'reversed'. Idempotent — safe to call multiple times.
 */
export async function reverseLedgerEntryCompensation(
  opts: ReverseLedgerEntryOptions,
  db: DB,
  events: EventBus,
): Promise<void> {
  const original = await db.one<{ id: string; status: string }>(
    "SELECT id, status FROM journal_entries WHERE reference_id = @refId AND reference_type = @refType AND tenant_id = @tenantId",
    { refId: opts.referenceId, refType: opts.referenceType, tenantId: opts.tenantId },
  );
  if (!original || original.status === "reversed") return; // Already reversed — idempotent.

  await db.query(
    "UPDATE journal_entries SET status = 'reversed' WHERE id = @id AND tenant_id = @tenantId",
    { id: original.id, tenantId: opts.tenantId },
  );

  // Fetch original lines and emit reversal entry.
  const lines = await db.query<{ account_code: string; debit_cents: number; credit_cents: number; description: string }>(
    "SELECT account_code, debit_cents, credit_cents, description FROM journal_entry_lines WHERE entry_id = @entryId AND tenant_id = @tenantId",
    { entryId: original.id, tenantId: opts.tenantId },
  );

  await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
    tenantId: opts.tenantId,
    referenceId: `${opts.referenceId}_reversal`,
    referenceType: `${opts.referenceType}_reversal`,
    lines: lines.map((l) => ({
      accountCode: l.account_code,
      debitCents: l.credit_cents, // swapped
      creditCents: l.debit_cents, // swapped
      description: `REVERSAL: ${l.description}`,
    })),
  });
}
