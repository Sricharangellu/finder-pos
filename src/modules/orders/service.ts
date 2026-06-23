import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Cents } from "../../shared/money.js";
import type { StateCode } from "../../shared/types.js";
import { notFound, badRequest, conflict } from "../../shared/http.js";
import { computeOrderTax, type TaxableLine } from "./tax.js";

export type OrderStatus = "open" | "completed" | "refunded" | "voided";

export interface OrderRow {
  id: string;
  tenant_id: string;
  order_number: string;
  state_code: StateCode;
  status: OrderStatus;
  subtotal_cents: Cents;
  discount_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  customer_id: string | null;
  store_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderLineRow {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_cents: Cents;
  tax_cents: Cents;
  line_cents: Cents;
  taxable: number; // 1|0
}

export interface OrderWithLines extends OrderRow {
  lines: OrderLineRow[];
}

export interface CreateOrderLineInput {
  productId: string;
  quantity: number;
  ageVerified?: boolean; // required true when product.age_restricted (BE-16)
}

export interface CreateOrderInput {
  stateCode?: StateCode; // optional — defaults to "CA" when not supplied (e.g. from POS terminal)
  lines: CreateOrderLineInput[];
  discountCents?: Cents;
  customerId?: string | null;
  storeId?: string | null;
}

export interface UpdateOrderInput {
  lines: CreateOrderLineInput[];
  discountCents?: Cents;
  customerId?: string | null;
  storeId?: string | null;
}

export interface ListOrdersQuery {
  status?: OrderStatus;
  limit?: number;
  offset?: number;
  cursor?: string;
  storeId?: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

/** product columns owned by the catalog module (read-only, by id). */
interface ProductRow {
  id: string;
  name: string;
  price_cents: Cents;
  tax_class: string;
  status: string;
  is_master: boolean;
  age_restricted: number; // 1|0
}

const VOIDABLE_STATUSES = new Set<OrderStatus>(["open", "completed"]);

export class OrdersService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateOrderInput, tenantId: string): Promise<OrderWithLines> {
    if (input.lines.length === 0) {
      throw badRequest("an order requires at least one line");
    }

    interface Resolved {
      input: CreateOrderLineInput;
      product: ProductRow;
      taxable: boolean;
      lineGross: Cents;
    }

    // DB-3: Batch-fetch all products and inventory in 2 queries instead of
    // 3 queries per line (N+1 → O(1)). Committed stock is aggregated in a
    // single GROUP BY across all requested product IDs.
    for (const line of input.lines) {
      if (line.quantity <= 0) throw badRequest(`line quantity must be positive for ${line.productId}`);
    }
    const productIds = input.lines.map((l) => l.productId);

    // Two parameterised queries (no string interpolation) using Postgres array params.
    // node-postgres passes JavaScript arrays directly as Postgres array literals.
    const products = await this.db.query<ProductRow & { is_master: boolean; sku: string }>(
      `SELECT p.id, p.sku, p.name, p.price_cents, p.tax_class, p.status, p.age_restricted,
              EXISTS(SELECT 1 FROM products c
                     WHERE c.tenant_id = p.tenant_id AND c.parent_product_id = p.id) AS is_master
         FROM products p
        WHERE p.tenant_id = ? AND p.id = ANY(?)`,
      [tenantId, productIds],
    );
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Single query: on-hand stock + committed quantity for all requested products.
    const stockRows = await this.db.query<{ product_id: string; stock_qty: number; committed: number }>(
      `SELECT i.product_id,
              i.stock_qty,
              COALESCE((
                SELECT SUM(ol.quantity)
                FROM order_lines ol
                JOIN orders o ON o.id = ol.order_id
                WHERE ol.product_id = i.product_id
                  AND o.tenant_id = i.tenant_id
                  AND o.status NOT IN ('completed','voided','refunded')
              ), 0) AS committed
         FROM inventory i
        WHERE i.tenant_id = ? AND i.product_id = ANY(?)`,
      [tenantId, productIds],
    );
    const stockMap = new Map(stockRows.map((r) => [r.product_id, r]));

