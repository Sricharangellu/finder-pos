import type { PosModule } from "../types.js";
import { PurchasingService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SUPPLIERS = `
CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  created_at BIGINT NOT NULL
);`;

const CREATE_PURCHASE_ORDERS = `
CREATE TABLE IF NOT EXISTS purchase_orders (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  supplier_id      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ordered',
  total_cost_cents BIGINT NOT NULL DEFAULT 0,
  created_at       BIGINT NOT NULL,
  received_at      BIGINT
);`;

const CREATE_PO_LINES = `
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  po_id           TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  line_cost_cents BIGINT NOT NULL,
  expiry_date     BIGINT,
  lot_code        TEXT
);`;

// Idempotent upgrade for DBs provisioned before expiry/lot/received_qty columns existed.
const ALTER_PO_LINES = `
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS expiry_date BIGINT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS lot_code TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_qty INTEGER NOT NULL DEFAULT 0;`;

// BE-11: partial PO receiving — receive_status + remaining_qty columns.
const ALTER_PO_RECEIVE_STATUS = `
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS receive_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS remaining_qty INTEGER;`;

// Vendor AP credits: chargebacks (we deduct from the vendor) and credit memos
// (vendor credits us). Reduce what we owe a supplier.
const CREATE_VENDOR_CREDITS = `
CREATE TABLE IF NOT EXISTS vendor_credits (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  type        TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  reason      TEXT,
  po_id       TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_credits_tenant_supplier_idx ON vendor_credits (tenant_id, supplier_id, status);`;

// Vendor returns / write-offs of damaged or expired stock.
const CREATE_VENDOR_RETURNS = `
CREATE TABLE IF NOT EXISTS vendor_returns (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  supplier_id      TEXT,
  reason           TEXT NOT NULL,
  total_cost_cents BIGINT NOT NULL DEFAULT 0,
  credit_id        TEXT,
  status           TEXT NOT NULL DEFAULT 'recorded',
  created_at       BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS vendor_return_lines (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  return_id       TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  unit_cost_cents BIGINT NOT NULL DEFAULT 0,
  lot_id          TEXT
);
CREATE INDEX IF NOT EXISTS vendor_returns_tenant_idx ON vendor_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vendor_return_lines_ret_idx ON vendor_return_lines (tenant_id, return_id);`;

const CREATE_PRODUCT_COSTS = `
CREATE TABLE IF NOT EXISTS product_costs (
  tenant_id  TEXT NOT NULL,
  product_id TEXT NOT NULL,
  cost_cents BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, product_id)
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS po_tenant_status_idx ON purchase_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS pol_tenant_po_idx ON purchase_order_lines (tenant_id, po_id);
CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers (tenant_id, created_at DESC);`;

// PO export/import schema from PurchaseOrder XLSX template.
// po_number: human-readable sequential number (e.g. 4868) separate from UUIDv7 id.
// suppliers: company (legal entity), phone, contact_name, terms_days (AP payment terms).
// po_lines: product_name/upc denormalized for display without joins; vendor_upc is the
// supplier's own barcode code; raw_cost_price_cents = pre-deal cost, unit_price_cents =
// selling price at time of PO, billed_qty tracks short/over-shipment vs ordered qty.
const ALTER_PO_XLSX_FIELDS = `
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS terms_days INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS upc TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS vendor_upc TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS raw_cost_price_cents BIGINT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS unit_price_cents BIGINT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS billed_qty INTEGER;
CREATE INDEX IF NOT EXISTS po_tenant_number_idx ON purchase_orders (tenant_id, po_number);
`;

// Full vendor profile from Vendor Template XLSX (BulkUpdateVendor sheet).
// vendor_type: 'manufacturer' | 'wholesaler' (from vendorType column).
// msa_type: MSA (Master Settlement Agreement) category — tobacco-industry compliance.
// due_amount_cents: running AP balance owed to this vendor (updated on PO receive / credit).
// status: 'active' | 'inactive' replacing the template's activeStatus 0/1 flag.
// Structured address (address1–zip) replaces the previous single address TEXT blob;
// address is kept for backward compat with data written by the earlier migration.
// updated_at added for audit trail on vendor record changes.
const ALTER_SUPPLIERS_VENDOR_FIELDS = `
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS dba TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fein_number TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vendor_type TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS msa_type TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS primary_sales_rep TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS due_amount_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address1 TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at BIGINT;
CREATE INDEX IF NOT EXISTS suppliers_tenant_type_idx ON suppliers (tenant_id, vendor_type);
CREATE INDEX IF NOT EXISTS suppliers_tenant_status_idx ON suppliers (tenant_id, status);
`;

/** Purchasing — suppliers, purchase orders, receiving. Receiving emits
 *  `purchase_order.received`; inventory listens and increments stock. */
export const purchasingModule: PosModule = {
  name: "purchasing",
  migrations: [CREATE_SUPPLIERS, CREATE_PURCHASE_ORDERS, CREATE_PO_LINES, ALTER_PO_LINES, ALTER_PO_RECEIVE_STATUS, CREATE_PRODUCT_COSTS, CREATE_VENDOR_CREDITS, CREATE_VENDOR_RETURNS, INDEXES, ALTER_PO_XLSX_FIELDS, ALTER_SUPPLIERS_VENDOR_FIELDS],
  async register({ db, events, router }) {
    const service = new PurchasingService(db, events);
    registerRoutes(router, service);
  },
};

export { PurchasingService } from "./service.js";
export type { Supplier, PurchaseOrder, PurchaseOrderWithLines } from "./service.js";
