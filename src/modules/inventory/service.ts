import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Page } from "../../shared/types.js";

export type MovementReason = "receiving" | "sale" | "adjustment" | "return";

export interface InventoryRow {
  product_id: string;
  tenant_id: string;
  stock_qty: number;
  reorder_pt: number;
  updated_at: number;
}

export interface MovementRow {
  id: string;
  tenant_id: string;
  product_id: string;
  delta: number;
  reason: MovementReason;
  ref: string | null;
  created_at: number;
}

export interface ListInventoryQuery {
  lowStock?: boolean;
  limit?: number;
  offset?: number;
}

/** Inventory level row in the shape the frontend requested. */
export interface InventoryLevel {
  id: string;
  sku: string;
  name: string;
  category: string;
  status: string;
  priceCents: number;
  onHand: number;
  committed: number;
  available: number;
  reorderPoint: number;
  lowStock: boolean;
  costCents: number | null;
  velocity: number;
}

/** Product joined with its stock — the row an inventory management grid renders. */
export interface ProductStock {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  category: string;
  status: string;
  stock_qty: number;
  reorder_pt: number;
  low_stock: boolean;
}

export class InventoryService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  /**
   * Inventory overview: every product joined with its on-hand stock + reorder
   * point (a CQRS-lite read over the shared products + inventory tables).
   * Tenant-scoped. Powers the inventory management grid.
   */
  async overview(tenantId: string): Promise<ProductStock[]> {
    const rows = await this.db.query<ProductStock & { stock_qty: number; reorder_pt: number }>(
      `SELECT p.id, p.sku, p.name, p.price_cents, p.category, p.status,
              COALESCE(i.stock_qty, 0) AS stock_qty,
              COALESCE(i.reorder_pt, 0) AS reorder_pt
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.tenant_id = p.tenant_id
        WHERE p.tenant_id = @tenantId
        ORDER BY p.name ASC
        LIMIT 500`,
      { tenantId },
    );
    return rows.map((r) => ({
      ...r,
      stock_qty: Number(r.stock_qty),
      reorder_pt: Number(r.reorder_pt),
      low_stock: Number(r.reorder_pt) > 0 && Number(r.stock_qty) <= Number(r.reorder_pt),
    }));
  }

  /**
   * Inventory levels — the shape the frontend (Codex) requested for the
   * `/inventory` operations screen: product identity + onHand/committed/
   * reorderPoint/costCents/velocity/status, with search + filters.
   * `committed`, `costCents`, `velocity` are 0/null until reservations, cost
   * tracking, and sales-velocity analytics land (documented stubs, not fabricated).
   */
  async levels(
    query: { query?: string; category?: string; status?: string; pageSize?: number },
    tenantId: string,
  ): Promise<{ items: InventoryLevel[]; pageSize: number }> {
    const where: string[] = ["p.tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.category) { where.push("p.category = @category"); params["category"] = query.category; }
    if (query.status) { where.push("p.status = @status"); params["status"] = query.status; }
    if (query.query) {
      where.push("(p.name ILIKE @q OR p.sku ILIKE @q)");
      params["q"] = `%${query.query}%`;
    }
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);
    params["limit"] = pageSize;
    const rows = await this.db.query<{
      id: string; sku: string; name: string; category: string; status: string;
      price_cents: number; stock_qty: number; reorder_pt: number;
    }>(
      `SELECT p.id, p.sku, p.name, p.category, p.status, p.price_cents,
              COALESCE(i.stock_qty, 0) AS stock_qty, COALESCE(i.reorder_pt, 0) AS reorder_pt
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.tenant_id = p.tenant_id
        WHERE ${where.join(" AND ")}
        ORDER BY p.name ASC
        LIMIT @limit`,
      params,
    );
    const items: InventoryLevel[] = rows.map((r) => {
      const onHand = Number(r.stock_qty);
      const reorderPoint = Number(r.reorder_pt);
      return {
        id: r.id, sku: r.sku, name: r.name, category: r.category, status: r.status,
        priceCents: Number(r.price_cents),
        onHand,
        committed: 0,
        available: onHand,
        reorderPoint,
        lowStock: reorderPoint > 0 && onHand <= reorderPoint,
        costCents: null,
        velocity: 0,
      };
    });
    return { items, pageSize };
  }

  /**
   * Current stock for a product. Returns a zeroed row when no inventory row
   * exists yet (we treat "never stocked" as 0/0 rather than 404).
   */
  async getStock(productId: string, tenantId: string): Promise<InventoryRow> {
    const row = await this.db.one<InventoryRow>(
      "SELECT * FROM inventory WHERE tenant_id = @tenantId AND product_id = @productId",
      { tenantId, productId },
    );
    return row ?? { product_id: productId, tenant_id: tenantId, stock_qty: 0, reorder_pt: 0, updated_at: 0 };
  }

  async setReorderPoint(productId: string, reorderPt: number, tenantId: string): Promise<InventoryRow> {
    return this.db.tx(async (tdb) => {
      const now = Date.now();
      const existing = await tdb.one<InventoryRow>(
        "SELECT * FROM inventory WHERE tenant_id = @tenantId AND product_id = @productId",
        { tenantId, productId },
      );

      if (existing) {
        await tdb.query(
          "UPDATE inventory SET reorder_pt = @reorder_pt, updated_at = @updated_at WHERE tenant_id = @tenant_id AND product_id = @product_id",
          { tenant_id: tenantId, product_id: productId, reorder_pt: reorderPt, updated_at: now },
        );
      } else {
        await tdb.query(
          "INSERT INTO inventory (product_id, tenant_id, stock_qty, reorder_pt, updated_at) VALUES (@product_id, @tenant_id, 0, @reorder_pt, @updated_at)",
          { product_id: productId, tenant_id: tenantId, reorder_pt: reorderPt, updated_at: now },
        );
      }

      return (await tdb.one<InventoryRow>(
        "SELECT * FROM inventory WHERE tenant_id = @tenantId AND product_id = @productId",
        { tenantId, productId },
      ))!;
    });
  }

  /**
   * Central stock mutation. Upserts the inventory row (creating it at 0 when
   * absent), applies `delta`, clamps stock at >= 0 (never negative), records a
   * movement row, bumps updated_at, and emits `inventory.adjusted`. All inside
   * a single transaction.
   */
  async adjust(
    productId: string,
    delta: number,
    reason: MovementReason,
    tenantId: string,
    ref?: string,
  ): Promise<InventoryRow> {
    const result = await this.db.tx(async (tdb) => {
      const now = Date.now();
      const existing = await tdb.one<InventoryRow>(
        "SELECT * FROM inventory WHERE tenant_id = @tenantId AND product_id = @productId",
        { tenantId, productId },
      );

      const currentQty = existing ? existing.stock_qty : 0;
      const reorderPt = existing ? existing.reorder_pt : 0;
      // Clamp at >= 0 so stock never goes negative.
      const nextQty = Math.max(0, currentQty + delta);
      // The movement ledger and event record the delta ACTUALLY applied, which
      // differs from the requested delta whenever the clamp floors stock at 0.
      const appliedDelta = nextQty - currentQty;

      if (existing) {
        await tdb.query(
          "UPDATE inventory SET stock_qty = @stock_qty, updated_at = @updated_at WHERE tenant_id = @tenant_id AND product_id = @product_id",
          { tenant_id: tenantId, product_id: productId, stock_qty: nextQty, updated_at: now },
        );
      } else {
        await tdb.query(
          "INSERT INTO inventory (product_id, tenant_id, stock_qty, reorder_pt, updated_at) VALUES (@product_id, @tenant_id, @stock_qty, @reorder_pt, @updated_at)",
          { product_id: productId, tenant_id: tenantId, stock_qty: nextQty, reorder_pt: reorderPt, updated_at: now },
        );
      }

      await tdb.query(
        `INSERT INTO inventory_movements (id, tenant_id, product_id, delta, reason, ref, created_at)
         VALUES (@id, @tenant_id, @product_id, @delta, @reason, @ref, @created_at)`,
        {
          id: `mov_${uuidv7()}`,
          tenant_id: tenantId,
          product_id: productId,
          delta: appliedDelta,
          reason,
          ref: ref ?? null,
          created_at: now,
        },
      );

      return {
        row: { product_id: productId, tenant_id: tenantId, stock_qty: nextQty, reorder_pt: reorderPt, updated_at: now },
        appliedDelta,
        nextQty,
      };
    });

    // Publish AFTER commit so subscribers (outbox) observe a durable change.
    await this.events.publish(
      "inventory.adjusted",
      { productId, delta: result.appliedDelta, reason, stockQty: result.nextQty },
      productId,
    );

    return result.row;
  }

  async list(query: ListInventoryQuery = {}, tenantId: string): Promise<Page<InventoryRow>> {
    const limit = clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? Math.floor(query.offset) : 0;

    const where: string[] = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.lowStock) where.push("stock_qty <= reorder_pt");
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const totalRow = await this.db.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM inventory ${whereSql}`,
      params,
    );
    const total = totalRow?.n ?? 0;

    const items = await this.db.query<InventoryRow>(
      `SELECT * FROM inventory ${whereSql}
       ORDER BY updated_at DESC, product_id DESC
       LIMIT @limit OFFSET @offset`,
      { ...params, limit, offset },
    );

    return { items, total, limit, offset };
  }

  async movements(productId: string, tenantId: string): Promise<MovementRow[]> {
    return this.db.query<MovementRow>(
      "SELECT * FROM inventory_movements WHERE tenant_id = @tenantId AND product_id = @productId ORDER BY created_at DESC, id DESC",
      { tenantId, productId },
    );
  }

  /**
   * Restock for a refund. The `order.refunded` event payload carries no line
   * data, so we reverse the 'sale' movements recorded for this order ref.
   * Idempotent: if a 'return' movement already exists for this order ref, no-op.
   */
  async restockFromOrderRef(orderId: string, tenantId: string): Promise<void> {
    const alreadyRow = await this.db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id = @tenantId AND ref = @orderId AND reason = 'return'",
      { tenantId, orderId },
    );
    if ((alreadyRow?.n ?? 0) > 0) return;

    const sales = await this.db.query<MovementRow>(
      "SELECT * FROM inventory_movements WHERE tenant_id = @tenantId AND ref = @orderId AND reason = 'sale' ORDER BY created_at ASC, id ASC",
      { tenantId, orderId },
    );

    for (const sale of sales) {
      // sale.delta was negative (e.g. -2); reverse it to restock (+2).
      await this.adjust(sale.product_id, -sale.delta, "return", tenantId, orderId);
    }
  }
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}
