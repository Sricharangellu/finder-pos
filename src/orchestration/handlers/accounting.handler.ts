import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";
import { IdempotencyStore } from "../idempotency/idempotency-store.js";

interface JournalLine { accountCode: string; debitCents: number; creditCents: number; description: string; }

export function registerAccountingHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  const idempotency = new IdempotencyStore(db);

  bus.register(CommandTypes.POST_JOURNAL_ENTRY, async (cmd: Command<{
    referenceId: string; referenceType: string; lines: JournalLine[];
  }>) => {
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
      tenantId: cmd.tenantId,
      referenceId: cmd.payload.referenceId,
      referenceType: cmd.payload.referenceType,
      lines: cmd.payload.lines,
    });

    const result = { posted: true, referenceId: cmd.payload.referenceId };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });

  bus.register(CommandTypes.REVERSE_JOURNAL_ENTRY, async (cmd: Command<{ journalEntryId: string }>) => {
    // Mark original entry as reversed in DB.
    await db.query(
      "UPDATE journal_entries SET status = 'reversed' WHERE id = @id AND tenant_id = @tenantId",
      { id: cmd.payload.journalEntryId, tenantId: cmd.tenantId },
    );
    await events.publish(EventTypes.ACCOUNTING_ENTRY_POSTED, {
      tenantId: cmd.tenantId,
      journalEntryId: cmd.payload.journalEntryId,
      referenceId: `${cmd.payload.journalEntryId}_reversal`,
      referenceType: "manual_reversal",
    });
    return { reversed: true, journalEntryId: cmd.payload.journalEntryId };
  });
}
