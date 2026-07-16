import type { PosModule } from "../types.js";
import type { DomainEvent } from "../../shared/types.js";
import { claimEventOnce } from "../../shared/outbox.js";
import { InventoryService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";
import { PurchasingService } from "../purchasing/index.js";

// Mirrors db/migrations/0002_commerce.sql — db/ is the canonical DDL owner.
// inventory PK is (tenant_id, product_id) since product_ids are tenant-scoped.
const CREATE_INVENTORY_TABLE = `
CREATE TABLE IF NOT EXISTS inventory (
  product_id  TEXT NOT NULL,
  tenant_id   TEXT NOT NULL,
  stock_qty   INTEGER NOT NULL DEFAULT 0,
  reorder_pt  INTEGER NOT NULL DEFAULT 0,
  updated_at  BIGINT NOT NULL,
  CONSTRAINT inventory_pk PRIMARY KEY (tenant_id, product_id)
);
`;

const CREATE_MOVEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS inventory_movements (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref         TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ivm_tenant_product_idx ON inventory_movements (tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ivm_tenant_ref_idx ON inventory_movements (tenant_id, ref) WHERE ref IS NOT NULL;
`;

interface OrderCreatedPayload {
  id?: string;
  tenantId?: string;
  orderNumber?: string;
  stateCode?: string;
  totalCents?: number;
  lines?: Array<{ productId: string; quantity: number; unitCents: number }>;
}

interface OrderRefundedPayload {
  id?: string;
  tenantId?: string;
  orderNumber?: string;
  totalCents?: number;
}

// BE-10: cycle count sessions — open, record counted qtys, close (posts variances).
const CREATE_CYCLE_COUNT_TABLES = `
CREATE TABLE IF NOT EXISTS cycle_count_sessions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  opened_by   TEXT NOT NULL,
  opened_at   BIGINT NOT NULL,
  closed_at   BIGINT,
  note        TEXT
);
CREATE TABLE IF NOT EXISTS cycle_count_lines (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty  INTEGER,
  variance     INTEGER,
  recorded_at  BIGINT
);
CREATE INDEX IF NOT EXISTS cycle_count_sessions_tenant_idx ON cycle_count_sessions (tenant_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS cycle_count_lines_session_idx ON cycle_count_lines (tenant_id, session_id);
`;

export const inventoryModule: PosModule = {
  name: "inventory",
  migrations: [
    dropLegacyNoTenant("inventory_movements"),
    dropLegacyNoTenant("inventory"),
    CREATE_INVENTORY_TABLE,
    CREATE_MOVEMENTS_TABLE,
    `CREATE TABLE IF NOT EXISTS inventory_lots (
       id              TEXT PRIMARY KEY,
       tenant_id       TEXT NOT NULL,
       product_id      TEXT NOT NULL,
       lot_code        TEXT,
       expiry_date     BIGINT NOT NULL,
       qty_on_hand     INTEGER NOT NULL,
       unit_cost_cents BIGINT,
       po_id           TEXT,
       received_at     BIGINT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS inventory_lots_expiry_idx ON inventory_lots (tenant_id, expiry_date) WHERE qty_on_hand > 0;
     CREATE INDEX IF NOT EXISTS inventory_lots_product_idx ON inventory_lots (tenant_id, product_id);`,
    CREATE_CYCLE_COUNT_TABLES,
    `
CREATE TABLE IF NOT EXISTS inventory_locations (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  outlet_id             TEXT,
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  location_type         TEXT NOT NULL DEFAULT 'floor',
  is_sellable           BOOLEAN NOT NULL DEFAULT true,
  is_receiving_location BOOLEAN NOT NULL DEFAULT true,
  is_damage_location    BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_tenant_code_idx ON inventory_locations (tenant_id, code);
`,
    `
CREATE TABLE IF NOT EXISTS inventory_stock (

  tenant_id           TEXT NOT NULL,
  location_id         TEXT NOT NULL,
  product_id          TEXT NOT NULL,
  quantity_on_hand    INTEGER NOT NULL DEFAULT 0,
  quantity_committed  INTEGER NOT NULL DEFAULT 0,
  quantity_available  INTEGER NOT NULL DEFAULT 0,
  average_cost_cents  BIGINT NOT NULL DEFAULT 0,
  reorder_level       INTEGER NOT NULL DEFAULT 0,
  reorder_quantity    INTEGER NOT NULL DEFAULT 0,
  last_counted_at     BIGINT,
  updated_at          BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, location_id, product_id)
);
CREATE INDEX IF NOT EXISTS inventory_stock_location_idx ON inventory_stock (tenant_id, location_id, product_id);
CREATE INDEX IF NOT EXISTS inventory_stock_low_stock_idx ON inventory_stock (tenant_id, product_id) WHERE quantity_on_hand <= reorder_level AND reorder_level > 0;
`,
    `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outlets' AND table_schema = current_schema()) THEN
    INSERT INTO inventory_locations (id, tenant_id, outlet_id, code, name, location_type, is_sellable, is_receiving_location, is_active, created_at, updated_at)
    SELECT
      'iloc_' || o.id,
      o.tenant_id,
      o.id,
      'MAIN',
      COALESCE(o.name, 'Main Floor'),
      'floor',
      true,
      true,
      true,
      extract(epoch from now()) * 1000,
      extract(epoch from now()) * 1000
    FROM outlets o
    WHERE NOT EXISTS (
      SELECT 1 FROM inventory_locations il WHERE il.tenant_id = o.tenant_id AND il.outlet_id = o.id
    )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
`,
    `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_locations' AND table_schema = current_schema()) THEN
    INSERT INTO inventory_stock (tenant_id, location_id, product_id, quantity_on_hand, quantity_committed, quantity_available, average_cost_cents, reorder_level, reorder_quantity, updated_at)
    SELECT
      i.tenant_id,
      il.id,
      i.product_id,
      COALESCE(i.stock_qty, 0),
      0,
      COALESCE(i.stock_qty, 0),
      0,
      COALESCE(i.reorder_pt, 0),
      0,
      COALESCE(i.updated_at, extract(epoch from now()) * 1000)
    FROM inventory i
    JOIN (
      SELECT DISTINCT ON (tenant_id) id, tenant_id FROM inventory_locations ORDER BY tenant_id, created_at ASC
    ) il ON il.tenant_id = i.tenant_id
    ON CONFLICT (tenant_id, location_id, product_id) DO NOTHING;
  END IF;
END $$;
`,
    // PROD-8 + PROD-9: FK constraints and updated_at triggers for inventory tables.
    `
DO $$
DECLARE tbl TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN RETURN; END IF;
  FOREACH tbl IN ARRAY ARRAY['inventory_locations']
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
`,
    // DB-14: FIFO/FEFO costing — add unit_cost_cents to inventory_movements.
    // Populated on stock-in (PO receive) so COGS = SUM(|delta| × unit_cost_cents).
    `ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS unit_cost_cents BIGINT;`,
    // Location-to-location stock transfers (mock-only endpoint parity).
    `
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  transfer_number  TEXT NOT NULL,
  from_location_id TEXT NOT NULL,
  to_location_id   TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'completed',
  note             TEXT,
  created_at       BIGINT NOT NULL,
  due_date         BIGINT
);
CREATE INDEX IF NOT EXISTS inventory_transfers_tenant_idx ON inventory_transfers (tenant_id, created_at DESC);
`,
  ],
  register({ db, events, router, outbox }) {
    const service = new InventoryService(db, events);
    const purchasing = new PurchasingService(db, events);
    registerRoutes(router, service, purchasing);

    // order.created -> decrement stock for each line (reason 'sale', ref = order id).
    events.on("order.created", async (event) => {
      const payload = event.payload as OrderCreatedPayload;
      const orderId = payload.id ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (!tenantId) return; // no tenant context — skip (should not happen in prod)
      const lines = payload.lines ?? [];
      for (const line of lines) {
        await service.adjust(line.productId, -line.quantity, "sale", tenantId, orderId);
        // FEFO: draw the sold quantity from the earliest-expiring lots (no-op if untracked).
        await service.depleteFefo(line.productId, line.quantity, tenantId);
      }
    });

    // order.refunded -> restock by reversing the recorded 'sale' movements.
    events.on("order.refunded", async (event) => {
      const payload = event.payload as OrderRefundedPayload;
      const orderId = payload.id ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (orderId && tenantId) await service.restockFromOrderRef(orderId, tenantId);
    });

    // purchase_order.received -> increase stock for each received line (reason 'receiving').
    // Durable (ACPA M1.3): stock increments are not naturally idempotent, so
    // the handler claims the event id before applying — sync dispatch and
    // crash redelivery of the same receipt can never double-count stock.
    const receiveStock = async (event: { id?: string; aggregateId?: string; occurredAt: string; payload: unknown }) => {
      const payload = event.payload as {
        tenantId?: string;
        poId?: string;
        lines?: Array<{ productId: string; quantity: number; expiryDate?: number; lotCode?: string | null; unitCostCents?: number | null; locationId?: string | null }>;
      };
      const tenantId = payload.tenantId ?? "";
      const poId = payload.poId ?? event.aggregateId ?? "";
      if (!tenantId) return;
      if (!(await claimEventOnce(db, "inventory.receiving", event as DomainEvent))) return; // already applied
      for (const line of payload.lines ?? []) {
        await service.adjust(line.productId, line.quantity, "receiving", tenantId, poId);
        // If a receiving location was chosen at the desk, credit that location's
        // stock too (the product-level adjust above is the aggregate on-hand).
        if (line.locationId) {
          await service.adjustStock(tenantId, line.locationId, line.productId, line.quantity, "receiving", poId);
        }
        // If the received line carries an expiry, record a lot for FEFO / near-expiry tracking.
        if (line.expiryDate) {
          await service.createLot(
            { productId: line.productId, expiryDate: line.expiryDate, quantity: line.quantity, lotCode: line.lotCode ?? null, unitCostCents: line.unitCostCents ?? null, poId },
            tenantId,
          );
        }
      }
    };
    events.on("purchase_order.received", receiveStock);
    outbox?.onDurable("purchase_order.received", receiveStock);

    // stock.written_off (damaged/expired/vendor return) -> decrement stock + the specific lot.
    events.on("stock.written_off", async (event) => {
      const p = event.payload as {
        tenantId?: string;
        returnId?: string;
        lines?: Array<{ productId: string; quantity: number; lotId?: string | null }>;
      };
      const tenantId = p.tenantId ?? "";
      if (!tenantId) return;
      for (const line of p.lines ?? []) {
        await service.adjust(line.productId, -Math.abs(line.quantity), "adjustment", tenantId, p.returnId ?? "");
        if (line.lotId) await service.decrementLot(line.lotId, line.quantity, tenantId);
      }
    });
  },
};

export { InventoryService } from "./service.js";
export type {
  InventoryRow,
  MovementRow,
  MovementReason,
  ListInventoryQuery,
  CycleCountSession,
  CycleCountLine,
  InventoryLocation,
  InventoryStock,
} from "./service.js";
