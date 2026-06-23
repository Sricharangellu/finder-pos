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

/** Billing — supplier bills (AP) + customer invoices (AR). A received PO
 *  auto-drafts a bill (via the purchase_order.received event). */
export const billingModule: PosModule = {
  name: "billing",
  migrations: [CREATE_BILLS, CREATE_INVOICES, CREATE_PAYMENTS, INDEXES, ALTER_BILLS_VARIANCE, ALTER_INVOICES_DUNNING, ALTER_BILLS_DISCOUNT, ADD_BILLING_ENTERPRISE],
  async register({ db, events, router }) {
    const service = new BillingService(db, events);
    events.on("purchase_order.received", async (event) => {
      const p = event.payload as { tenantId?: string; poId?: string };
      if (p.tenantId && p.poId) await service.billFromPO(p.poId, p.tenantId);
    });
    // A sales order converted to an invoice raises the matching AR invoice.
    events.on("sales_order.invoiced", async (event) => {
      const p = event.payload as { tenantId?: string; customerId?: string; totalCents?: number };
      if (p.tenantId && p.customerId && p.totalCents && p.totalCents > 0) {
        await service.createInvoice({ customerId: p.customerId, totalCents: p.totalCents }, p.tenantId);
      }
    });
    registerRoutes(router, service);
  },
};

export { BillingService } from "./service.js";
export type { Bill, Invoice, DocStatus, DunningResult } from "./service.js";
