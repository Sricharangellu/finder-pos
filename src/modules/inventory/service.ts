import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";
import { clampLimit as clampCursorLimit, decodeCursor, toPage, type CursorPage } from "../../shared/pagination.js";

export type MovementReason = "receiving" | "sale" | "adjustment" | "return" | "cycle_count";

export interface InventoryLocation {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  code: string;
  name: string;
  location_type: string;
  is_sellable: boolean;
  is_receiving_location: boolean;
  is_damage_location: boolean;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface InventoryStock {
  id: string;
  tenant_id: string;
  location_id: string;
  product_id: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number;
  reorder_level: number;
  reorder_quantity: number;
  last_counted_at: number | null;
  updated_at: number;
}

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
  cursor?: string;
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

/** A received lot of a product with an expiry date (FEFO / shelf-life tracking). */
export interface InventoryLot {
  id: string;
  tenant_id: string;
  product_id: string;
  lot_code: string | null;
  expiry_date: number; // epoch ms
  qty_on_hand: number;
  unit_cost_cents: number | null;
  po_id: string | null;
  received_at: number;
}

export interface CycleCountSession {
  id: string;
  tenant_id: string;
  status: "open" | "closed";
  opened_by: string;
  opened_at: number;
  closed_at: number | null;
  note: string | null;
}

export interface CycleCountLine {
  id: string;
  tenant_id: string;
  session_id: string;
  product_id: string;
  expected_qty: number;
  counted_qty: number | null;
  variance: number | null;
  recorded_at: number | null;
}

export class InventoryService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  /** Record a received lot with an expiry date, then sync the product's expiry cache. */
  async createLot(
    input: { productId: string; expiryDate: number; quantity: number; lotCode?: string | null; unitCostCents?: number | null; poId?: string | null },
    tenantId: string,
  ): Promise<InventoryLot> {
    const now = Date.now();
    const lot: InventoryLot = {
      id: `lot_${uuidv7()}`,
      tenant_id: tenantId,
      product_id: input.productId,
      lot_code: input.lotCode ?? null,
      expiry_date: input.expiryDate,
      qty_on_hand: input.quantity,
      unit_cost_cents: input.unitCostCents ?? null,
      po_id: input.poId ?? null,
      received_at: now,
    };
    await this.db.query(
      `INSERT INTO inventory_lots (id, tenant_id, product_id, lot_code, expiry_date, qty_on_hand, unit_cost_cents, po_id, received_at)
       VALUES (@id,@tenant_id,@product_id,@lot_code,@expiry_date,@qty_on_hand,@unit_cost_cents,@po_id,@received_at)`,
      lot as unknown as Record<string, unknown>,
    );
    // Sync the denormalized expiry cache on the product row (soonest active lot).
    await this.syncProductExpiry(input.productId, tenantId);
    return lot;
  }

  /** Recompute products.expiry_date = MIN(expiry_date) across all active lots (qty > 0).
   *  NULL when no lots remain. Called after every lot creation and FEFO depletion. */
  async syncProductExpiry(productId: string, tenantId: string): Promise<void> {
    const row = await this.db.one<{ min_expiry: number | null }>(
      `SELECT MIN(expiry_date) AS min_expiry
         FROM inventory_lots
        WHERE tenant_id = @tenantId AND product_id = @productId AND qty_on_hand > 0`,
      { tenantId, productId },
    );
    await this.db.query(
      "UPDATE products SET expiry_date = @expiry, updated_at = @now WHERE id = @productId AND tenant_id = @tenantId",
      { expiry: row?.min_expiry ?? null, now: Date.now(), productId, tenantId },
    );
  }

  /** Reduce a specific lot's on-hand (e.g. damaged/expired write-off). Never negative. */
  async decrementLot(lotId: string, qty: number, tenantId: string): Promise<void> {
    const lot = await this.db.one<{ product_id: string }>(
      "SELECT product_id FROM inventory_lots WHERE id = @id AND tenant_id = @tenantId",
      { id: lotId, tenantId },
    );
    await this.db.query(
      "UPDATE inventory_lots SET qty_on_hand = GREATEST(0, qty_on_hand - @q) WHERE id = @id AND tenant_id = @tenantId",
      { q: Math.abs(qty), id: lotId, tenantId },
    );
    if (lot) await this.syncProductExpiry(lot.product_id, tenantId);
  }

