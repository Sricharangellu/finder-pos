import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export type ProductionStatus = "draft" | "in_progress" | "completed" | "cancelled";

export interface BomLine {
  id: string;
  tenant_id: string;
  production_order_id: string;
  raw_material_id: string | null;
  raw_material_name: string | null;
  qty_required: number;
  qty_consumed: number;
  unit: string;
  created_at: number;
}

export interface ProductionOrder {
  id: string;
  tenant_id: string;
  product_id: string | null;
  quantity: number;
  status: ProductionStatus;
  notes: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  bom_lines?: BomLine[];
}

export type ManufacturingService = ReturnType<typeof manufacturingService>;

export function manufacturingService(db: DB, events: EventBus) {
  return {
    async listOrders(tenantId: string, status?: ProductionStatus): Promise<ProductionOrder[]> {
      const where = status
        ? "WHERE tenant_id = @t AND status = @status ORDER BY created_at DESC"
        : "WHERE tenant_id = @t ORDER BY created_at DESC";
      return db.query<ProductionOrder>(
        `SELECT * FROM production_orders ${where} LIMIT 200`,
        status ? { t: tenantId, status } : { t: tenantId },
      );
    },

    async createOrder(tenantId: string, input: {
      productId?: string;
      quantity: number;
      notes?: string;
      bomLines?: Array<{
        rawMaterialId?: string;
        rawMaterialName?: string;
        qtyRequired: number;
        unit?: string;
      }>;
    }): Promise<ProductionOrder> {
      const now = Date.now();
      const order: ProductionOrder = {
        id: `po_${uuidv7()}`,
        tenant_id: tenantId,
        product_id: input.productId ?? null,
        quantity: input.quantity,
        status: "draft",
        notes: input.notes ?? null,
        started_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
      };
      const bomLines: BomLine[] = (input.bomLines ?? []).map((bl) => ({
        id: `bom_${uuidv7()}`,
        tenant_id: tenantId,
        production_order_id: order.id,
        raw_material_id: bl.rawMaterialId ?? null,
        raw_material_name: bl.rawMaterialName ?? null,
        qty_required: bl.qtyRequired,
        qty_consumed: 0,
        unit: bl.unit ?? "units",
        created_at: now,
      }));
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO production_orders (id, tenant_id, product_id, quantity, status, notes, started_at, completed_at, created_at, updated_at)
           VALUES (@id, @tenant_id, @product_id, @quantity, @status, @notes, @started_at, @completed_at, @created_at, @updated_at)`,
          order as unknown as Record<string, unknown>,
        );
        for (const bl of bomLines) {
          await tdb.query(
            `INSERT INTO bom_lines (id, tenant_id, production_order_id, raw_material_id, raw_material_name, qty_required, qty_consumed, unit, created_at)
             VALUES (@id, @tenant_id, @production_order_id, @raw_material_id, @raw_material_name, @qty_required, @qty_consumed, @unit, @created_at)`,
            bl as unknown as Record<string, unknown>,
          );
        }
      });
      return { ...order, bom_lines: bomLines };
    },

    async getOrder(tenantId: string, id: string): Promise<ProductionOrder> {
      const order = await db.one<ProductionOrder>(
        "SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!order) throw notFound(`production_order '${id}'`);
      const bom_lines = await db.query<BomLine>(
        "SELECT * FROM bom_lines WHERE production_order_id = @id AND tenant_id = @t ORDER BY created_at",
        { id, t: tenantId },
      );
      return { ...order, bom_lines };
    },

    async startOrder(tenantId: string, id: string): Promise<ProductionOrder> {
      const order = await db.one<ProductionOrder>(
        "SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!order) throw notFound(`production_order '${id}'`);
      if (order.status !== "draft") throw new HttpError(409, "invalid_status", `Cannot start order in status '${order.status}'.`);
      const now = Date.now();
      await db.query(
        "UPDATE production_orders SET status = 'in_progress', started_at = @now, updated_at = @now WHERE id = @id AND tenant_id = @t",
        { now, id, t: tenantId },
      );
      void events.publish("manufacturing.order_started", { tenantId, orderId: id }, id);
      return { ...order, status: "in_progress", started_at: now, updated_at: now };
    },

    async completeOrder(tenantId: string, id: string, input: {
      actualQtyConsumed?: Array<{ bomLineId: string; qtyConsumed: number }>;
    }): Promise<ProductionOrder> {
      const order = await db.one<ProductionOrder>(
        "SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!order) throw notFound(`production_order '${id}'`);
      if (order.status !== "in_progress") throw new HttpError(409, "invalid_status", `Cannot complete order in status '${order.status}'.`);
      const now = Date.now();
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          "UPDATE production_orders SET status = 'completed', completed_at = @now, updated_at = @now WHERE id = @id AND tenant_id = @t",
          { now, id, t: tenantId },
        );
        for (const item of input.actualQtyConsumed ?? []) {
          await tdb.query(
            "UPDATE bom_lines SET qty_consumed = @qty WHERE id = @bomId AND production_order_id = @orderId AND tenant_id = @t",
            { qty: item.qtyConsumed, bomId: item.bomLineId, orderId: id, t: tenantId },
          );
        }
      });
      void events.publish("manufacturing.order_completed", { tenantId, orderId: id }, id);
      return { ...order, status: "completed", completed_at: now, updated_at: now };
    },

    async cancelOrder(tenantId: string, id: string): Promise<ProductionOrder> {
      const order = await db.one<ProductionOrder>(
        "SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!order) throw notFound(`production_order '${id}'`);
      if (order.status === "completed" || order.status === "cancelled") {
        throw new HttpError(409, "invalid_status", `Cannot cancel order in status '${order.status}'.`);
      }
      const now = Date.now();
      await db.query(
        "UPDATE production_orders SET status = 'cancelled', updated_at = @now WHERE id = @id AND tenant_id = @t",
        { now, id, t: tenantId },
      );
      void events.publish("manufacturing.order_cancelled", { tenantId, orderId: id }, id);
      return { ...order, status: "cancelled", updated_at: now };
    },

    async updateOrder(tenantId: string, id: string, input: Partial<{
      notes: string;
      quantity: number;
    }>): Promise<ProductionOrder> {
      const order = await db.one<ProductionOrder>(
        "SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!order) throw notFound(`production_order '${id}'`);
      const now = Date.now();
      const updated = { ...order, ...input, updated_at: now };
      await db.query(
        "UPDATE production_orders SET notes=@notes, quantity=@quantity, updated_at=@updated_at WHERE id=@id AND tenant_id=@tenant_id",
        { notes: updated.notes, quantity: updated.quantity, updated_at: now, id, tenant_id: tenantId },
      );
      return updated;
    },
  };
}
