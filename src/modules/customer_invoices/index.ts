import type { PosModule } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Router } from "express";
import { customerInvoicesService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_CUSTOMER_INVOICES = `
CREATE TABLE IF NOT EXISTS customer_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT,
  customer_phone TEXT,
  billing_address TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  due_date BIGINT,
  paid_at BIGINT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_invoices_tenant_idx ON customer_invoices (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_invoices_tenant_number_idx ON customer_invoices (tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS customer_invoices_customer_idx ON customer_invoices (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

const CREATE_CUSTOMER_INVOICE_LINES = `
CREATE TABLE IF NOT EXISTS customer_invoice_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  upc TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate_pct REAL NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_invoice_lines_invoice_idx ON customer_invoice_lines (tenant_id, invoice_id);
`;

const CREATE_INVOICE_SEQUENCE = `
CREATE SEQUENCE IF NOT EXISTS customer_invoice_seq START 1000;
`;

export const customerInvoicesModule: PosModule = {
  name: "customer_invoices",
  // Routes are top-level resource names (router.get("/customer-invoices", …)),
  // matching the store_locations convention — so this must mount at /api/v1, not
  // the default /api/v1/customer_invoices (which 404s the client's hyphenated
  // path while MSW masks it in dev). name kept as-is so migrations are unaffected.
  mountPath: "/api/v1",
  migrations: [CREATE_CUSTOMER_INVOICES, CREATE_CUSTOMER_INVOICE_LINES, CREATE_INVOICE_SEQUENCE],
  register({ db, events, router }: { db: DB; events: EventBus; router: Router }) {
    const svc = customerInvoicesService(db, events);
    registerRoutes(router, svc);
  },
};