  /** Open lots for a product (qty > 0), earliest expiry first (FEFO order). */
  async lots(productId: string, tenantId: string): Promise<InventoryLot[]> {
    return this.db.query<InventoryLot>(
      "SELECT * FROM inventory_lots WHERE tenant_id = @tenantId AND product_id = @productId AND qty_on_hand > 0 ORDER BY expiry_date ASC",
      { tenantId, productId },
    );
  }

  /** Deplete a product's lots earliest-expiry-first (FEFO) by `qty` when it sells.
   *  No-op for products without tracked lots. Returns the quantity actually drawn from lots. */
  async depleteFefo(productId: string, qty: number, tenantId: string): Promise<number> {
    let remaining = Math.abs(qty);
    if (remaining <= 0) return 0;
    const drawn = await this.db.withTenant(tenantId).tx(async (tdb) => {
      const lots = await tdb.query<{ id: string; qty_on_hand: number }>(
        "SELECT id, qty_on_hand FROM inventory_lots WHERE tenant_id = @tenantId AND product_id = @productId AND qty_on_hand > 0 ORDER BY expiry_date ASC FOR UPDATE",
        { tenantId, productId },
      );
      let d = 0;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(Number(lot.qty_on_hand), remaining);
        await tdb.query("UPDATE inventory_lots SET qty_on_hand = qty_on_hand - @take WHERE id = @id AND tenant_id = @tenantId", { take, id: lot.id, tenantId });
        remaining -= take;
        d += take;
      }
      return d;
    });
    // Sync product expiry cache after lots change (soonest lot may now be a newer batch).
    if (drawn > 0) await this.syncProductExpiry(productId, tenantId);
    return drawn;
  }

  /** Lots already past their expiry date but still on hand (must be pulled). */
  async expired(tenantId: string): Promise<Array<InventoryLot & { name: string; days_overdue: number }>> {
    const now = Date.now();
    const rows = await this.db.query<InventoryLot & { name: string }>(
      `SELECT l.*, p.name FROM inventory_lots l
         JOIN products p ON p.id = l.product_id AND p.tenant_id = l.tenant_id
        WHERE l.tenant_id = @tenantId AND l.qty_on_hand > 0 AND l.expiry_date < @now
        ORDER BY l.expiry_date ASC LIMIT 500`,
      { tenantId, now },
    );
    return rows.map((r) => ({ ...r, days_overdue: Math.floor((now - Number(r.expiry_date)) / 86_400_000) }));
  }

  /** Expiry value-at-risk: counts + cost value of expired and soon-to-expire stock. */
  async expirySummary(tenantId: string, soonDays = 30): Promise<{
    expired: { lots: number; units: number; valueCents: number };
    expiringSoon: { lots: number; units: number; valueCents: number; withinDays: number };
  }> {
    const now = Date.now();
    const soon = now + soonDays * 86_400_000;
    const agg = async (where: string, params: Record<string, unknown>) =>
      this.db.one<{ lots: number; units: number; value: number }>(
        `SELECT COUNT(*)::int AS lots, COALESCE(SUM(qty_on_hand),0) AS units,
                COALESCE(SUM(qty_on_hand * COALESCE(unit_cost_cents,0)),0) AS value
           FROM inventory_lots WHERE tenant_id = @tenantId AND qty_on_hand > 0 AND ${where}`,
        { tenantId, ...params },
      );
    const ex = await agg("expiry_date < @now", { now });
    const so = await agg("expiry_date >= @now AND expiry_date <= @soon", { now, soon });
    return {
      expired: { lots: Number(ex?.lots ?? 0), units: Number(ex?.units ?? 0), valueCents: Number(ex?.value ?? 0) },
      expiringSoon: { lots: Number(so?.lots ?? 0), units: Number(so?.units ?? 0), valueCents: Number(so?.value ?? 0), withinDays: soonDays },
    };
  }

  /** Lots expiring within `days` (qty > 0), with product name — the near-expiry report. */
  async expiring(days: number, tenantId: string): Promise<Array<InventoryLot & { name: string; days_to_expiry: number }>> {
    const cutoff = Date.now() + Math.max(0, days) * 86_400_000;
    const rows = await this.db.query<InventoryLot & { name: string }>(
      `SELECT l.*, p.name
         FROM inventory_lots l
         JOIN products p ON p.id = l.product_id AND p.tenant_id = l.tenant_id
        WHERE l.tenant_id = @tenantId AND l.qty_on_hand > 0 AND l.expiry_date <= @cutoff
        ORDER BY l.expiry_date ASC
        LIMIT 500`,
      { tenantId, cutoff },
    );
    const now = Date.now();
    return rows.map((r) => ({ ...r, days_to_expiry: Math.floor((Number(r.expiry_date) - now) / 86_400_000) }));
  }

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
    query: { query?: string; category?: string; status?: string; pageSize?: number; lowStock?: boolean; cursor?: string },
    tenantId: string,
  ): Promise<{ items: InventoryLevel[]; pageSize: number; nextCursor: string | null }> {
    const where: string[] = ["p.tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.category) { where.push("p.category = @category"); params["category"] = query.category; }
    if (query.status) { where.push("p.status = @status"); params["status"] = query.status; }
    if (query.query) {
      where.push("(p.name ILIKE @q OR p.sku ILIKE @q)");
      params["q"] = `%${query.query}%`;
    }
    if (query.lowStock) {
      // at or below a set reorder point (reorder point of 0 = untracked, excluded)
      where.push("COALESCE(i.reorder_pt, 0) > 0 AND COALESCE(i.stock_qty, 0) <= COALESCE(i.reorder_pt, 0)");
    }
    const cur = query.cursor
      ? (JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { name: string; id: string })
      : null;
    if (cur) {
      // ASC name order: next page starts after (name, id) of last item.
      where.push("(p.name, p.id) > (@curName, @curId)");
      params["curName"] = cur.name;
      params["curId"] = cur.id;
    }
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);
    params["limit"] = pageSize;
    const rows = await this.db.query<{
      id: string; sku: string; name: string; category: string; status: string;
      price_cents: number; stock_qty: number; reorder_pt: number; cost_cents: number | null;
      committed: number;
    }>(
      `SELECT p.id, p.sku, p.name, p.category, p.status, p.price_cents,
              COALESCE(i.stock_qty, 0) AS stock_qty, COALESCE(i.reorder_pt, 0) AS reorder_pt,
              pc.cost_cents AS cost_cents,
              COALESCE(res.committed, 0) AS committed
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.tenant_id = p.tenant_id
         LEFT JOIN product_costs pc ON pc.product_id = p.id AND pc.tenant_id = p.tenant_id
         LEFT JOIN (
           SELECT ol.product_id, SUM(ol.quantity) AS committed
             FROM order_lines ol
             JOIN orders o ON o.id = ol.order_id
            WHERE o.tenant_id = @tenantId
              AND o.status NOT IN ('completed', 'voided', 'refunded')
            GROUP BY ol.product_id
         ) res ON res.product_id = p.id
        WHERE ${where.join(" AND ")}
        ORDER BY p.name ASC, p.id ASC
        LIMIT @limit`,
      params,
    );
    const items: InventoryLevel[] = rows.map((r) => {
      const onHand = Number(r.stock_qty);
      const committed = Number(r.committed);
      const reorderPoint = Number(r.reorder_pt);
      return {
        id: r.id, sku: r.sku, name: r.name, category: r.category, status: r.status,
        priceCents: Number(r.price_cents),
        onHand,
        committed,
        available: Math.max(0, onHand - committed),
        reorderPoint,
        lowStock: reorderPoint > 0 && onHand <= reorderPoint,
        costCents: r.cost_cents == null ? null : Number(r.cost_cents),
        velocity: 0,
      };
    });
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === pageSize && last
        ? Buffer.from(JSON.stringify({ name: last.name, id: last.id })).toString("base64url")
        : null;
    return { items, pageSize, nextCursor };
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

  /**
   * Availability breakdown (retail product benchmark #2). A read-model over
   * state other modules already maintain — no new writes:
   *   onHand   — inventory.stock_qty
   *   reserved — quantity on approved sales orders not yet shipped
   *              (fulfillment unfulfilled/picking/packed; shipping deducts stock at ship)
   *   incoming — open remainder (qty - received) on approved, undelivered PO lines
   *   available = onHand - reserved (floored at 0)
   */
  async availability(productId: string, tenantId: string): Promise<{
    on_hand: number; reserved: number; incoming: number; available: number;
  }> {
    const stock = await this.getStock(productId, tenantId);
    const reservedRow = await this.db.one<{ n: number }>(
      `SELECT COALESCE(SUM(l.quantity), 0)::int AS n
         FROM sales_order_lines l
         JOIN sales_orders so ON so.id = l.sales_order_id AND so.tenant_id = l.tenant_id
        WHERE l.tenant_id = @t AND l.product_id = @p
          AND so.status = 'approved'
          AND so.fulfillment_status IN ('unfulfilled', 'picking', 'packed')`,
      { t: tenantId, p: productId },
    );
    const incomingRow = await this.db.one<{ n: number }>(
      `SELECT COALESCE(SUM(GREATEST(l.quantity - COALESCE(l.received_qty, 0), 0)), 0)::int AS n
         FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.po_id AND po.tenant_id = l.tenant_id
        WHERE l.tenant_id = @t AND l.product_id = @p
          AND po.status IN ('ordered', 'partially_received')
          AND po.approval_status = 'approved'`,
      { t: tenantId, p: productId },
    );
    const onHand = Number(stock.stock_qty ?? 0);
    const reserved = Number(reservedRow?.n ?? 0);
    const incoming = Number(incomingRow?.n ?? 0);
    return { on_hand: onHand, reserved, incoming, available: Math.max(0, onHand - reserved) };
  }

  async getReorderSuggestions(tenantId: string): Promise<ReorderSuggestion[]> {
    const rows = await this.db.query<{
      product_id: string; name: string; sku: string | null;
      stock_qty: number; reorder_pt: number; reorder_quantity: number;
      preferred_vendor_id: string | null; preferred_vendor_name: string | null;
    }>(
      `SELECT i.product_id,
              COALESCE(p.name, '') AS name,
              p.sku,
              COALESCE(i.stock_qty, 0) AS stock_qty,
              i.reorder_pt,
              COALESCE(p.reorder_quantity, 0) AS reorder_quantity,
              p.preferred_vendor_id,
              p.preferred_vendor_name
         FROM inventory i
         JOIN catalog_products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
        WHERE i.tenant_id = @tenantId
          AND i.reorder_pt > 0
          AND COALESCE(i.stock_qty, 0) <= i.reorder_pt
        ORDER BY p.preferred_vendor_name NULLS LAST, p.name`,
      { tenantId },
    );
    return rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.name,
      sku: r.sku,
      stock_qty: Number(r.stock_qty),
      reorder_pt: Number(r.reorder_pt),
      suggested_qty: Number(r.reorder_quantity) > 0 ? Number(r.reorder_quantity) : Number(r.reorder_pt),
      preferred_vendor_id: r.preferred_vendor_id,
      preferred_vendor_name: r.preferred_vendor_name,
    }));
  }

  async setReorderPoint(productId: string, reorderPt: number, tenantId: string): Promise<InventoryRow> {
    return this.db.withTenant(tenantId).tx(async (tdb) => {
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
    const result = await this.db.withTenant(tenantId).tx((tdb) =>
      this.adjustTx(tdb, productId, delta, reason, tenantId, ref),
    );
    // Publish AFTER commit so subscribers (outbox) observe a durable change.
    await this.events.publish(
      "inventory.adjusted",
      { productId, delta: result.appliedDelta, reason, stockQty: result.nextQty },
      productId,
    );
    return result.row;
  }

  /**
   * Product-level stock adjust against a caller-supplied transaction handle, so
   * multi-step operations (cycle-count close) apply many adjustments atomically
   * in ONE tx. Does NOT publish the event — the caller publishes after commit.
   */
  private async adjustTx(
    tdb: DB,
    productId: string,
    delta: number,
    reason: MovementReason,
    tenantId: string,
    ref?: string,
  ): Promise<{ row: InventoryRow; appliedDelta: number; nextQty: number }> {
    const now = Date.now();
    // FOR UPDATE locks the stock row so concurrent adjusts on the same product
    // serialize — otherwise this is a read-modify-write race (lost update →
    // oversell). Mirrors the FEFO lot path.
    const existing = await tdb.one<InventoryRow>(
      "SELECT * FROM inventory WHERE tenant_id = @tenantId AND product_id = @productId FOR UPDATE",
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
    } else if (delta >= 0) {
      // Only create an inventory row when adding stock (receiving). Sales on
      // untracked products don't create a row — they pass through the
      // reservation check silently (untracked = unlimited).
      // ON CONFLICT covers the first-receive race: if a concurrent tx created
      // the row between our (unlocked, absent) read and this insert, add our
      // delta to the committed value instead of failing on the PK.
      await tdb.query(
        `INSERT INTO inventory (product_id, tenant_id, stock_qty, reorder_pt, updated_at)
         VALUES (@product_id, @tenant_id, @stock_qty, @reorder_pt, @updated_at)
         ON CONFLICT (tenant_id, product_id)
         DO UPDATE SET stock_qty = GREATEST(0, inventory.stock_qty + @delta), updated_at = @updated_at`,
        { product_id: productId, tenant_id: tenantId, stock_qty: nextQty, reorder_pt: reorderPt, updated_at: now, delta },
      );
    } else {
      // Negative delta on untracked product: skip row creation, record movement only.
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
  }

  async list(query: ListInventoryQuery = {}, tenantId: string): Promise<{ items: InventoryRow[]; nextCursor: string | null; limit: number }> {
    const limit = clampLimit(query.limit);
    const where: string[] = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };

    // Low-stock means at/below a SET reorder point. A reorder point of 0 means
    // "untracked" (consistent with overview() and levels()), so those products
    // are excluded rather than flagging every zero-stock untracked item as low.
    if (query.lowStock) where.push("reorder_pt > 0 AND stock_qty <= reorder_pt");

    if (query.cursor) {
      const cur = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { at: number; id: string };
      where.push("(updated_at < @curAt OR (updated_at = @curAt AND product_id < @curId))");
      params.curAt = cur.at;
      params.curId = cur.id;
    }

    const items = await this.db.query<InventoryRow>(
      `SELECT * FROM inventory WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, product_id DESC
       LIMIT @limit`,
      { ...params, limit },
    );

    const last = items.at(-1);
    const nextCursor =
      items.length === limit && last
        ? Buffer.from(JSON.stringify({ at: last.updated_at, id: last.product_id })).toString("base64url")
        : null;

    return { items, nextCursor, limit };
  }

  /** Movement history for a product — keyset-paginated (the table is
   *  append-only and unbounded; fetching everything was a scan). */
  async movements(
    productId: string,
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<CursorPage<MovementRow>> {
    const limit = clampCursorLimit(opts.limit, 50, 200);
    const cur = decodeCursor(opts.cursor);
    const rows = await this.db.query<MovementRow>(
      `SELECT * FROM inventory_movements
       WHERE tenant_id = @tenantId AND product_id = @productId
       ${cur ? "AND (created_at, id) < (@curAt, @curId)" : ""}
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`,
      { tenantId, productId, limit, ...(cur ? { curAt: cur.at, curId: cur.id } : {}) },
    );
    return toPage(rows as unknown as Array<MovementRow & Record<string, unknown>>, limit, "created_at") as CursorPage<MovementRow>;
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

  // ── BE-10: Cycle count sessions ────────────────────────────────────────────

  async openCycleCount(openedBy: string, tenantId: string, note?: string): Promise<CycleCountSession> {
    const existing = await this.db.one<CycleCountSession>(
      "SELECT id FROM cycle_count_sessions WHERE tenant_id = @t AND status = 'open' LIMIT 1",
      { t: tenantId },
    );
    if (existing) throw new HttpError(409, "conflict", "An open cycle count session already exists. Close it before opening a new one.");

    const now = Date.now();
    // Snapshot current expected quantities from the inventory table.
    const levels = await this.db.query<{ product_id: string; stock_qty: number }>(
      "SELECT product_id, stock_qty FROM inventory WHERE tenant_id = @t",
      { t: tenantId },
    );
    const session: CycleCountSession = {
      id: `ccs_${uuidv7()}`, tenant_id: tenantId, status: "open",
      opened_by: openedBy, opened_at: now, closed_at: null, note: note ?? null,
    };
    await this.db.query(
      "INSERT INTO cycle_count_sessions (id, tenant_id, status, opened_by, opened_at, note) VALUES (@id,@tenant_id,@status,@opened_by,@opened_at,@note)",
      session as unknown as Record<string, unknown>,
    );
    for (const level of levels) {
      await this.db.query(
        "INSERT INTO cycle_count_lines (id, tenant_id, session_id, product_id, expected_qty) VALUES (@id,@t,@sid,@pid,@eq)",
        { id: `ccl_${uuidv7()}`, t: tenantId, sid: session.id, pid: level.product_id, eq: level.stock_qty },
      );
    }
    return session;
  }

  async recordCycleCountLine(sessionId: string, productId: string, countedQty: number, tenantId: string): Promise<CycleCountLine> {
    const session = await this.db.one<CycleCountSession>(
      "SELECT * FROM cycle_count_sessions WHERE id = @id AND tenant_id = @t",
      { id: sessionId, t: tenantId },
    );
    if (!session) throw new HttpError(404, "not_found", `cycle count session '${sessionId}' not found`);
    if (session.status !== "open") throw new HttpError(409, "conflict", "session is already closed");

    let line = await this.db.one<CycleCountLine>(
      "SELECT * FROM cycle_count_lines WHERE session_id = @sid AND product_id = @pid AND tenant_id = @t",
      { sid: sessionId, pid: productId, t: tenantId },
    );
    const now = Date.now();
    if (line) {
      const variance = countedQty - Number(line.expected_qty);
      await this.db.query(
        "UPDATE cycle_count_lines SET counted_qty = @cq, variance = @v, recorded_at = @now WHERE id = @id AND tenant_id = @t",
        { cq: countedQty, v: variance, now, id: line.id, t: tenantId },
      );
      return { ...line, counted_qty: countedQty, variance, recorded_at: now };
    } else {
      // Product not in the initial snapshot (added after open) — create a line.
      line = {
        id: `ccl_${uuidv7()}`, tenant_id: tenantId, session_id: sessionId,
        product_id: productId, expected_qty: 0, counted_qty: countedQty,
        variance: countedQty, recorded_at: now,
      };
      await this.db.query(
        "INSERT INTO cycle_count_lines (id, tenant_id, session_id, product_id, expected_qty, counted_qty, variance, recorded_at) VALUES (@id,@tenant_id,@session_id,@product_id,@expected_qty,@counted_qty,@variance,@recorded_at)",
        line as unknown as Record<string, unknown>,
      );
      return line;
    }
  }

  async closeCycleCount(sessionId: string, tenantId: string): Promise<{ session: CycleCountSession; adjustments: number }> {
    // The whole close is ONE transaction, and the session row is locked
    // FOR UPDATE up front. Previously the open-check, the variance adjustments,
    // and the status flip were separate statements: two concurrent closes both
    // passed the open-check and applied EVERY variance twice (stock
    // double-counted), and a mid-loop crash + retry double-posted too. With the
    // lock, a second concurrent close blocks, then sees 'closed' and 409s — the
    // adjustments apply exactly once.
    const { session, applied } = await this.db.withTenant(tenantId).tx(async (tdb) => {
      const session = await tdb.one<CycleCountSession>(
        "SELECT * FROM cycle_count_sessions WHERE id = @id AND tenant_id = @t FOR UPDATE",
        { id: sessionId, t: tenantId },
      );
      if (!session) throw new HttpError(404, "not_found", `cycle count session '${sessionId}' not found`);
      if (session.status !== "open") throw new HttpError(409, "conflict", "session is already closed");

      const lines = await tdb.query<CycleCountLine>(
        "SELECT * FROM cycle_count_lines WHERE session_id = @sid AND tenant_id = @t AND counted_qty IS NOT NULL AND variance != 0",
        { sid: sessionId, t: tenantId },
      );

      const applied: Array<{ productId: string; appliedDelta: number; nextQty: number }> = [];
      for (const line of lines) {
        if (line.variance === null || line.variance === 0) continue;
        const r = await this.adjustTx(tdb, line.product_id, line.variance, "cycle_count", tenantId, sessionId);
        applied.push({ productId: line.product_id, appliedDelta: r.appliedDelta, nextQty: r.nextQty });
      }

      const now = Date.now();
      await tdb.query(
        "UPDATE cycle_count_sessions SET status = 'closed', closed_at = @now WHERE id = @id AND tenant_id = @t",
        { now, id: sessionId, t: tenantId },
      );
      return { session: { ...session, status: "closed" as const, closed_at: now }, applied };
    });

    // Publish AFTER commit (preserves adjust()'s ordering for subscribers).
    for (const a of applied) {
      await this.events.publish(
        "inventory.adjusted",
        { productId: a.productId, delta: a.appliedDelta, reason: "cycle_count", stockQty: a.nextQty },
        a.productId,
      );
    }
    return { session, adjustments: applied.length };
  }

  async listCycleCounts(tenantId: string): Promise<CycleCountSession[]> {
    return this.db.query<CycleCountSession>(
      "SELECT * FROM cycle_count_sessions WHERE tenant_id = @t ORDER BY opened_at DESC LIMIT 50",
      { t: tenantId },
    );
  }

  async getCycleCountLines(sessionId: string, tenantId: string): Promise<CycleCountLine[]> {
    return this.db.query<CycleCountLine>(
      "SELECT * FROM cycle_count_lines WHERE session_id = @sid AND tenant_id = @t ORDER BY product_id",
      { sid: sessionId, t: tenantId },
    );
  }

  // ── Inventory Locations ────────────────────────────────────────────────────

  async listLocations(tenantId: string): Promise<InventoryLocation[]> {
    return this.db.query<InventoryLocation>(
      "SELECT * FROM inventory_locations WHERE tenant_id = @tenantId AND is_active = true ORDER BY code ASC",
      { tenantId },
    );
  }

  async createLocation(
    tenantId: string,
    input: { code: string; name: string; outletId?: string | null; locationType?: string },
  ): Promise<InventoryLocation> {
    const now = Date.now();
    const loc: InventoryLocation = {
      id: `iloc_${uuidv7()}`,
      tenant_id: tenantId,
      outlet_id: input.outletId ?? null,
      code: input.code,
      name: input.name,
      location_type: input.locationType ?? "floor",
      is_sellable: true,
      is_receiving_location: true,
      is_damage_location: false,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO inventory_locations (id, tenant_id, outlet_id, code, name, location_type, is_sellable, is_receiving_location, is_damage_location, is_active, created_at, updated_at)
       VALUES (@id, @tenant_id, @outlet_id, @code, @name, @location_type, @is_sellable, @is_receiving_location, @is_damage_location, @is_active, @created_at, @updated_at)`,
      loc as unknown as Record<string, unknown>,
    );
    return loc;
  }

  async getStockByLocation(tenantId: string, locationId: string): Promise<InventoryStock[]> {
    return this.db.query<InventoryStock>(
      "SELECT * FROM inventory_stock WHERE tenant_id = @tenantId AND location_id = @locationId ORDER BY product_id ASC",
      { tenantId, locationId },
    );
  }

  async adjustStock(
    tenantId: string,
    locationId: string,
    productId: string,
    delta: number,
    reason: MovementReason,
    ref?: string,
  ): Promise<InventoryStock> {
    return this.db.withTenant(tenantId).tx((tdb) =>
      this.adjustStockTx(tdb, tenantId, locationId, productId, delta, reason, ref),
    );
  }

  /**
   * Location-stock adjust against a caller-supplied transaction handle, so
   * multi-leg operations (transfers) run atomically in ONE tx. FOR UPDATE locks
   * the stock row so concurrent adjusts on the same (location, product)
   * serialize (same read-modify-write race fixed on the product-level path).
   */
  private async adjustStockTx(
    tdb: DB,
    tenantId: string,
    locationId: string,
    productId: string,
    delta: number,
    reason: MovementReason,
    ref?: string,
  ): Promise<InventoryStock> {
    const now = Date.now();
    const existing = await tdb.one<InventoryStock>(
      "SELECT * FROM inventory_stock WHERE tenant_id = @tenantId AND location_id = @locationId AND product_id = @productId FOR UPDATE",
      { tenantId, locationId, productId },
    );
    if (existing) {
      const nextQty = Math.max(0, Number(existing.quantity_on_hand) + delta);
      await tdb.query(
        "UPDATE inventory_stock SET quantity_on_hand = @qty, updated_at = @now WHERE tenant_id = @tenantId AND location_id = @locationId AND product_id = @productId",
        { qty: nextQty, now, tenantId, locationId, productId },
      );
    } else {
      const initQty = Math.max(0, delta);
      // inventory_stock has a composite PK (tenant_id, location_id, product_id) — no id column.
      await tdb.query(
        `INSERT INTO inventory_stock (tenant_id, location_id, product_id, quantity_on_hand, quantity_committed, average_cost_cents, reorder_level, reorder_quantity, updated_at)
         VALUES (@tenantId, @locationId, @productId, @qty, 0, 0, 0, 0, @now)`,
        { tenantId, locationId, productId, qty: initQty, now },
      );
    }
    await tdb.query(
      `INSERT INTO inventory_movements (id, tenant_id, product_id, delta, reason, ref, created_at)
       VALUES (@id, @tenantId, @productId, @delta, @reason, @ref, @now)`,
      { id: `mov_${uuidv7()}`, tenantId, productId, delta, reason, ref: ref ?? null, now },
    );
    return (await tdb.one<InventoryStock>(
      "SELECT * FROM inventory_stock WHERE tenant_id = @tenantId AND location_id = @locationId AND product_id = @productId",
      { tenantId, locationId, productId },
    ))!;
  }

  // ── Location-to-location transfers ─────────────────────────────────────────

  async listTransfers(tenantId: string): Promise<InventoryTransferView[]> {
    return this.db.query<InventoryTransferView>(
      `SELECT t.id, t.transfer_number, t.status, t.quantity AS qty, t.note, t.created_at, t.due_date,
              t.product_id,
              COALESCE(fl.name, t.from_location_id) AS from_location,
              COALESCE(tl.name, t.to_location_id)   AS to_location
         FROM inventory_transfers t
         LEFT JOIN inventory_locations fl ON fl.tenant_id = t.tenant_id AND fl.id = t.from_location_id
         LEFT JOIN inventory_locations tl ON tl.tenant_id = t.tenant_id AND tl.id = t.to_location_id
        WHERE t.tenant_id = @tenantId
        ORDER BY t.created_at DESC
        LIMIT 200`,
      { tenantId },
    );
  }

  async createTransfer(
    tenantId: string,
    input: { fromLocationId: string; toLocationId: string; productId: string; quantity: number; note?: string | null },
  ): Promise<InventoryTransfer> {
    if (input.fromLocationId === input.toLocationId) {
      throw new HttpError(400, "validation", "from and to locations must differ");
    }
    const now = Date.now();
    const id = `xfr_${uuidv7()}`;

    // The two stock legs AND the transfer record commit together in ONE
    // transaction. Previously they were three independent statements, so a
    // crash/error between the source debit and the destination credit lost
    // stock (left the source, never arrived). FOR UPDATE (in adjustStockTx)
    // also serializes concurrent adjusts on each leg.
    return this.db.withTenant(tenantId).tx(async (tdb) => {
      // NOTE: transfer_number still uses COUNT(*)+1 (racy — can duplicate under
      // concurrency). transfer_number is non-unique so this is cosmetic; the
      // race-free doc-counter swap needs max-seeding and is a tracked follow-up.
      const countRow = await tdb.one<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM inventory_transfers WHERE tenant_id = @tenantId",
        { tenantId },
      );
      const transferNumber = `TRF-${String((countRow?.n ?? 0) + 1).padStart(4, "0")}`;

      // Move stock: out of the source location, into the destination. Both legs
      // land in the movement ledger with the transfer id as the reference.
      await this.adjustStockTx(tdb, tenantId, input.fromLocationId, input.productId, -input.quantity, "adjustment", id);
      await this.adjustStockTx(tdb, tenantId, input.toLocationId, input.productId, input.quantity, "adjustment", id);

      const row: InventoryTransfer = {
        id,
        tenant_id: tenantId,
        transfer_number: transferNumber,
        from_location_id: input.fromLocationId,
        to_location_id: input.toLocationId,
        product_id: input.productId,
        quantity: input.quantity,
        status: "completed",
        note: input.note ?? null,
        created_at: now,
        due_date: null,
      };
      await tdb.query(
        `INSERT INTO inventory_transfers (id, tenant_id, transfer_number, from_location_id, to_location_id, product_id, quantity, status, note, created_at, due_date)
         VALUES (@id, @tenant_id, @transfer_number, @from_location_id, @to_location_id, @product_id, @quantity, @status, @note, @created_at, @due_date)`,
        row as unknown as Record<string, unknown>,
      );
      return row;
    });
  }

  /** Mode-aware manual stock correction at a location (add | remove | set). */
  async adjustAtLocation(
    tenantId: string,
    input: { productId: string; locationId: string; delta: number; mode?: "add" | "remove" | "set"; ref?: string },
  ): Promise<{ actualDelta: number; stock: InventoryStock }> {
    const current = await this.db.one<InventoryStock>(
      "SELECT * FROM inventory_stock WHERE tenant_id = @tenantId AND location_id = @locationId AND product_id = @productId",
      { tenantId, locationId: input.locationId, productId: input.productId },
    );
    const onHand = Number(current?.quantity_on_hand ?? 0);
    let actualDelta = input.delta;
    if (input.mode === "set") actualDelta = input.delta - onHand;
    else if (input.mode === "remove") actualDelta = -Math.abs(input.delta);
    if (actualDelta === 0) {
      throw new HttpError(400, "validation", "adjustment is a no-op (delta resolves to zero)");
    }
    const stock = await this.adjustStock(tenantId, input.locationId, input.productId, actualDelta, "adjustment", input.ref);
    return { actualDelta, stock };
  }
}

export interface InventoryTransfer {
  id: string;
  tenant_id: string;
  transfer_number: string;
  from_location_id: string;
  to_location_id: string;
  product_id: string;
  quantity: number;
  status: string;
  note: string | null;
  created_at: number;
  due_date: number | null;
}

export interface InventoryTransferView {
  id: string;
  transfer_number: string;
  from_location: string;
  to_location: string;
  product_id: string;
  status: string;
  qty: number;
  note: string | null;
  created_at: number;
  due_date: number | null;
}

export interface ReorderSuggestion {
  product_id: string;
  product_name: string;
  sku: string | null;
  stock_qty: number;
  reorder_pt: number;
  suggested_qty: number;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}
