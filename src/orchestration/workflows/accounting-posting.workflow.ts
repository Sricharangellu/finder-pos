import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { AccountingEntryRequestedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Accounting Posting Workflow
 *
 * Trigger: accounting.entry_requested  (emitted by checkout, PO receiving, refund, reconciliation)
 * Modules: accounting
 *
 * Steps:
 * 1. validate_chart_of_accounts — confirm every account code exists for the tenant
 * 2. check_balance             — ensure debits === credits (double-entry invariant)
 * 3. post_journal_entry        — insert into journal_entries + journal_entry_lines
 * 4. emit_posted               — publish accounting.entry_posted
 *
 * Compensations:
 * - post_journal_entry: mark the entry as 'reversed', insert mirror entry with negated amounts
 */

interface JournalLine {
  accountCode: string;
  debitCents: Cents;
  creditCents: Cents;
  description: string;
  accountId?: string;
}

export interface AccountingContext extends WorkflowContext {
  referenceId: string;
  referenceType: string;
  lines: JournalLine[];
  journalEntryId: string | null;
  totalDebitCents: Cents;
  totalCreditCents: Cents;
}

export const AccountingPostingWorkflow: WorkflowDefinition<AccountingContext> = {
  type: "accounting_posting",
  triggers: [EventTypes.ACCOUNTING_ENTRY_REQUESTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): AccountingContext {
    const p = payload as unknown as AccountingEntryRequestedPayload;
    const lines: JournalLine[] = (p.lines ?? []).map((l) => ({
      accountCode: l.accountCode,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: l.description,
    }));
    return {
      workflowId: "",
      tenantId,
      correlationId: `je_${p.referenceId}`,
      referenceId: p.referenceId,
      referenceType: p.referenceType ?? "unknown",
      lines,
      journalEntryId: null,
      totalDebitCents: 0,
      totalCreditCents: 0,
    };
  },

  steps: [
    {
      name: "validate_chart_of_accounts",
      async execute(ctx, db) {
        const codes = [...new Set(ctx.lines.map((l) => l.accountCode))];
        for (const code of codes) {
          const account = await db.one<{ id: string; is_active: number }>(
            "SELECT id, is_active FROM accounts WHERE code = @code AND tenant_id = @tenantId",
            { code, tenantId: ctx.tenantId },
          );
          if (!account) throw new Error(`account code '${code}' not found`);
          if (!account.is_active) throw new Error(`account code '${code}' is inactive`);
        }
        // Resolve account IDs.
        const enriched = await Promise.all(
          ctx.lines.map(async (l) => {
            const acct = await db.one<{ id: string }>(
              "SELECT id FROM accounts WHERE code = @code AND tenant_id = @tenantId",
              { code: l.accountCode, tenantId: ctx.tenantId },
            );
            return { ...l, accountId: acct?.id };
          }),
        );
        return { ...ctx, lines: enriched };
      },
    },
    {
      name: "check_balance",
      async execute(ctx) {
        const totalDebitCents = ctx.lines.reduce((s, l) => s + l.debitCents, 0);
        const totalCreditCents = ctx.lines.reduce((s, l) => s + l.creditCents, 0);
        if (totalDebitCents !== totalCreditCents) {
          throw new Error(
            `journal entry unbalanced: debits=${totalDebitCents} credits=${totalCreditCents} (ref=${ctx.referenceId})`,
          );
        }
        return { ...ctx, totalDebitCents, totalCreditCents };
      },
    },
    {
      name: "post_journal_entry",
      async execute(ctx, db) {
        const { v7: uuidv7 } = await import("uuid");
        const now = Date.now();
        const entryId = `je_${uuidv7()}`;

        // Check for duplicate (idempotency: same referenceId + referenceType).
        const dup = await db.one<{ id: string }>(
          "SELECT id FROM journal_entries WHERE reference_id = @ref AND reference_type = @refType AND tenant_id = @tenantId",
          { ref: ctx.referenceId, refType: ctx.referenceType, tenantId: ctx.tenantId },
        );
        if (dup) return { ...ctx, journalEntryId: dup.id };

        await db.tx(async (tdb) => {
          await tdb.query(
            `INSERT INTO journal_entries
               (id, tenant_id, reference_id, reference_type, status, total_debit_cents, total_credit_cents, created_at)
             VALUES
               (@id, @tenantId, @referenceId, @referenceType, 'posted', @totalDebitCents, @totalCreditCents, @now)`,
            {
              id: entryId,
              tenantId: ctx.tenantId,
              referenceId: ctx.referenceId,
              referenceType: ctx.referenceType,
              totalDebitCents: ctx.totalDebitCents,
              totalCreditCents: ctx.totalCreditCents,
              now,
            },
          );
          for (const line of ctx.lines) {
            await tdb.query(
              `INSERT INTO journal_entry_lines
                 (id, tenant_id, entry_id, account_id, account_code, debit_cents, credit_cents, description)
               VALUES
                 (@id, @tenantId, @entryId, @accountId, @accountCode, @debitCents, @creditCents, @description)`,
              {
                id: `jel_${uuidv7()}`,
                tenantId: ctx.tenantId,
                entryId,
                accountId: line.accountId ?? null,
                accountCode: line.accountCode,
                debitCents: line.debitCents,
                creditCents: line.creditCents,
                description: line.description,
              },
            );
          }
        });

        return { ...ctx, journalEntryId: entryId };
      },
      async compensate(ctx, db) {
        if (!ctx.journalEntryId) return;
        const { v7: uuidv7 } = await import("uuid");
        const now = Date.now();
        const reversalId = `je_rev_${uuidv7()}`;
        // Mark original as reversed.
        await db.query(
          "UPDATE journal_entries SET status = 'reversed' WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.journalEntryId, tenantId: ctx.tenantId },
        );
        // Insert mirror reversal entry (debits ↔ credits).
        await db.tx(async (tdb) => {
          await tdb.query(
            `INSERT INTO journal_entries
               (id, tenant_id, reference_id, reference_type, status, total_debit_cents, total_credit_cents, created_at)
             VALUES
               (@id, @tenantId, @referenceId, 'reversal', 'posted', @totalDebitCents, @totalCreditCents, @now)`,
            {
              id: reversalId,
              tenantId: ctx.tenantId,
              referenceId: `${ctx.referenceId}_reversal`,
              totalDebitCents: ctx.totalCreditCents,
              totalCreditCents: ctx.totalDebitCents,
              now,
            },
          );
          for (const line of ctx.lines) {
            await tdb.query(
              `INSERT INTO journal_entry_lines
                 (id, tenant_id, entry_id, account_id, account_code, debit_cents, credit_cents, description)
               VALUES
                 (@id, @tenantId, @entryId, @accountId, @accountCode, @debitCents, @creditCents, @description)`,
              {
                id: `jel_${uuidv7()}`,
                tenantId: ctx.tenantId,
                entryId: reversalId,
                accountId: line.accountId ?? null,
                accountCode: line.accountCode,
                debitCents: line.creditCents, // swapped
                creditCents: line.debitCents, // swapped
                description: `REVERSAL: ${line.description}`,
              },
            );
          }
        });
      },
    },
    {
      name: "emit_posted",
      async execute(ctx, _db, events) {
        await events.publish(EventTypes.ACCOUNTING_ENTRY_POSTED, {
          tenantId: ctx.tenantId,
          journalEntryId: ctx.journalEntryId,
          referenceId: ctx.referenceId,
          referenceType: ctx.referenceType,
          totalDebitCents: ctx.totalDebitCents,
        });
        return ctx;
      },
    },
  ],
};
