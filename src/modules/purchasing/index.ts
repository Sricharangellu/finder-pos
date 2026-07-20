import type { PosModule } from "../types.js";
import { PurchasingService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { EdiImportsService } from "./edi-imports.js";
import { registerEdiRoutes } from "./edi-routes.js";

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

// Vendor-360 profile fields the detail page renders that predate this ALTER.
// (company/phone/contact_name/terms_days already added by ALTER_PO_XLSX_FIELDS.)
const ALTER_SUPPLIERS_VENDOR_360 = `
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
`;

// Landed costs: freight and other charges applied to a PO after goods are invoiced.
// freight_cost_cents + other_charges_cents sit on the PO; the total is distributed
// to lines proportionally by line_cost / goods_total (value method — most common).
// landed_cost_cents on each line = the line's share of total extra charges.
// On receive, product_costs records (line_cost + landed_cost) / qty as the true unit cost.
const ALTER_PO_LANDED_COSTS = `
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS freight_cost_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS other_charges_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS landed_cost_cents BIGINT NOT NULL DEFAULT 0;
`;

// Supplier normalization: normalized addresses, multiple contacts, and balance snapshot.
const CREATE_SUPPLIER_ADDRESSES = `
CREATE TABLE IF NOT EXISTS supplier_addresses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  supplier_id   TEXT NOT NULL,
  address_type  TEXT NOT NULL DEFAULT 'billing',
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  country       TEXT NOT NULL DEFAULT 'US',
  county        TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_addresses_supplier_idx ON supplier_addresses (tenant_id, supplier_id);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  supplier_id   TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  title         TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_contacts_supplier_idx ON supplier_contacts (tenant_id, supplier_id);

CREATE TABLE IF NOT EXISTS supplier_balances (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  supplier_id     TEXT NOT NULL UNIQUE,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  current_balance BIGINT NOT NULL DEFAULT 0,
  due_amount      BIGINT NOT NULL DEFAULT 0,
  last_payment_at BIGINT,
  updated_at      BIGINT NOT NULL
);
`;

// PO documents, billing adjustments, and vendor quotes for the detail page.
const CREATE_PO_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS po_documents (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  po_id       TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'other',
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  uploaded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_docs_po_idx ON po_documents (tenant_id, po_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS po_billing_adjustments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  po_id       TEXT NOT NULL,
  line_id     TEXT,
  reason      TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_billing_adj_po_idx ON po_billing_adjustments (tenant_id, po_id, created_at);

CREATE TABLE IF NOT EXISTS vendor_quotes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  expires_at  BIGINT,
  total_cents BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_quotes_tenant_idx ON vendor_quotes (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS vendor_quote_lines (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  quote_id         TEXT NOT NULL REFERENCES vendor_quotes(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL,
  product_name     TEXT,
  qty              INTEGER NOT NULL,
  unit_price_cents BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS vql_quote_idx ON vendor_quote_lines (tenant_id, quote_id);
`;

// PROD-8: FK — purchase_order_lines must reference a real purchase_order row.
const ADD_PO_LINE_FK = `
DO $$
BEGIN
  ALTER TABLE purchase_order_lines
    ADD CONSTRAINT fk_po_lines_po
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
`;

// PROD-9: updated_at auto-stamp on purchasing tables.
const ADD_PURCHASING_UPDATED_AT_TRIGGERS = `
DO $$
DECLARE tbl TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN RETURN; END IF;
  -- Only apply to tables that actually have an updated_at column.
  FOREACH tbl IN ARRAY ARRAY['suppliers']
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'updated_at'
      ) THEN
        EXECUTE format(
          'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          tbl, tbl
        );
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;
`;

// PO approval workflow (enterprise procurement). `approval_status` is orthogonal
// to the fulfillment `status` so existing lifecycle queries are unaffected:
//   approved (default — legacy rows and auto-approved POs) | pending | rejected.
// po_approvals is an APPEND-ONLY audit trail — no code path may update or delete
// rows. po_approval_config holds per-tenant amount tiers; absent row = approvals
// disabled (every PO auto-approves), so enabling the workflow is an explicit act.
const CREATE_PO_APPROVALS = `
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at BIGINT;

CREATE TABLE IF NOT EXISTS po_approvals (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  po_id        TEXT NOT NULL,
  action       TEXT NOT NULL,
  actor_id     TEXT,
  actor_role   TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_approvals_po_idx ON po_approvals (tenant_id, po_id, created_at);

CREATE TABLE IF NOT EXISTS po_approval_config (
  tenant_id           TEXT PRIMARY KEY,
  auto_limit_cents    BIGINT NOT NULL,
  manager_limit_cents BIGINT NOT NULL,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_at          BIGINT NOT NULL
);
`;

// Purchase requisitions (procurement PRD module 1 / ACPA E2): departments
// request inventory; a requisition moves draft → submitted → approved/rejected
// → converted (to a PO). Approval snapshot lives on the row (decided_by/at,
// note); unification with the po_approvals pattern is the E4 workflow story.
const CREATE_REQUISITIONS = `
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  req_number     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  department     TEXT,
  requested_by   TEXT,
  required_date  BIGINT,
  priority       TEXT NOT NULL DEFAULT 'normal',
  notes          TEXT,
  decided_by     TEXT,
  decided_at     BIGINT,
  decision_note  TEXT,
  po_id          TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS preq_tenant_status_idx ON purchase_requisitions (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  requisition_id TEXT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL,
  product_name   TEXT,
  quantity       INTEGER NOT NULL,
  est_cost_cents BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preq_lines_req_idx ON purchase_requisition_lines (tenant_id, requisition_id);
`;

// Seed the race-free po_number counter from the current MAX so existing
// numbering continues without collision (replaces MAX(po_number)+1, which
// minted duplicate numbers under concurrent creates).
const SEED_PO_COUNTER = `
INSERT INTO document_counters (tenant_id, kind, val)
  SELECT tenant_id, 'purchase_orders', COALESCE(MAX(po_number), 0)
    FROM purchase_orders GROUP BY tenant_id
  ON CONFLICT (tenant_id, kind) DO NOTHING;`;

// EDI imports (2026-07-18, Phase 0 gap-closure): status-tracked upload
// records for the Purchasing > EDI Imports page. See edi-imports.ts for the
// scope note on why validate/process are honest state-machine transitions
// rather than real EDI parsing — the frontend never uploads file content.
const CREATE_EDI_IMPORTS = `
CREATE TABLE IF NOT EXISTS edi_imports (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  filename         TEXT NOT NULL,
  format           TEXT NOT NULL,
  supplier_id      TEXT,
  supplier_name    TEXT NOT NULL,
  file_size_bytes  BIGINT NOT NULL DEFAULT 0,
  record_count     INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'queued',
  uploaded_at      BIGINT NOT NULL,
  processed_at     BIGINT,
  po_count         INTEGER NOT NULL DEFAULT 0,
  line_count       INTEGER NOT NULL DEFAULT 0,
  error_count      INTEGER NOT NULL DEFAULT 0,
  warnings         TEXT NOT NULL DEFAULT '[]',
  errors           TEXT NOT NULL DEFAULT '[]',
  created_po_ids   TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS edi_imports_tenant_idx ON edi_imports (tenant_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS edi_imports_tenant_status_idx ON edi_imports (tenant_id, status);
`;

/** Purchasing — suppliers, purchase orders, receiving. Receiving emits
 *  `purchase_order.received`; inventory listens and increments stock. */
export const purchasingModule: PosModule = {
  name: "purchasing",
  migrations: [CREATE_SUPPLIERS, CREATE_PURCHASE_ORDERS, CREATE_PO_LINES, ALTER_PO_LINES, ALTER_PO_RECEIVE_STATUS, CREATE_PRODUCT_COSTS, CREATE_VENDOR_CREDITS, CREATE_VENDOR_RETURNS, INDEXES, ALTER_PO_XLSX_FIELDS, ALTER_SUPPLIERS_VENDOR_FIELDS, ALTER_SUPPLIERS_VENDOR_360, ALTER_PO_LANDED_COSTS, CREATE_SUPPLIER_ADDRESSES, ADD_PO_LINE_FK, ADD_PURCHASING_UPDATED_AT_TRIGGERS, CREATE_PO_DOCUMENTS, CREATE_PO_APPROVALS, SEED_PO_COUNTER, CREATE_REQUISITIONS, CREATE_EDI_IMPORTS],
  async register({ db, events, router }) {
    const service = new PurchasingService(db, events);
    const ediService = new EdiImportsService(db);
    registerRoutes(router, service);
    registerEdiRoutes(router, ediService, db);
  },
};

export { PurchasingService } from "./service.js";
export type { Supplier, PurchaseOrder, PurchaseOrderWithLines } from "./service.js";
export { EdiImportsService } from "./edi-imports.js";
export type { EdiImport, EdiStatus, EdiFormatDef } from "./edi-imports.js";
export { getVendorHistory } from "./vendor-history.js";
export type { VendorPOSummary } from "./vendor-history.js";
