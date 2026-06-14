import type { PosModule } from "../types.js";
import { ShippingService } from "./service.js";
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

/** Shipping — shipping orders generated from invoices (ERP benchmark #8). */
export const shippingModule: PosModule = {
  name: "shipping",
  migrations: [CREATE_SHIPPING_ORDERS, CREATE_SHIPPING_LINES, INDEXES],
  register({ db, router }) {
    registerRoutes(router, new ShippingService(db));
  },
};

export { ShippingService } from "./service.js";
export type { ShippingOrder, ShippingLine, ShipStatus, ShipMethod } from "./service.js";
