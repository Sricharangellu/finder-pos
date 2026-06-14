import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound, conflict } from "../../shared/http.js";

/**
 * Shipping module — shipping orders generated from invoices (ERP benchmark #8).
 *
 * A shipping order is created from an invoice; its lines are resolved from the
 * invoice's linked order (if any). It moves pending_shipment → shipped →
 * delivered, carrying carrier + tracking, and individual lines can be marked
 * packed (packing slip). Tenant-scoped.
 */

export type ShipStatus = "pending_shipment" | "shipped" | "delivered" | "cancelled";
export type ShipMethod = "delivery" | "pickup";

export interface ShippingOrder {
  id: string;
  tenant_id: string;
  ship_number: string;
  invoice_id: string;
  customer_id: string;
  status: ShipStatus;
  method: ShipMethod;
  carrier: string | null;
  tracking_number: string | null;
  expected_date: number | null;
  shipped_date: number | null;
  delivered_date: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface ShippingLine {
  id: string;
  tenant_id: string;
  shipping_order_id: string;
  product_id: string;
  name: string;
  quantity: number;
  packed: number; // 1|0
}

export interface CreateShipmentInput {
  invoiceId: string;
  method?: ShipMethod;
  expectedDate?: number;
  notes?: string;
  lines?: Array<{ productId: string; name?: string; quantity: number }>;
}

export class ShippingService {
  constructor(private readonly db: DB) {}

  private async nextNumber(tenantId: string): Promise<string> {
    const row = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM shipping_orders WHERE tenant_id = @t", { t: tenantId });
    return `SHP-${String(Number(row?.n ?? 0) + 1).padStart(5, "0")}`;
  }

