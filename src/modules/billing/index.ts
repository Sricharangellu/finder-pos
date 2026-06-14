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

/** Billing — supplier bills (AP) + customer invoices (AR). A received PO
 *  auto-drafts a bill (via the purchase_order.received event). */
export const billingModule: PosModule = {
  name: "billing",
  migrations: [CREATE_BILLS, CREATE_INVOICES, CREATE_PAYMENTS, INDEXES],
  async register({ db, events, router }) {
    const service = new BillingService(db);
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
export type { Bill, Invoice, DocStatus } from "./service.js";