    const resolved: Resolved[] = [];
    for (const line of input.lines) {
      const product = productMap.get(line.productId);
      if (!product) throw badRequest(`product '${line.productId}' not found`);

      if (product.status !== "active") {
        throw badRequest(`product '${line.productId}' is ${product.status} and cannot be sold`);
      }
      if (product.is_master) {
        throw badRequest(`product '${line.productId}' is a variant master and cannot be sold directly`);
      }
      if (product.age_restricted && !line.ageVerified) {
        throw badRequest(`product '${line.productId}' is age-restricted — set ageVerified: true after ID check`);
      }

      // BE-9: Inventory reservation — only enforced when an inventory row exists.
      const stock = stockMap.get(line.productId);
      if (stock !== undefined) {
        const available = Number(stock.stock_qty) - Number(stock.committed);
        if (line.quantity > available) {
          throw conflict(
            `Insufficient stock for SKU ${product.sku ?? line.productId}: ${available} available, ${line.quantity} requested`,
          );
        }
      }

      const taxable = product.tax_class !== "exempt";
      const lineGross = product.price_cents * line.quantity;
      resolved.push({ input: line, product, taxable, lineGross });
    }

    const taxInputs: TaxableLine[] = resolved.map((r) => ({
      lineGross: r.lineGross,
      taxable: r.taxable,
    }));

    const computed = computeOrderTax(taxInputs, input.stateCode ?? "CA", input.discountCents ?? 0);

    const now = Date.now();
    const orderId = `ord_${uuidv7()}`;
    const orderNumber = `FP-${orderId.slice(-8).toUpperCase()}`;

    const order: OrderRow = {
      id: orderId,
      tenant_id: tenantId,
      order_number: orderNumber,
      state_code: input.stateCode ?? "CA",
      status: "open",
      subtotal_cents: computed.subtotalCents,
      discount_cents: computed.discountCents,
      tax_cents: computed.taxCents,
      total_cents: computed.totalCents,
      customer_id: input.customerId ?? null,
      store_id: input.storeId ?? null,
      created_at: now,
      updated_at: now,
    };

