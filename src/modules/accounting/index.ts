import type { PosModule } from "../types.js";
import { AccountingService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { logger } from "../../shared/logger.js";

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  parent_id  TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, code)
);`;

const CREATE_BATCH_DEPOSITS = `
CREATE TABLE IF NOT EXISTS batch_deposits (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  description  TEXT,
  account_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending_approval',
  total_cents  BIGINT NOT NULL,
  deposit_date BIGINT,
  created_at   BIGINT NOT NULL,
  decided_at   BIGINT,
  UNIQUE (tenant_id, batch_number)
);`;

const CREATE_DEPOSIT_ITEMS = `
CREATE TABLE IF NOT EXISTS batch_deposit_items (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  batch_id     TEXT NOT NULL,
  payment_id   TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
);`;

// Double-entry posting ledger. APPEND-ONLY: no code path updates or deletes
// journal rows — corrections are posted as new reversing transactions.
// entry_group ties the balanced legs of one transaction together.
const CREATE_JOURNAL = `
CREATE TABLE IF NOT EXISTS journal_entries (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  entry_group   TEXT NOT NULL,
  doc_type      TEXT NOT NULL,
  doc_id        TEXT,
  account_code  TEXT NOT NULL,
  account_name  TEXT NOT NULL,
  debit_cents   BIGINT NOT NULL DEFAULT 0,
  credit_cents  BIGINT NOT NULL DEFAULT 0,
  memo          TEXT,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_tenant_doc_idx ON journal_entries (tenant_id, doc_type, doc_id);
CREATE INDEX IF NOT EXISTS journal_tenant_account_idx ON journal_entries (tenant_id, account_code, created_at DESC);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS accounts_tenant_type_idx ON accounts (tenant_id, type, code);
CREATE INDEX IF NOT EXISTS batch_deposits_tenant_status_idx ON batch_deposits (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS deposit_items_batch_idx ON batch_deposit_items (tenant_id, batch_id);`;

/** Accounting — Chart of Accounts, Batch Deposits, and the posting ledger.
 *
 * Automatic postings (event-driven; operational modules stay accounting-blind):
 *   purchase_order.received → Dr 1200 Inventory   / Cr 2050 GRNI      (goods value)
 *   bill.created            → Dr 2050 GRNI        / Cr 2000 AP        (bill total)
 *   bill.paid               → Dr 2000 AP          / Cr 1010 Bank      (amount paid)
 *   payment.captured (POS)  → Dr 1000 Cash        / Cr 4000 Revenue   (net of change)
 *
 * Handlers never throw: a ledger failure must not block the operational flow —
 * it is logged and can be re-posted manually. Known v1 simplification: POS
 * postings credit the full net amount to Sales Revenue (the payment event has
 * no tax breakdown yet); the sales-tax split is a planned refinement.
 */
export const accountingModule: PosModule = {
  name: "accounting",
  migrations: [CREATE_ACCOUNTS, CREATE_BATCH_DEPOSITS, CREATE_DEPOSIT_ITEMS, CREATE_JOURNAL, INDEXES],
  register({ db, events, router, outbox }) {
    const service = new AccountingService(db);
    registerRoutes(router, service);

    const post = async (
      docType: string, docId: string, tenantId: string,
      legs: Array<{ accountCode: string; debitCents?: number; creditCents?: number }>,
      memo: string,
    ) => {
      try {
        if (await service.hasPosting(docType, docId, tenantId)) return; // idempotent per document
        await service.postTransaction(docType, docId, legs, tenantId, memo);
      } catch (err) {
        logger.warn({ err, docType, docId }, "ledger posting failed (operational flow unaffected)");
      }
    };

    // Each posting handler registers TWICE: on the bus (normal synchronous
    // path) and as a durable outbox consumer (crash redelivery, ACPA M1).
    // All are idempotent via hasPosting(), so redelivery can never double-post.
    const onBoth = (type: string, handler: (event: { occurredAt: string; payload: unknown }) => Promise<void>) => {
      events.on(type, handler);
      outbox?.onDurable(type, handler);
    };

    // Goods received → inventory asset up, GRNI liability up.
    onBoth("purchase_order.received", async (event) => {
      const p = event.payload as { tenantId: string; poId: string; lines?: Array<{ quantity: number; unitCostCents: number }> };
      const goods = (p.lines ?? []).reduce((s, l) => s + l.quantity * l.unitCostCents, 0);
      if (goods <= 0) return;
      // Each receive event is its own posting (partial receipts post separately),
      // so the idempotency key is per event — poId + occurrence time survives
      // redelivery of the same event without collapsing distinct receipts.
      await post("purchase_receipt", `${p.poId}:${event.occurredAt}`, p.tenantId, [
        { accountCode: "1200", debitCents: goods },
        { accountCode: "2050", creditCents: goods },
      ], `PO ${p.poId} received`);
    });

    // Vendor bill posted → GRNI relieved, AP recognized.
    onBoth("bill.created", async (event) => {
      const p = event.payload as { tenantId: string; billId: string; totalCents: number };
      if (!p.totalCents || p.totalCents <= 0) return;
      await post("bill", p.billId, p.tenantId, [
        { accountCode: "2050", debitCents: p.totalCents },
        { accountCode: "2000", creditCents: p.totalCents },
      ], `Bill ${p.billId} posted`);
    });

    // Vendor bill paid → AP relieved, bank down. One posting per payment.
    onBoth("bill.paid", async (event) => {
      const p = event.payload as { tenantId: string; billId: string; amountCents: number };
      if (!p.amountCents || p.amountCents <= 0) return;
      await post("bill_payment", `${p.billId}:${event.occurredAt}`, p.tenantId, [
        { accountCode: "2000", debitCents: p.amountCents },
        { accountCode: "1010", creditCents: p.amountCents },
      ], `Payment on bill ${p.billId}`);
    });

    // POS payment captured → cash up, revenue recognized (net of change given).
    onBoth("payment.captured", async (event) => {
      const p = event.payload as { tenantId: string; id: string; orderId: string; amountCents: number; changeCents?: number };
      const net = p.amountCents - (p.changeCents ?? 0);
      if (net <= 0) return;
      await post("pos_payment", p.id, p.tenantId, [
        { accountCode: "1000", debitCents: net },
        { accountCode: "4000", creditCents: net },
      ], `POS payment for order ${p.orderId}`);
    });

    // POS order refunded → reverse the recognized sale: revenue down, cash out.
    // The mirror image of the payment.captured posting above. Without this the
    // sale's Dr Cash / Cr Revenue stayed on the books after a full refund,
    // overstating both cash and revenue — the ledger's only refund posting path
    // was the accounting.entry_requested workflow, which writes to a journal
    // schema that was never migrated and so silently failed on every refund.
    // order.refunded is a full-order refund carrying the order total (the amount
    // originally taken to Cash/Revenue on capture). Idempotent per order via
    // hasPosting. Known v1 simplification (same as capture): the whole amount
    // reverses out of Sales Revenue; the sales-tax split is a planned refinement
    // once refund events carry a tax breakdown.
    onBoth("order.refunded", async (event) => {
      const p = event.payload as { tenantId: string; id: string; orderNumber?: string; totalCents: number };
      const amount = p.totalCents;
      if (!amount || amount <= 0) return;
      await post("pos_refund", p.id, p.tenantId, [
        { accountCode: "4000", debitCents: amount },
        { accountCode: "1000", creditCents: amount },
      ], `Refund for order ${p.orderNumber ?? p.id}`);
    });
  },
};

export { AccountingService } from "./service.js";
export type { Account, AccountNode, AccountType, BatchDeposit, BatchDepositItem, DepositStatus, JournalEntry, JournalLeg } from "./service.js";
