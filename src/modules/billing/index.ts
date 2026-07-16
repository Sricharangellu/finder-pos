import type { PosModule } from "../types.js";
import { BillingService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_BILLS = `
CREATE TABLE IF NOT EXISTS bills (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  supplier_id  TEXT NOT NULL,
  po_id        TEXT,
  bill_number  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  total_cents  BIGINT NOT NULL,
  paid_cents   BIGINT NOT NULL DEFAULT 0,
  due_date     BIGINT,
  issued_at    BIGINT NOT NULL
);`;

const CREATE_INVOICES = `
CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  order_id       TEXT,
  invoice_number TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  total_cents    BIGINT NOT NULL,
  paid_cents     BIGINT NOT NULL DEFAULT 0,
  due_date       BIGINT,
  issued_at      BIGINT NOT NULL
);`;

const CREATE_PAYMENTS = `
CREATE TABLE IF NOT EXISTS billing_payments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  doc_id      TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  method      TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS bills_tenant_status_idx ON bills (tenant_id, status, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS bills_tenant_po_uidx ON bills (tenant_id, po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx ON invoices (tenant_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS billing_payments_doc_idx ON billing_payments (tenant_id, doc_type, doc_id);
-- DB review: AR-by-customer (financials, portal, AR aging) + AP-by-vendor (vendor detail, AP aging).
CREATE INDEX IF NOT EXISTS invoices_tenant_customer_idx ON invoices (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS bills_tenant_supplier_idx ON bills (tenant_id, supplier_id);`;

// BE-12: bill variance — signed delta when received total ≠ PO total.
const ALTER_BILLS_VARIANCE = `
ALTER TABLE bills ADD COLUMN IF NOT EXISTS variance_cents BIGINT;
`;

// BE-14: AR dunning level — 1=30d overdue, 2=60d, 3=90d.
const ALTER_INVOICES_DUNNING = `
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dunning_level INTEGER NOT NULL DEFAULT 0;
`;

// Delivery pipeline — link an AR invoice back to the sales order it was raised
// from, so the sales order / delivery views can show its billing status.
const ALTER_INVOICES_SALES_ORDER = `
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sales_order_id TEXT;
CREATE INDEX IF NOT EXISTS invoices_tenant_so_idx ON invoices (tenant_id, sales_order_id) WHERE sales_order_id IS NOT NULL;
`;

// BE-30: early payment discount on bills.
const ALTER_BILLS_DISCOUNT = `
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_pct     NUMERIC(5,2);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_date    BIGINT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_applied_cents BIGINT NOT NULL DEFAULT 0;
`;

// DB-4: enterprise composite indexes for range queries on issued_at + status.
// DB-12: CHECK constraints on billing status columns.
const ADD_BILLING_ENTERPRISE = `
CREATE INDEX IF NOT EXISTS invoices_tenant_issued_status_idx
  ON invoices (tenant_id, issued_at DESC, status);
CREATE INDEX IF NOT EXISTS bills_tenant_issued_status_idx
  ON bills (tenant_id, issued_at DESC, status);
DO $$
BEGIN
  ALTER TABLE invoices
    ADD CONSTRAINT chk_invoices_status
    CHECK (status IN ('open','partial','paid','void'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER TABLE bills
    ADD CONSTRAINT chk_bills_status
    CHECK (status IN ('open','partial','paid','void'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
`;

// Seed the race-free document counters (shared/docnumber.ts) from the current
// MAX numeric suffix so existing bill/invoice numbering continues without
// collision. Replaces the COUNT(*)+1 pattern that minted duplicate numbers
// under concurrent creates. Fresh databases seed nothing → first is 00001.
const SEED_BILLING_COUNTERS = `
INSERT INTO document_counters (tenant_id, kind, val)
  SELECT tenant_id, 'bills', COALESCE(MAX(CAST(SUBSTRING(bill_number FROM '[0-9]+$') AS BIGINT)), 0)
    FROM bills GROUP BY tenant_id
  ON CONFLICT (tenant_id, kind) DO NOTHING;
INSERT INTO document_counters (tenant_id, kind, val)
  SELECT tenant_id, 'invoices', COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS BIGINT)), 0)
    FROM invoices GROUP BY tenant_id
  ON CONFLICT (tenant_id, kind) DO NOTHING;`;

/** Billing — supplier bills (AP) + customer invoices (AR). A received PO
 *  auto-drafts a bill (via the purchase_order.received event). */
export const billingModule: PosModule = {
  name: "billing",
  migrations: [CREATE_BILLS, CREATE_INVOICES, CREATE_PAYMENTS, INDEXES, ALTER_BILLS_VARIANCE, ALTER_INVOICES_DUNNING, ALTER_INVOICES_SALES_ORDER, ALTER_BILLS_DISCOUNT, ADD_BILLING_ENTERPRISE, SEED_BILLING_COUNTERS],
  async register({ db, events, router, outbox }) {
    const service = new BillingService(db, events);
    // Auto-bill on receive. Registered on the bus AND as a durable outbox
    // consumer (ACPA M1): billFromPO is idempotent (skips if a bill exists),
    // so crash redelivery can never draft a duplicate bill.
    const autoBill = async (event: { payload: unknown }) => {
      const p = event.payload as { tenantId?: string; poId?: string };
      if (p.tenantId && p.poId) await service.billFromPO(p.poId, p.tenantId);
    };
    events.on("purchase_order.received", autoBill);
    outbox?.onDurable("purchase_order.received", autoBill);
    // A sales order converted to an invoice raises the matching AR invoice,
    // linked back to the sales order so delivery/sales views can show it.
    // Durable (ACPA M1.3): idempotent by natural key — one AR invoice per
    // sales order — so crash redelivery can never raise a duplicate.
    const raiseArInvoice = async (event: { payload: unknown }) => {
      const p = event.payload as { tenantId?: string; customerId?: string; totalCents?: number; salesOrderId?: string };
      if (!p.tenantId || !p.customerId || !p.totalCents || p.totalCents <= 0) return;
      if (p.salesOrderId) {
        const existing = await db.one<{ id: string }>(
          "SELECT id FROM invoices WHERE tenant_id = @t AND sales_order_id = @so LIMIT 1",
          { t: p.tenantId, so: p.salesOrderId },
        );
        if (existing) return; // already invoiced (redelivery or retry)
      }
      await service.createInvoice({ customerId: p.customerId, totalCents: p.totalCents, salesOrderId: p.salesOrderId }, p.tenantId);
    };
    events.on("sales_order.invoiced", raiseArInvoice);
    outbox?.onDurable("sales_order.invoiced", raiseArInvoice);
    registerRoutes(router, service);
  },
};

export { BillingService } from "./service.js";
export type { Bill, Invoice, DocStatus, DunningResult } from "./service.js";