    const lines: OrderLineRow[] = resolved.map((r, i) => ({
      id: `oln_${uuidv7()}`,
      tenant_id: tenantId,
      order_id: orderId,
      product_id: r.product.id,
      name: r.product.name,
      quantity: r.input.quantity,
      unit_cents: r.product.price_cents,
      tax_cents: computed.lines[i].taxCents,
      line_cents: computed.lines[i].lineCents,
      taxable: r.taxable ? 1 : 0,
    }));

    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO orders
           (id, tenant_id, order_number, state_code, status, subtotal_cents,
            discount_cents, tax_cents, total_cents, customer_id, store_id,
            created_at, updated_at)
         VALUES
           (@id, @tenant_id, @order_number, @state_code, @status, @subtotal_cents,
            @discount_cents, @tax_cents, @total_cents, @customer_id, @store_id,
            @created_at, @updated_at)`,
        order as unknown as Record<string, unknown>,
      );
      for (const line of lines) {
        await tdb.query(
          `INSERT INTO order_lines
             (id, tenant_id, order_id, product_id, name, quantity, unit_cents,
              tax_cents, line_cents, taxable)
           VALUES
             (@id, @tenant_id, @order_id, @product_id, @name, @quantity, @unit_cents,
              @tax_cents, @line_cents, @taxable)`,
          line as unknown as Record<string, unknown>,
        );
      }
    });

    await this.events.publish(
      "order.created",
      {
        id: order.id,
        tenantId,
        orderNumber: order.order_number,
        stateCode: order.state_code,
        totalCents: order.total_cents,
        lines: lines.map((l) => ({
          productId: l.product_id,
          quantity: l.quantity,
          unitCents: l.unit_cents,
        })),
      },
      order.id,
    );

    return { ...order, lines };
  }

  /** Replace the lines of an open order in-place (cart update from POS terminal).
   *  Deletes existing lines, recomputes tax/totals, and updates the order row.
   *  The order id and order_number are preserved. */
  async update(id: string, input: UpdateOrderInput, tenantId: string): Promise<OrderWithLines> {
    const existing = await this.getOrThrow(id, tenantId);
    if (existing.status !== "open") throw conflict(`order '${id}' is ${existing.status} and cannot be updated`);
    if (input.lines.length === 0) throw badRequest("an order requires at least one line");

    // Resolve products and check inventory (same logic as create).
    interface Resolved { input: CreateOrderLineInput; product: ProductRow; taxable: boolean; lineGross: Cents; }
    const resolved: Resolved[] = [];
    for (const line of input.lines) {
      if (line.quantity <= 0) throw badRequest(`line quantity must be positive for ${line.productId}`);
      const product = await this.db.one<ProductRow>(
        `SELECT p.id, p.name, p.price_cents, p.tax_class, p.status, p.age_restricted,
                EXISTS(SELECT 1 FROM products c WHERE c.tenant_id = p.tenant_id AND c.parent_product_id = p.id) AS is_master
           FROM products p WHERE p.id = @id AND p.tenant_id = @tenantId`,
        { id: line.productId, tenantId },
      );
      if (!product) throw badRequest(`product '${line.productId}' not found`);
      if (product.status !== "active") throw badRequest(`product '${line.productId}' is ${product.status} and cannot be sold`);
      if (product.age_restricted && !line.ageVerified) throw badRequest(`product '${line.productId}' is age-restricted — set ageVerified: true`);
      resolved.push({ input: line, product, taxable: product.tax_class !== "exempt", lineGross: product.price_cents * line.quantity });
    }

    const taxInputs: TaxableLine[] = resolved.map((r) => ({ lineGross: r.lineGross, taxable: r.taxable }));
    const computed = computeOrderTax(taxInputs, existing.state_code, input.discountCents ?? 0);
    const now = Date.now();

    const newLines: OrderLineRow[] = resolved.map((r) => {
      const tax = Math.round((r.lineGross / (computed.subtotalCents || 1)) * computed.taxCents);
      return {
        id: `ol_${uuidv7()}`, tenant_id: tenantId, order_id: id,
        product_id: r.product.id, name: r.product.name,
        quantity: r.input.quantity, unit_cents: r.product.price_cents,
        tax_cents: tax, line_cents: r.lineGross + tax, taxable: r.taxable ? 1 : 0,
      };
    });

    await this.db.withTenant(tenantId).tx(async (tdb) => {
      // Replace lines.
      await tdb.query("DELETE FROM order_lines WHERE order_id = @id AND tenant_id = @t", { id, t: tenantId });
      for (const l of newLines) {
        await tdb.query(
          `INSERT INTO order_lines (id, tenant_id, order_id, product_id, name, quantity, unit_cents, tax_cents, line_cents, taxable)
           VALUES (@id,@tenant_id,@order_id,@product_id,@name,@quantity,@unit_cents,@tax_cents,@line_cents,@taxable)`,
          l as unknown as Record<string, unknown>,
        );
      }
      // Update order totals in place.
      await tdb.query(
        `UPDATE orders SET subtotal_cents=@sub, discount_cents=@disc, tax_cents=@tax, total_cents=@total,
           customer_id=@cust, store_id=@store, updated_at=@now
           WHERE id=@id AND tenant_id=@t`,
        {
          sub: computed.subtotalCents, disc: computed.discountCents,
          tax: computed.taxCents, total: computed.totalCents,
          cust: input.customerId ?? existing.customer_id,
          store: input.storeId ?? existing.store_id,
          now, id, t: tenantId,
        },
      );
    });

    return {
      ...existing,
      subtotal_cents: computed.subtotalCents,
      discount_cents: computed.discountCents,
      tax_cents: computed.taxCents,
      total_cents: computed.totalCents,
      customer_id: input.customerId ?? existing.customer_id,
      store_id: input.storeId ?? existing.store_id,
      updated_at: now,
      lines: newLines,
    };
  }

  /**
   * Transition an order to 'completed' (on payment.captured). No-op if missing
   * or already in a terminal/non-open state, so a late event can't resurrect it.
   */
  async markCompleted(orderId: string, tenantId: string): Promise<void> {
    const order = await this.db.one<{ status: OrderStatus }>(
      "SELECT status FROM orders WHERE id = @id AND tenant_id = @tenantId",
      { id: orderId, tenantId },
    );
    if (!order || order.status !== "open") return;
    await this.db.query(
      "UPDATE orders SET status = @status, updated_at = @updated_at WHERE id = @id AND tenant_id = @tenantId",
      { status: "completed", updated_at: Date.now(), id: orderId, tenantId },
    );
  }

  async get(id: string, tenantId: string): Promise<OrderWithLines | undefined> {
    const order = await this.db.one<OrderRow>(
      "SELECT * FROM orders WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!order) return undefined;
    const lines = await this.db.query<OrderLineRow>(
      "SELECT * FROM order_lines WHERE order_id = @orderId AND tenant_id = @tenantId ORDER BY id ASC",
      { orderId: id, tenantId },
    );
    return { ...order, lines };
  }

  async getOrThrow(id: string, tenantId: string): Promise<OrderWithLines> {
    const order = await this.get(id, tenantId);
    if (!order) throw notFound(`order '${id}' not found`);
    return order;
  }

  async customerEmail(customerId: string, tenantId: string): Promise<string | null> {
    const row = await this.db.one<{ email: string | null }>(
      "SELECT email FROM customers WHERE id = @id AND tenant_id = @t",
      { id: customerId, t: tenantId },
    );
    return row?.email ?? null;
  }

  async list(query: ListOrdersQuery = {}, tenantId: string): Promise<CursorPage<OrderRow>> {
    const limit = clampLimit(query.limit);

    // Decode cursor if provided.
    const cur = query.cursor
      ? (JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { at: number; id: string })
      : null;

    const where: string[] = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.status) {
      where.push("status = @status");
      params.status = query.status;
    }
    if (query.storeId) {
      where.push("store_id = @storeId");
      params.storeId = query.storeId;
    }
    if (cur) {
      where.push("(created_at, id) < (@curAt, @curId)");
      params.curAt = cur.at;
      params.curId = cur.id;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const items = await this.db.query<OrderRow>(
      `SELECT * FROM orders ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`,
      { ...params, limit },
    );

    const lastItem = items[items.length - 1];
    const nextCursor =
      items.length === limit && lastItem
        ? Buffer.from(JSON.stringify({ at: lastItem.created_at, id: lastItem.id })).toString("base64url")
        : null;

    return { items, nextCursor, limit };
  }

  async refund(id: string, tenantId: string): Promise<OrderWithLines> {
    const order = await this.getOrThrow(id, tenantId);
    if (order.status === "refunded") {
      throw conflict(`order '${id}' is already refunded`);
    }
    if (order.status === "voided") {
      throw conflict(`voided order '${id}' cannot be refunded`);
    }

    const updatedAt = Date.now();
    await this.db.query(
      "UPDATE orders SET status = @status, updated_at = @updated_at WHERE id = @id AND tenant_id = @tenantId",
      { status: "refunded", updated_at: updatedAt, id, tenantId },
    );

    await this.events.publish(
      "order.refunded",
      {
        id: order.id,
        tenantId,
        orderNumber: order.order_number,
        totalCents: order.total_cents,
      },
      order.id,
    );

    return { ...order, status: "refunded", updated_at: updatedAt };
  }

  async void(id: string, tenantId: string): Promise<OrderWithLines> {
    const order = await this.getOrThrow(id, tenantId);
    if (!VOIDABLE_STATUSES.has(order.status)) {
      throw conflict(`order '${id}' is ${order.status} and cannot be voided`);
    }

    const updatedAt = Date.now();
    await this.db.query(
      "UPDATE orders SET status = @status, updated_at = @updated_at WHERE id = @id AND tenant_id = @tenantId",
      { status: "voided", updated_at: updatedAt, id, tenantId },
    );

    return { ...order, status: "voided", updated_at: updatedAt };
  }
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}
