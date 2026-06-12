import type { PosModule } from "../types.js";
import { InventoryService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";

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

export const inventoryModule: PosModule = {
  name: "inventory",
  migrations: [dropLegacyNoTenant("inventory_movements"), dropLegacyNoTenant("inventory"), CREATE_INVENTORY_TABLE, CREATE_MOVEMENTS_TABLE],
  register({ db, events, router }) {
    const service = new InventoryService(db, events);
    registerRoutes(router, service);

    // order.created -> decrement stock for each line (reason 'sale', ref = order id).
    events.on("order.created", async (event) => {
      const payload = event.payload as OrderCreatedPayload;
      const orderId = payload.id ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (!tenantId) return; // no tenant context — skip (should not happen in prod)
      const lines = payload.lines ?? [];
      for (const line of lines) {
        await service.adjust(line.productId, -line.quantity, "sale", tenantId, orderId);
      }
    });

    // order.refunded -> restock by reversing the recorded 'sale' movements.
    events.on("order.refunded", async (event) => {
      const payload = event.payload as OrderRefundedPayload;
      const orderId = payload.id ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (orderId && tenantId) await service.restockFromOrderRef(orderId, tenantId);
    });
  },
};

export { InventoryService } from "./service.js";
export type {
  InventoryRow,
  MovementRow,
  MovementReason,
  ListInventoryQuery,
} from "./service.js";