  /** Create a shipping order from an invoice. Idempotent per invoice. Lines come
   *  from the explicit input, else the invoice's linked order's order_lines. */
  async createFromInvoice(input: CreateShipmentInput, tenantId: string): Promise<ShippingOrder & { lines: ShippingLine[] }> {
    const inv = await this.db.one<{ id: string; customer_id: string; order_id: string | null }>(
      "SELECT id, customer_id, order_id FROM invoices WHERE id = @i AND tenant_id = @t",
      { i: input.invoiceId, t: tenantId },
    );
    if (!inv) throw notFound(`invoice '${input.invoiceId}' not found`);

    const existing = await this.db.one<ShippingOrder>("SELECT * FROM shipping_orders WHERE invoice_id = @i AND tenant_id = @t", { i: input.invoiceId, t: tenantId });
    if (existing) return { ...existing, lines: await this.linesFor(existing.id, tenantId) };

    let srcLines: Array<{ product_id: string; name: string; quantity: number }> = [];
    if (input.lines && input.lines.length > 0) {
      srcLines = input.lines.map((l) => ({ product_id: l.productId, name: l.name ?? "Item", quantity: l.quantity }));
    } else if (inv.order_id) {
      srcLines = await this.db.query<{ product_id: string; name: string; quantity: number }>(
        "SELECT product_id, name, quantity FROM order_lines WHERE order_id = @o AND tenant_id = @t",
        { o: inv.order_id, t: tenantId },
      );
    }

    const now = Date.now();
    const so: ShippingOrder = {
      id: `shp_${uuidv7()}`, tenant_id: tenantId, ship_number: await this.nextNumber(tenantId),
      invoice_id: input.invoiceId, customer_id: inv.customer_id, status: "pending_shipment",
      method: input.method ?? "delivery", carrier: null, tracking_number: null,
      expected_date: input.expectedDate ?? null, shipped_date: null, delivered_date: null,
      notes: input.notes ?? null, created_at: now, updated_at: now,
    };
    const lines = await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO shipping_orders (id, tenant_id, ship_number, invoice_id, customer_id, status, method, carrier, tracking_number, expected_date, shipped_date, delivered_date, notes, created_at, updated_at)
         VALUES (@id,@tenant_id,@ship_number,@invoice_id,@customer_id,@status,@method,@carrier,@tracking_number,@expected_date,@shipped_date,@delivered_date,@notes,@created_at,@updated_at)`,
        so as unknown as Record<string, unknown>,
      );
      const out: ShippingLine[] = [];
      for (const l of srcLines) {
        const line: ShippingLine = { id: `shl_${uuidv7()}`, tenant_id: tenantId, shipping_order_id: so.id, product_id: l.product_id, name: l.name, quantity: Number(l.quantity), packed: 0 };
        await tdb.query(
          "INSERT INTO shipping_order_lines (id, tenant_id, shipping_order_id, product_id, name, quantity, packed) VALUES (@id,@tenant_id,@shipping_order_id,@product_id,@name,@quantity,0)",
          line as unknown as Record<string, unknown>,
        );
        out.push(line);
      }
      return out;
    });
    return { ...so, lines };
  }

  private linesFor(id: string, tenantId: string): Promise<ShippingLine[]> {
    return this.db.query<ShippingLine>("SELECT * FROM shipping_order_lines WHERE shipping_order_id = @id AND tenant_id = @t", { id, t: tenantId });
  }

  async list(tenantId: string, status?: ShipStatus): Promise<ShippingOrder[]> {
    if (status) return this.db.query<ShippingOrder>("SELECT * FROM shipping_orders WHERE tenant_id = @t AND status = @s ORDER BY created_at DESC LIMIT 500", { t: tenantId, s: status });
    return this.db.query<ShippingOrder>("SELECT * FROM shipping_orders WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 500", { t: tenantId });
  }

  async get(id: string, tenantId: string): Promise<ShippingOrder & { lines: ShippingLine[] }> {
    const so = await this.db.one<ShippingOrder>("SELECT * FROM shipping_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`shipping order '${id}' not found`);
    return { ...so, lines: await this.linesFor(id, tenantId) };
  }

  async packLine(id: string, lineId: string, tenantId: string): Promise<ShippingOrder & { lines: ShippingLine[] }> {
    const line = await this.db.one<ShippingLine>("SELECT * FROM shipping_order_lines WHERE id = @l AND shipping_order_id = @s AND tenant_id = @t", { l: lineId, s: id, t: tenantId });
    if (!line) throw notFound(`shipping line '${lineId}' not found`);
    await this.db.query("UPDATE shipping_order_lines SET packed = 1 WHERE id = @l AND tenant_id = @t", { l: lineId, t: tenantId });
    return this.get(id, tenantId);
  }

  async markShipped(id: string, opts: { carrier?: string; trackingNumber?: string; shippedDate?: number }, tenantId: string): Promise<ShippingOrder> {
    const so = await this.db.one<ShippingOrder>("SELECT * FROM shipping_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`shipping order '${id}' not found`);
    if (so.status === "cancelled") throw conflict("shipping order is cancelled");
    if (so.status === "delivered") throw conflict("shipping order already delivered");
    const now = Date.now();
    const shippedDate = opts.shippedDate ?? now;
    await this.db.query(
      "UPDATE shipping_orders SET status = 'shipped', carrier = @c, tracking_number = @tn, shipped_date = @sd, updated_at = @now WHERE id = @id AND tenant_id = @t",
      { c: opts.carrier ?? so.carrier, tn: opts.trackingNumber ?? so.tracking_number, sd: shippedDate, now, id, t: tenantId },
    );
    return { ...so, status: "shipped", carrier: opts.carrier ?? so.carrier, tracking_number: opts.trackingNumber ?? so.tracking_number, shipped_date: shippedDate };
  }

  async markDelivered(id: string, tenantId: string): Promise<ShippingOrder> {
    const so = await this.db.one<ShippingOrder>("SELECT * FROM shipping_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`shipping order '${id}' not found`);
    if (so.status !== "shipped") throw conflict(`cannot deliver a ${so.status} shipping order`);
    const now = Date.now();
    await this.db.query("UPDATE shipping_orders SET status = 'delivered', delivered_date = @now, updated_at = @now WHERE id = @id AND tenant_id = @t", { now, id, t: tenantId });
    return { ...so, status: "delivered", delivered_date: now };
  }

  async cancel(id: string, tenantId: string): Promise<ShippingOrder> {
    const so = await this.db.one<ShippingOrder>("SELECT * FROM shipping_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`shipping order '${id}' not found`);
    if (so.status === "delivered") throw conflict("cannot cancel a delivered shipping order");
    await this.db.query("UPDATE shipping_orders SET status = 'cancelled', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
    return { ...so, status: "cancelled" };
  }
}
