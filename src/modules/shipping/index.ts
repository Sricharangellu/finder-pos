import type { PosModule } from "../types.js";
import { ShippingService } from "./service.js";
import { SalesService } from "../sales/service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SHIPPING_ORDERS = `
CREATE TABLE IF NOT EXISTS shipping_orders (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  ship_number     TEXT NOT NULL,
  invoice_id      TEXT NOT NULL,
  customer_id     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_shipment',
  method          TEXT NOT NULL DEFAULT 'delivery',
  carrier         TEXT,
  tracking_number TEXT,
  expected_date   BIGINT,
  shipped_date    BIGINT,
  delivered_date  BIGINT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE (tenant_id, ship_number)
);`;

const CREATE_SHIPPING_LINES = `
CREATE TABLE IF NOT EXISTS shipping_order_lines (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  shipping_order_id TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  packed            INTEGER NOT NULL DEFAULT 0
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS shipping_orders_tenant_status_idx ON shipping_orders (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS shipping_orders_invoice_uidx ON shipping_orders (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS shipping_lines_parent_idx ON shipping_order_lines (tenant_id, shipping_order_id);`;

// Delivery pipeline — a shipment can now originate from a sales order directly
// (B2B/ecommerce), not only from an invoice. invoice_id becomes nullable and the
// invoice uniqueness is enforced only when present; sales_order_id gets its own
// partial-unique index so a sales order maps to at most one shipment.
const ADD_SHIPMENT_SALES_ORDER = `
ALTER TABLE shipping_orders ADD COLUMN IF NOT EXISTS sales_order_id TEXT;
ALTER TABLE shipping_orders ALTER COLUMN invoice_id DROP NOT NULL;
DROP INDEX IF EXISTS shipping_orders_invoice_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS shipping_orders_invoice_uidx ON shipping_orders (tenant_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipping_orders_so_uidx ON shipping_orders (tenant_id, sales_order_id) WHERE sales_order_id IS NOT NULL;`;

// Seed the race-free ship_number counter (shared/docnumber.ts) from the current
// MAX suffix so existing numbering continues without collision.
const SEED_SHIPPING_COUNTER = `
INSERT INTO document_counters (tenant_id, kind, val)
  SELECT tenant_id, 'shipping_orders', COALESCE(MAX(CAST(SUBSTRING(ship_number FROM '[0-9]+$') AS BIGINT)), 0)
    FROM shipping_orders GROUP BY tenant_id
  ON CONFLICT (tenant_id, kind) DO NOTHING;`;

/** Shipping — shipping orders generated from invoices (ERP benchmark #8). */
export const shippingModule: PosModule = {
  name: "shipping",
  migrations: [CREATE_SHIPPING_ORDERS, CREATE_SHIPPING_LINES, INDEXES, ADD_SHIPMENT_SALES_ORDER, SEED_SHIPPING_COUNTER],
  register({ db, events, router }) {
    // The shipment for a packed sales order is created directly by the fulfillment
    // module's pack() (idempotent + re-pack-recoverable) rather than via a
    // fire-once `sales_order.packed` listener here.
    registerRoutes(router, new ShippingService(db, new SalesService(db, events)));
  },
};

export { ShippingService } from "./service.js";
export type { ShippingOrder, ShippingLine, ShipStatus, ShipMethod } from "./service.js";
