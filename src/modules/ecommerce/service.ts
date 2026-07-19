import type { DB } from "../../shared/db.js";
import type { SalesService, LineInput } from "../sales/service.js";
import { notFound } from "../../shared/http.js";

/**
 * Ecommerce module (ERP benchmark #14). Products flagged `ecommerce=1` form the
 * online catalog. Checkout creates a Sales Order on the "ecommerce" channel via
 * the sales engine (so tier pricing + the SO workflow apply), and the customer
 * portal exposes a customer's own order/invoice history. Tenant-scoped.
 */

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  category: string;
}

const ECOMMERCE_STORE = "ecommerce";

export class EcommerceService {
  constructor(
    private readonly db: DB,
    private readonly sales: SalesService,
  ) {}

  /** Online catalog: active products with the ecommerce flag set. */
  async catalog(tenantId: string, query?: string, category?: string): Promise<CatalogItem[]> {
    const where = ["tenant_id = @t", "ecommerce = 1", "status = 'active'"];
    const params: Record<string, unknown> = { t: tenantId };
    if (query) { where.push("(name ILIKE @q OR sku ILIKE @q)"); params.q = `%${query}%`; }
    if (category) { where.push("category = @c"); params.c = category; }
    return this.db.query<CatalogItem>(
      `SELECT id, sku, name, price_cents, category FROM products WHERE ${where.join(" AND ")} ORDER BY name LIMIT 500`,
      params,
    );
  }

  /** Toggle a product's online visibility. */
  async setOnline(productId: string, on: boolean, tenantId: string): Promise<{ productId: string; ecommerce: boolean }> {
    const p = await this.db.one("SELECT id FROM products WHERE id = @p AND tenant_id = @t", { p: productId, t: tenantId });
    if (!p) throw notFound(`product '${productId}' not found`);
    await this.db.query("UPDATE products SET ecommerce = @v, updated_at = @now WHERE id = @p AND tenant_id = @t", { v: on ? 1 : 0, now: Date.now(), p: productId, t: tenantId });
    return { productId, ecommerce: on };
  }

  /** Online checkout → a Sales Order on the ecommerce channel (pending approval). */
  async checkout(input: { customerId: string; lines: LineInput[] }, tenantId: string) {
    return this.sales.createSalesOrder({ customerId: input.customerId, lines: input.lines, storeId: ECOMMERCE_STORE }, tenantId);
  }

  /** Admin view: all online orders across all customers for this tenant. */
  async orders(tenantId: string, since?: number, limit = 100) {
    const where = ["so.tenant_id = @t", "so.store_id = 'ecommerce'"];
    const params: Record<string, unknown> = { t: tenantId, lim: limit };
    if (since !== undefined) { where.push("so.created_at >= @since"); params.since = since; }
    return this.db.query(
      `SELECT so.id, so.so_number, so.customer_id, c.name AS customer_name, so.status, so.fulfillment_status, so.total_cents, so.store_id, so.created_at
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
       WHERE ${where.join(" AND ")}
       ORDER BY so.created_at DESC LIMIT @lim`,
      params,
    );
  }

  /** Customer portal: the customer's own sales orders + invoices. */
  async portal(customerId: string, tenantId: string) {
    const c = await this.db.one("SELECT id, name FROM customers WHERE id = @c AND tenant_id = @t", { c: customerId, t: tenantId });
    if (!c) throw notFound(`customer '${customerId}' not found`);
    const salesOrders = await this.db.query(
      "SELECT id, so_number, status, total_cents, store_id, created_at FROM sales_orders WHERE tenant_id = @t AND customer_id = @c ORDER BY created_at DESC LIMIT 100",
      { t: tenantId, c: customerId },
    );
    const invoices = await this.db.query(
      "SELECT id, invoice_number, status, total_cents, paid_cents, due_date, issued_at FROM invoices WHERE tenant_id = @t AND customer_id = @c ORDER BY issued_at DESC LIMIT 100",
      { t: tenantId, c: customerId },
    );
    return { customer: c, salesOrders, invoices };
  }
}
