import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound, badRequest } from "../../shared/http.js";
import type { CatalogService } from "./service.js";

/**
 * Cross-table read views + small CRUD surfaces for the catalog product-detail
 * page (web/app/(protected)/catalog/[id]). Kept out of service.ts (already
 * 1600+ lines) since these queries reach into orders/purchasing/inventory
 * tables rather than owning catalog's own schema — a reporting/rollup layer,
 * not core product CRUD.
 *
 * Every method here is read-derived from tables another module owns, except
 * where this file's own tables are used (product_suppliers, product_price_tiers,
 * and the extended inventory_lots columns — see AUDIT_2026-07-18T005030Z §2 for
 * why these were missing and CODING_STANDARDS.md's "API parity" section for
 * the policy this fixes).
 */

// ─── Shared shapes (mirror web/api-client/types.ts) ──────────────────────────

export interface ProductStockLocation {
  location_id: string;
  location_name: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number;
  reorder_level: number;
}

export interface ProductSaleRecord {
  id: string;
  product_id: string;
  sale_id: string;
  sale_number: string;
  date: number;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  customer_name: string | null;
  cashier_name: string;
  outlet_name: string;
  payment_method: string;
}

export interface ProductSalesResponse {
  items: ProductSaleRecord[];
  total: number;
  total_units_sold: number;
  total_revenue_cents: number;
}

export interface SaleByCustomerRecord {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_type: "retail" | "wholesale";
  order_id: string;
  order_number: string;
  order_date: number;
  outlet: string;
  qty_bought: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_pct: number;
  returned_qty: number;
  last_purchase_date: number;
}

export interface PurchaseLine {
  id: string;
  product_id: string;
  po_id: string;
  po_number: string;
  vendor_name: string;
  ordered_at: number;
  received_at: number | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost_cents: number;
  total_cost_cents: number;
  status: "ordered" | "partially_received" | "received" | "cancelled"; // matches purchasing's POStatus exactly
}

export interface ProductInvoiceLine {
  id: string;
  product_id: string;
  po_id: string;
  po_number: string;
  invoice_number: string | null;
  date: number;
  quantity: number;
  unit_cost_cents: number;
  total_cost_cents: number;
  supplier_name: string;
  status: "ordered" | "partially_received" | "received" | "cancelled"; // matches purchasing's POStatus exactly
  expiry_date: number | null;
  lot_code: string | null;
}

export interface ProductReturn {
  id: string;
  product_id: string;
  return_id: string;
  return_number: string;
  original_sale_id: string | null;
  original_sale_number: string | null;
  date: number;
  quantity: number;
  unit_price_cents: number;
  refund_cents: number;
  reason: string;
  notes: string | null;
  customer_name: string | null;
  cashier_name: string;
  status: "pending" | "approved" | "rejected" | "restocked";
}

export interface ProductSupplierRow {
  id: string;
  product_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_sku: string | null;
  cost_cents: number | null;
  lead_time_days: number | null;
  moq: number | null;
  case_pack: number | null;
  is_preferred: boolean;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface SupplierUpsertInput {
  vendor_name?: string;
  vendor_sku?: string | null;
  cost_cents?: number | null;
  lead_time_days?: number | null;
  moq?: number | null;
  case_pack?: number | null;
  is_preferred?: boolean;
  notes?: string | null;
}

export interface ProductPriceTier {
  id: string;
  product_id: string;
  min_qty: number;
  price_cents: number;
  label: string | null;
  created_at: number;
}

export interface ProductExpiryRecord {
  id: string;
  product_id: string;
  batch_number: string | null;
  lot_code: string | null;
  quantity: number;
  unit_cost_cents: number;
  expiry_date: number | null;
  received_at: number;
  supplier_name: string | null;
  location_name: string | null;
  notes: string | null;
  expiry_status: "ok" | "warning" | "critical" | "expired";
  days_until_expiry: number | null;
  created_at: number;
  updated_at: number;
}

const DAY_MS = 86_400_000;

function expiryStatus(daysUntil: number | null): ProductExpiryRecord["expiry_status"] {
  if (daysUntil === null) return "ok";
  if (daysUntil < 0) return "expired";
  if (daysUntil <= 7) return "critical";
  if (daysUntil <= 30) return "warning";
  return "ok";
}

export class CatalogDetailViewsService {
  constructor(
    private readonly db: DB,
    private readonly catalog: CatalogService,
  ) {}

  // ── Stock ────────────────────────────────────────────────────────────────────

  async stock(productId: string, tenantId: string): Promise<{ locations: ProductStockLocation[] }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const locations = await this.db.query<ProductStockLocation>(
      `SELECT l.id AS location_id, l.name AS location_name,
              s.quantity_on_hand, s.quantity_committed, s.quantity_available,
              s.average_cost_cents, s.reorder_level
       FROM inventory_stock s
       JOIN inventory_locations l ON l.tenant_id = s.tenant_id AND l.id = s.location_id
       WHERE s.tenant_id = @t AND s.product_id = @p
       ORDER BY l.name ASC`,
      { t: tenantId, p: productId },
    );
    return { locations };
  }

  // ── Sales (per-line history) ─────────────────────────────────────────────────

  /**
   * Per-line sale history for this product. cashier_name is always "system":
   * orders/order_lines record no acting-user column (same honest gap noted in
   * OrdersService.timeline). outlet_name resolves via orders.store_id → outlets;
   * "—" when unset (POS sales without a store context, e.g. some test seeds).
   */
  async sales(productId: string, tenantId: string, limit = 500): Promise<ProductSalesResponse> {
    await this.catalog.getOrThrow(productId, tenantId);
    const capped = Math.min(Math.max(limit, 1), 1000);
    const items = await this.db.query<ProductSaleRecord>(
      `SELECT ol.id, ol.product_id, o.id AS sale_id, o.order_number AS sale_number,
              o.created_at AS date, ol.quantity,
              ol.unit_cents AS unit_price_cents, 0 AS discount_cents, ol.tax_cents,
              ol.line_cents AS total_cents,
              c.name AS customer_name, 'system' AS cashier_name,
              COALESCE(out.name, '—') AS outlet_name,
              COALESCE((SELECT p.method FROM payments p WHERE p.tenant_id = o.tenant_id AND p.order_id = o.id ORDER BY p.created_at ASC LIMIT 1), 'cash') AS payment_method
       FROM order_lines ol
       JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       LEFT JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
       LEFT JOIN outlets out ON out.tenant_id = o.tenant_id AND out.id = o.store_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status IN ('completed', 'refunded')
       ORDER BY o.created_at DESC
       LIMIT @limit`,
      { t: tenantId, p: productId, limit: capped },
    );
    const totals = await this.db.one<{ units: number; revenue: number }>(
      `SELECT COALESCE(SUM(ol.quantity), 0) AS units, COALESCE(SUM(ol.line_cents), 0) AS revenue
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status IN ('completed', 'refunded')`,
      { t: tenantId, p: productId },
    );
    return {
      items,
      total: items.length,
      total_units_sold: Number(totals?.units ?? 0),
      total_revenue_cents: Number(totals?.revenue ?? 0),
    };
  }

  // ── Sales by customer ────────────────────────────────────────────────────────

  /**
   * margin_pct uses the product's current cost (raw_cost_price_cents) against
   * the line's actual sale price — an approximation when cost has changed
   * since the sale (no cost-at-time-of-sale is recorded on order_lines).
   * returned_qty sums quantity from this same customer's REFUNDED orders for
   * this product (whole-order refund is the only granularity the schema has —
   * see OrdersService.refund; there is no per-line return record).
   */
  async salesByCustomer(productId: string, tenantId: string): Promise<{ items: SaleByCustomerRecord[]; summary: { total_revenue_cents: number; total_qty: number; total_returns: number; unique_customers: number } }> {
    const product = await this.catalog.getOrThrow(productId, tenantId);
    const costCents = Number(product.raw_cost_price_cents ?? 0);

    const rows = await this.db.query<{
      id: string; customer_id: string | null; customer_name: string | null; customer_type: string | null;
      order_id: string; order_number: string; order_date: number; outlet: string | null;
      qty_bought: number; unit_price_cents: number; discount_cents: number; tax_cents: number; total_cents: number;
      status: string;
    }>(
      `SELECT ol.id, o.customer_id, c.name AS customer_name, c.customer_type,
              o.id AS order_id, o.order_number, o.created_at AS order_date,
              out.name AS outlet, ol.quantity AS qty_bought,
              ol.unit_cents AS unit_price_cents, 0 AS discount_cents, ol.tax_cents, ol.line_cents AS total_cents,
              o.status
       FROM order_lines ol
       JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       LEFT JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
       LEFT JOIN outlets out ON out.tenant_id = o.tenant_id AND out.id = o.store_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status IN ('completed', 'refunded')
       ORDER BY o.created_at DESC`,
      { t: tenantId, p: productId },
    );

    const returnedByCustomer = new Map<string, number>();
    for (const r of rows) {
      if (r.status === "refunded" && r.customer_id) {
        returnedByCustomer.set(r.customer_id, (returnedByCustomer.get(r.customer_id) ?? 0) + r.qty_bought);
      }
    }
    const lastPurchaseByCustomer = new Map<string, number>();
    for (const r of rows) {
      if (!r.customer_id) continue;
      const prev = lastPurchaseByCustomer.get(r.customer_id) ?? 0;
      if (r.order_date > prev) lastPurchaseByCustomer.set(r.customer_id, r.order_date);
    }

    const items: SaleByCustomerRecord[] = rows.map((r) => ({
      id: r.id,
      customer_id: r.customer_id ?? "",
      customer_name: r.customer_name ?? "Walk-in",
      customer_type: r.customer_type === "business" ? "wholesale" : "retail",
      order_id: r.order_id,
      order_number: r.order_number,
      order_date: Number(r.order_date),
      outlet: r.outlet ?? "—",
      qty_bought: r.qty_bought,
      unit_price_cents: r.unit_price_cents,
      discount_cents: r.discount_cents,
      tax_cents: r.tax_cents,
      total_cents: r.total_cents,
      margin_pct: r.unit_price_cents > 0 ? ((r.unit_price_cents - costCents) / r.unit_price_cents) * 100 : 0,
      returned_qty: r.customer_id ? (returnedByCustomer.get(r.customer_id) ?? 0) : 0,
      last_purchase_date: r.customer_id ? (lastPurchaseByCustomer.get(r.customer_id) ?? Number(r.order_date)) : Number(r.order_date),
    }));

    const uniqueCustomers = new Set(rows.filter((r) => r.customer_id).map((r) => r.customer_id)).size;
    return {
      items,
      summary: {
        total_revenue_cents: rows.reduce((s, r) => s + r.total_cents, 0),
        total_qty: rows.reduce((s, r) => s + r.qty_bought, 0),
        total_returns: [...returnedByCustomer.values()].reduce((s, v) => s + v, 0),
        unique_customers: uniqueCustomers,
      },
    };
  }

  // ── Purchases / Invoices (both derived from the same PO history) ───────────

  async purchases(productId: string, tenantId: string): Promise<{ items: PurchaseLine[]; total: number; total_qty_received: number; total_cost_cents: number }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const items = await this.db.query<PurchaseLine>(
      `SELECT pol.id, pol.product_id, po.id AS po_id, COALESCE(po.po_number::text, po.id) AS po_number,
              s.name AS vendor_name, po.created_at AS ordered_at, po.received_at,
              pol.quantity AS qty_ordered, COALESCE(pol.billed_qty, 0) AS qty_received,
              pol.unit_price_cents AS unit_cost_cents, (pol.unit_price_cents * pol.quantity) AS total_cost_cents,
              po.status
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.tenant_id = pol.tenant_id AND po.id = pol.po_id
       JOIN suppliers s ON s.tenant_id = po.tenant_id AND s.id = po.supplier_id
       WHERE pol.tenant_id = @t AND pol.product_id = @p
       ORDER BY po.created_at DESC`,
      { t: tenantId, p: productId },
    );
    const totals = await this.db.one<{ qty: number; cost: number }>(
      `SELECT COALESCE(SUM(COALESCE(pol.billed_qty, 0)), 0) AS qty, COALESCE(SUM(pol.unit_price_cents * pol.quantity), 0) AS cost
       FROM purchase_order_lines pol WHERE pol.tenant_id = @t AND pol.product_id = @p`,
      { t: tenantId, p: productId },
    );
    return {
      items,
      total: items.length,
      total_qty_received: Number(totals?.qty ?? 0),
      total_cost_cents: Number(totals?.cost ?? 0),
    };
  }

  /**
   * Invoices reframes the same purchase-order-line history for the AP-facing
   * view (invoice_number, expiry_date/lot_code from the matching received lot
   * when one exists). There is no separate customer_invoices-style AP invoice
   * record for purchases — po_number doubles as the invoice reference, same
   * as the top-level /purchasing pages already do.
   */
  async invoices(productId: string, tenantId: string): Promise<{ items: ProductInvoiceLine[]; total: number; total_units_ordered: number; total_cost_cents: number }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const items = await this.db.query<ProductInvoiceLine>(
      `SELECT pol.id, pol.product_id, po.id AS po_id, COALESCE(po.po_number::text, po.id) AS po_number,
              COALESCE(po.po_number::text, po.id) AS invoice_number,
              po.created_at AS date, pol.quantity, pol.unit_price_cents AS unit_cost_cents,
              (pol.unit_price_cents * pol.quantity) AS total_cost_cents,
              s.name AS supplier_name, po.status,
              lot.expiry_date, lot.lot_code
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.tenant_id = pol.tenant_id AND po.id = pol.po_id
       JOIN suppliers s ON s.tenant_id = po.tenant_id AND s.id = po.supplier_id
       LEFT JOIN LATERAL (
         SELECT expiry_date, lot_code FROM inventory_lots
         WHERE tenant_id = pol.tenant_id AND product_id = pol.product_id AND po_id = po.id
         ORDER BY received_at DESC LIMIT 1
       ) lot ON true
       WHERE pol.tenant_id = @t AND pol.product_id = @p
       ORDER BY po.created_at DESC`,
      { t: tenantId, p: productId },
    );
    const totals = await this.db.one<{ qty: number; cost: number }>(
      `SELECT COALESCE(SUM(pol.quantity), 0) AS qty, COALESCE(SUM(pol.unit_price_cents * pol.quantity), 0) AS cost
       FROM purchase_order_lines pol WHERE pol.tenant_id = @t AND pol.product_id = @p`,
      { t: tenantId, p: productId },
    );
    return {
      items,
      total: items.length,
      total_units_ordered: Number(totals?.qty ?? 0),
      total_cost_cents: Number(totals?.cost ?? 0),
    };
  }

  // ── Returns (derived — no per-line return record exists; see JSDoc) ────────

  /**
   * There is no customer-return record in the schema (only whole-order
   * OrdersService.refund). Each REFUNDED order containing this product
   * becomes one pseudo-return record: reason "other" (unknown — not
   * collected anywhere today) and status "restocked" (refund() does not
   * currently reverse inventory, so nothing is actually restocked; flagged
   * here rather than silently implying a restock happened).
   */
  async returns(productId: string, tenantId: string, limit = 100): Promise<{ items: ProductReturn[]; total: number; total_units_returned: number; total_refunded_cents: number }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const capped = Math.min(Math.max(limit, 1), 500);
    const items = await this.db.query<ProductReturn>(
      `SELECT ol.id, ol.product_id, o.id AS return_id, o.order_number AS return_number,
              o.id AS original_sale_id, o.order_number AS original_sale_number,
              o.updated_at AS date, ol.quantity, ol.unit_cents AS unit_price_cents,
              ol.line_cents AS refund_cents, 'other' AS reason, NULL AS notes,
              c.name AS customer_name, 'system' AS cashier_name, 'approved' AS status
       FROM order_lines ol
       JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       LEFT JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status = 'refunded'
       ORDER BY o.updated_at DESC
       LIMIT @limit`,
      { t: tenantId, p: productId, limit: capped },
    );
    const totals = await this.db.one<{ qty: number; refunded: number }>(
      `SELECT COALESCE(SUM(ol.quantity), 0) AS qty, COALESCE(SUM(ol.line_cents), 0) AS refunded
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status = 'refunded'`,
      { t: tenantId, p: productId },
    );
    return {
      items,
      total: items.length,
      total_units_returned: Number(totals?.qty ?? 0),
      total_refunded_cents: Number(totals?.refunded ?? 0),
    };
  }

  // ── Suppliers (product_suppliers CRUD) ───────────────────────────────────────

  /** Find-or-create a supplier by name — the tab's form is a free-text vendor
   *  name, not a picker over the suppliers table, so a first-time name creates
   *  a minimal supplier row other purchasing screens can later flesh out. */
  private async upsertSupplierByName(tenantId: string, name: string): Promise<string> {
    const trimmed = name.trim();
    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM suppliers WHERE tenant_id = @t AND lower(name) = lower(@name) LIMIT 1",
      { t: tenantId, name: trimmed },
    );
    if (existing) return existing.id;
    const id = `sup_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      "INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES (@id, @t, @name, @now, @now)",
      { id, t: tenantId, name: trimmed, now },
    );
    return id;
  }

  async listSuppliers(productId: string, tenantId: string): Promise<{ items: ProductSupplierRow[] }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const items = await this.db.query<ProductSupplierRow>(
      `SELECT ps.id, ps.product_id, ps.supplier_id AS vendor_id, s.name AS vendor_name,
              ps.vendor_sku, ps.cost_cents, ps.lead_time_days, ps.moq, ps.case_pack,
              ps.is_preferred, ps.notes, ps.created_at, ps.updated_at
       FROM product_suppliers ps
       JOIN suppliers s ON s.tenant_id = ps.tenant_id AND s.id = ps.supplier_id
       WHERE ps.tenant_id = @t AND ps.product_id = @p
       ORDER BY ps.is_preferred DESC, s.name ASC`,
      { t: tenantId, p: productId },
    );
    return { items };
  }

  /**
   * Re-adding a vendor already linked to this product (same name, resolved to
   * the same supplier_id via find-or-create) upserts the existing row instead
   * of 500ing on the (tenant, product, supplier) UNIQUE constraint — a user
   * re-submitting the same vendor is far more likely to mean "update this"
   * than "I want a real error", and there is no legitimate reason for two
   * rows linking the same product to the same supplier.
   */
  async addSupplier(productId: string, tenantId: string, input: SupplierUpsertInput): Promise<ProductSupplierRow> {
    await this.catalog.getOrThrow(productId, tenantId);
    if (!input.vendor_name?.trim()) throw badRequest("vendor_name is required");
    const supplierId = await this.upsertSupplierByName(tenantId, input.vendor_name);
    const id = `psup_${uuidv7()}`;
    const now = Date.now();
    if (input.is_preferred) {
      await this.db.query(
        "UPDATE product_suppliers SET is_preferred = false WHERE tenant_id = @t AND product_id = @p",
        { t: tenantId, p: productId },
      );
    }
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO product_suppliers
         (id, tenant_id, product_id, supplier_id, vendor_sku, cost_cents, lead_time_days, moq, case_pack, is_preferred, notes, created_at, updated_at)
       VALUES (@id, @t, @p, @supplierId, @vendorSku, @costCents, @leadTimeDays, @moq, @casePack, @isPreferred, @notes, @now, @now)
       ON CONFLICT (tenant_id, product_id, supplier_id) DO UPDATE SET
         vendor_sku = EXCLUDED.vendor_sku, cost_cents = EXCLUDED.cost_cents,
         lead_time_days = EXCLUDED.lead_time_days, moq = EXCLUDED.moq, case_pack = EXCLUDED.case_pack,
         is_preferred = EXCLUDED.is_preferred, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
       RETURNING id`,
      {
        id, t: tenantId, p: productId, supplierId,
        vendorSku: input.vendor_sku ?? null, costCents: input.cost_cents ?? null,
        leadTimeDays: input.lead_time_days ?? null, moq: input.moq ?? null, casePack: input.case_pack ?? null,
        isPreferred: input.is_preferred ?? false, notes: input.notes ?? null, now,
      },
    );
    return this.getSupplierOrThrow(rows[0]!.id, tenantId);
  }

  private async getSupplierOrThrow(id: string, tenantId: string): Promise<ProductSupplierRow> {
    const row = await this.db.one<ProductSupplierRow>(
      `SELECT ps.id, ps.product_id, ps.supplier_id AS vendor_id, s.name AS vendor_name,
              ps.vendor_sku, ps.cost_cents, ps.lead_time_days, ps.moq, ps.case_pack,
              ps.is_preferred, ps.notes, ps.created_at, ps.updated_at
       FROM product_suppliers ps JOIN suppliers s ON s.tenant_id = ps.tenant_id AND s.id = ps.supplier_id
       WHERE ps.id = @id AND ps.tenant_id = @t`,
      { id, t: tenantId },
    );
    if (!row) throw notFound(`product supplier '${id}' not found`);
    return row;
  }

  async updateSupplier(id: string, productId: string, tenantId: string, input: SupplierUpsertInput): Promise<ProductSupplierRow> {
    const current = await this.getSupplierOrThrow(id, tenantId);
    if (current.product_id !== productId) throw notFound(`product supplier '${id}' not found`);
    if (input.is_preferred) {
      await this.db.query(
        "UPDATE product_suppliers SET is_preferred = false WHERE tenant_id = @t AND product_id = @p AND id != @id",
        { t: tenantId, p: productId, id },
      );
    }
    const supplierId = input.vendor_name?.trim() ? await this.upsertSupplierByName(tenantId, input.vendor_name) : undefined;
    await this.db.query(
      `UPDATE product_suppliers SET
         supplier_id = COALESCE(@supplierId, supplier_id),
         vendor_sku = COALESCE(@vendorSku, vendor_sku),
         cost_cents = CASE WHEN @hasCost THEN @costCents ELSE cost_cents END,
         lead_time_days = CASE WHEN @hasLeadTime THEN @leadTimeDays ELSE lead_time_days END,
         moq = CASE WHEN @hasMoq THEN @moq ELSE moq END,
         case_pack = CASE WHEN @hasCasePack THEN @casePack ELSE case_pack END,
         is_preferred = COALESCE(@isPreferred, is_preferred),
         notes = CASE WHEN @hasNotes THEN @notes ELSE notes END,
         updated_at = @now
       WHERE id = @id AND tenant_id = @t`,
      {
        id, t: tenantId, supplierId: supplierId ?? null,
        vendorSku: input.vendor_sku ?? null,
        hasCost: input.cost_cents !== undefined, costCents: input.cost_cents ?? null,
        hasLeadTime: input.lead_time_days !== undefined, leadTimeDays: input.lead_time_days ?? null,
        hasMoq: input.moq !== undefined, moq: input.moq ?? null,
        hasCasePack: input.case_pack !== undefined, casePack: input.case_pack ?? null,
        isPreferred: input.is_preferred ?? null,
        hasNotes: input.notes !== undefined, notes: input.notes ?? null,
        now: Date.now(),
      },
    );
    return this.getSupplierOrThrow(id, tenantId);
  }

  async deleteSupplier(id: string, productId: string, tenantId: string): Promise<void> {
    const current = await this.getSupplierOrThrow(id, tenantId);
    if (current.product_id !== productId) throw notFound(`product supplier '${id}' not found`);
    await this.db.query("DELETE FROM product_suppliers WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
  }

  // ── Supplier price comparison (derived from PO line history) ───────────────

  /**
   * landed_cost_cents == last_cost_cents: freight/duty allocation isn't
   * tracked per line anywhere in the schema, so "landed" cost is approximated
   * as the PO unit cost. price_30d_trend compares the most recent PO line cost
   * against the most recent one ≥30 days ago (falls back to "stable" with
   * fewer than 2 data points).
   */
  async supplierPriceComparison(productId: string, tenantId: string) {
    const product = await this.catalog.getOrThrow(productId, tenantId);
    const suppliers = (await this.listSuppliers(productId, tenantId)).items;
    const now = Date.now();

    const items = [];
    for (const s of suppliers) {
      const history = await this.db.query<{ date: number; cost: number }>(
        `SELECT po.created_at AS date, pol.unit_price_cents AS cost
         FROM purchase_order_lines pol
         JOIN purchase_orders po ON po.tenant_id = pol.tenant_id AND po.id = pol.po_id
         WHERE pol.tenant_id = @t AND pol.product_id = @p AND po.supplier_id = @supplierId
         ORDER BY po.created_at ASC`,
        { t: tenantId, p: productId, supplierId: s.vendor_id },
      );
      const last = history[history.length - 1];
      const cutoff = now - 30 * DAY_MS;
      const before30d = [...history].reverse().find((h) => h.date <= cutoff);
      let trend: "up" | "down" | "stable" = "stable";
      if (last && before30d && history.length >= 2) {
        if (last.cost > before30d.cost) trend = "up";
        else if (last.cost < before30d.cost) trend = "down";
      }
      items.push({
        supplier_id: s.vendor_id,
        supplier_name: s.vendor_name,
        is_preferred: s.is_preferred,
        vendor_sku: s.vendor_sku,
        last_purchase_date: last ? Number(last.date) : null,
        last_cost_cents: last ? Number(last.cost) : (s.cost_cents ?? 0),
        landed_cost_cents: last ? Number(last.cost) : (s.cost_cents ?? 0),
        moq: s.moq,
        lead_time_days: s.lead_time_days,
        price_30d_trend: trend,
        price_history: history.map((h) => ({ date: Number(h.date), cost: Number(h.cost) })),
      });
    }
    const best = items.reduce<typeof items[number] | null>(
      (min, cur) => (min === null || cur.last_cost_cents < min.last_cost_cents ? cur : min),
      null,
    );
    return {
      items,
      best_price_supplier_id: best?.supplier_id ?? "",
      current_retail_price_cents: Number(product.price_cents),
    };
  }

  // ── Reorder suggestions ──────────────────────────────────────────────────────

  /**
   * avg_daily_sales/days_until_stockout use a trailing-30-day sales velocity
   * (no dedicated forecasting model exists yet — see WORK/FORWARD_PLAN.md's
   * "inventory forecasting" future item). suggested_qty rounds up to the
   * location's reorder_quantity when set, otherwise to 14 days of cover.
   */
  async reorderSuggestions(productId: string, tenantId: string) {
    await this.catalog.getOrThrow(productId, tenantId);
    const stock = await this.db.one<{
      on_hand: number; committed: number; available: number; reorder_level: number; reorder_qty: number;
    }>(
      `SELECT COALESCE(SUM(quantity_on_hand), 0) AS on_hand, COALESCE(SUM(quantity_committed), 0) AS committed,
              COALESCE(SUM(quantity_available), 0) AS available,
              COALESCE(MAX(reorder_level), 0) AS reorder_level, COALESCE(MAX(reorder_quantity), 0) AS reorder_qty
       FROM inventory_stock WHERE tenant_id = @t AND product_id = @p`,
      { t: tenantId, p: productId },
    );
    // "Incoming" = still on order and not yet physically arrived. Must use
    // received_qty (progress toward physical receipt), not billed_qty — billed_qty
    // tracks vendor-invoice reconciliation (short/over-shipment vs what was billed)
    // and stays NULL until a PO is invoiced, which is unrelated to whether the
    // goods have shown up at the dock. Using billed_qty here previously reported
    // the full original order quantity as "incoming" even after partial receiving.
    const incoming = await this.db.one<{ qty: number }>(
      `SELECT COALESCE(SUM(pol.quantity - COALESCE(pol.received_qty, 0)), 0) AS qty
       FROM purchase_order_lines pol JOIN purchase_orders po ON po.tenant_id = pol.tenant_id AND po.id = pol.po_id
       WHERE pol.tenant_id = @t AND pol.product_id = @p AND po.status IN ('ordered', 'partially_received')`,
      { t: tenantId, p: productId },
    );
    const velocity = await this.db.one<{ units: number }>(
      `SELECT COALESCE(SUM(ol.quantity), 0) AS units
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status = 'completed'
         AND o.created_at >= @cutoff`,
      { t: tenantId, p: productId, cutoff: Date.now() - 30 * DAY_MS },
    );
    const lastPo = await this.db.one<{ date: number }>(
      `SELECT MAX(po.created_at) AS date FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.tenant_id = pol.tenant_id AND po.id = pol.po_id
       WHERE pol.tenant_id = @t AND pol.product_id = @p`,
      { t: tenantId, p: productId },
    );

    const onHand = Number(stock?.on_hand ?? 0);
    const available = Number(stock?.available ?? 0);
    const reorderLevel = Number(stock?.reorder_level ?? 0);
    const reorderQty = Number(stock?.reorder_qty ?? 0);
    const incomingQty = Number(incoming?.qty ?? 0);
    const avgDaily = Number(velocity?.units ?? 0) / 30;
    const daysUntilStockout = avgDaily > 0 ? Math.floor(available / avgDaily) : Infinity;

    const suppliers = (await this.listSuppliers(productId, tenantId)).items;
    const preferred = suppliers.find((s) => s.is_preferred) ?? suppliers[0];
    const bestPrice = suppliers.reduce<typeof suppliers[number] | null>(
      (min, cur) => (cur.cost_cents != null && (min === null || (min.cost_cents ?? Infinity) > cur.cost_cents) ? cur : min),
      null,
    );

    let status: "suggested" | "ok" | "critical" = "ok";
    if (available <= 0) status = "critical";
    else if (reorderLevel > 0 && available <= reorderLevel) status = "suggested";

    const suggestedQty = status === "ok" ? 0 : (reorderQty > 0 ? reorderQty : Math.max(1, Math.ceil(avgDaily * 14)));

    return {
      current_stock: onHand,
      reserved_stock: Number(stock?.committed ?? 0),
      available_stock: available,
      incoming_stock: incomingQty,
      reorder_point: reorderLevel,
      safety_stock: reorderLevel,
      avg_daily_sales: Math.round(avgDaily * 100) / 100,
      days_until_stockout: Number.isFinite(daysUntilStockout) ? daysUntilStockout : -1,
      suggested_qty: suggestedQty,
      preferred_supplier_id: preferred?.vendor_id ?? "",
      preferred_supplier_name: preferred?.vendor_name ?? "",
      preferred_supplier_lead_days: preferred?.lead_time_days ?? 0,
      preferred_supplier_cost_cents: preferred?.cost_cents ?? 0,
      best_price_supplier_id: bestPrice?.vendor_id ?? "",
      best_price_supplier_name: bestPrice?.vendor_name ?? "",
      best_price_supplier_cost_cents: bestPrice?.cost_cents ?? 0,
      savings_per_unit_cents: preferred && bestPrice && preferred.cost_cents != null && bestPrice.cost_cents != null
        ? Math.max(0, preferred.cost_cents - bestPrice.cost_cents) : 0,
      reason: status === "critical" ? "Out of stock" : status === "suggested" ? "At or below reorder point" : "Stock healthy",
      last_reorder_date: lastPo?.date ? Number(lastPo.date) : null,
      open_po_qty: incomingQty,
      status,
    };
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  /**
   * ABC classification ranks this product's period revenue against every
   * other product's period revenue for the tenant (top 20% of cumulative
   * revenue = A, next 30% = B, rest = C) — a real Pareto pass, computed live
   * rather than cached. inventory_turnover approximates units_sold / current
   * on-hand (a period-agnostic point-in-time ratio, not COGS/average-inventory,
   * since historical inventory levels aren't retained anywhere).
   */
  async analytics(productId: string, tenantId: string, period: "7d" | "30d" | "90d" | "12m" = "30d") {
    await this.catalog.getOrThrow(productId, tenantId);
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
    const cutoff = Date.now() - days * DAY_MS;

    const trend = await this.db.query<{ date: number; units: number; revenue: number }>(
      `SELECT (o.created_at / 86400000) * 86400000 AS date,
              COALESCE(SUM(ol.quantity), 0) AS units, COALESCE(SUM(ol.line_cents), 0) AS revenue
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status IN ('completed', 'refunded')
         AND o.created_at >= @cutoff
       GROUP BY 1 ORDER BY 1 ASC`,
      { t: tenantId, p: productId, cutoff },
    );

    const summary = await this.db.one<{ revenue: number; units: number; orders: number }>(
      `SELECT COALESCE(SUM(ol.line_cents), 0) AS revenue, COALESCE(SUM(ol.quantity), 0) AS units,
              COUNT(DISTINCT o.id) AS orders
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status IN ('completed', 'refunded')
         AND o.created_at >= @cutoff`,
      { t: tenantId, p: productId, cutoff },
    );
    const returns = await this.db.one<{ qty: number }>(
      `SELECT COALESCE(SUM(ol.quantity), 0) AS qty
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND ol.product_id = @p AND o.status = 'refunded' AND o.created_at >= @cutoff`,
      { t: tenantId, p: productId, cutoff },
    );
    const onHand = await this.db.one<{ qty: number }>(
      "SELECT COALESCE(SUM(quantity_on_hand), 0) AS qty FROM inventory_stock WHERE tenant_id = @t AND product_id = @p",
      { t: tenantId, p: productId },
    );

    const revenueCents = Number(summary?.revenue ?? 0);
    const unitsSold = Number(summary?.units ?? 0);
    const orders = Number(summary?.orders ?? 0);
    const product = await this.catalog.getOrThrow(productId, tenantId);
    const costCents = Number(product.raw_cost_price_cents ?? 0);
    const grossMarginPct = revenueCents > 0 ? ((revenueCents - costCents * unitsSold) / revenueCents) * 100 : 0;
    const onHandQty = Number(onHand?.qty ?? 0);

    // ABC: this product's revenue-rank among all products' revenue over the same period.
    const ranked = await this.db.query<{ product_id: string; revenue: number }>(
      `SELECT ol.product_id, SUM(ol.line_cents) AS revenue
       FROM order_lines ol JOIN orders o ON o.tenant_id = ol.tenant_id AND o.id = ol.order_id
       WHERE ol.tenant_id = @t AND o.status IN ('completed', 'refunded') AND o.created_at >= @cutoff
       GROUP BY ol.product_id ORDER BY revenue DESC`,
      { t: tenantId, cutoff },
    );
    const totalRevenue = ranked.reduce((s, r) => s + Number(r.revenue), 0);
    let cumulative = 0;
    let abcClass: "A" | "B" | "C" = "C";
    for (const r of ranked) {
      cumulative += Number(r.revenue);
      const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1;
      if (r.product_id === productId) {
        abcClass = pct <= 0.2 ? "A" : pct <= 0.5 ? "B" : "C";
        break;
      }
    }

    return {
      period,
      trend: trend.map((t) => ({ date: Number(t.date), units: Number(t.units), revenue_cents: Number(t.revenue) })),
      summary: {
        revenue_cents: revenueCents,
        units_sold: unitsSold,
        orders,
        avg_order_qty: orders > 0 ? Math.round((unitsSold / orders) * 100) / 100 : 0,
        return_rate_pct: unitsSold > 0 ? Math.round((Number(returns?.qty ?? 0) / unitsSold) * 10000) / 100 : 0,
        gross_margin_pct: Math.round(grossMarginPct * 100) / 100,
        inventory_turnover: onHandQty > 0 ? Math.round((unitsSold / onHandQty) * 100) / 100 : 0,
        abc_class: abcClass,
      },
    };
  }

  // ── Pricing (tiered quantity breaks + wholesale/MAP) ────────────────────────

  async pricing(productId: string, tenantId: string) {
    const product = await this.catalog.getOrThrow(productId, tenantId);
    const tiers = await this.db.query<ProductPriceTier>(
      "SELECT * FROM product_price_tiers WHERE tenant_id = @t AND product_id = @p ORDER BY min_qty ASC",
      { t: tenantId, p: productId },
    );
    return {
      tiers,
      // No price-book subsystem exists yet (see tools/api-gap-allowlist.json —
      // /api/v1/pricing/* is a Preview vertical); this list is intentionally
      // empty rather than fabricated until that subsystem is built.
      price_books: [] as Array<{ id: string; price_book_id: string; price_book_name: string; price_cents: number; active: boolean }>,
      wholesale_price_cents: product.wholesale_price_cents ?? null,
      map_price_cents: (product as unknown as { map_price_cents?: number | null }).map_price_cents ?? null,
    };
  }

  async updatePricing(productId: string, tenantId: string, input: { wholesale_price_cents?: number | null; map_price_cents?: number | null }): Promise<void> {
    await this.catalog.getOrThrow(productId, tenantId);
    await this.db.query(
      `UPDATE products SET
         wholesale_price_cents = CASE WHEN @hasWholesale THEN @wholesale ELSE wholesale_price_cents END,
         map_price_cents = CASE WHEN @hasMap THEN @map ELSE map_price_cents END,
         updated_at = @now
       WHERE id = @id AND tenant_id = @t`,
      {
        id: productId, t: tenantId, now: Date.now(),
        hasWholesale: input.wholesale_price_cents !== undefined, wholesale: input.wholesale_price_cents ?? null,
        hasMap: input.map_price_cents !== undefined, map: input.map_price_cents ?? null,
      },
    );
  }

  async addPriceTier(productId: string, tenantId: string, input: { min_qty: number; price_cents: number; label?: string | null }): Promise<ProductPriceTier> {
    await this.catalog.getOrThrow(productId, tenantId);
    if (input.min_qty <= 0) throw badRequest("min_qty must be positive");
    const id = `ptier_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      `INSERT INTO product_price_tiers (id, tenant_id, product_id, min_qty, price_cents, label, created_at)
       VALUES (@id, @t, @p, @minQty, @priceCents, @label, @now)`,
      { id, t: tenantId, p: productId, minQty: input.min_qty, priceCents: input.price_cents, label: input.label ?? null, now },
    );
    return { id, product_id: productId, min_qty: input.min_qty, price_cents: input.price_cents, label: input.label ?? null, created_at: now };
  }

  async deletePriceTier(tierId: string, productId: string, tenantId: string): Promise<void> {
    const row = await this.db.one<{ id: string }>(
      "SELECT id FROM product_price_tiers WHERE id = @id AND tenant_id = @t AND product_id = @p",
      { id: tierId, t: tenantId, p: productId },
    );
    if (!row) throw notFound(`price tier '${tierId}' not found`);
    await this.db.query("DELETE FROM product_price_tiers WHERE id = @id AND tenant_id = @t", { id: tierId, t: tenantId });
  }

  // ── Expiry (extends inventory_lots — see index.ts migration note) ──────────

  private async decorateExpiry(rows: Array<Omit<ProductExpiryRecord, "expiry_status" | "days_until_expiry">>): Promise<ProductExpiryRecord[]> {
    const now = Date.now();
    return rows.map((r) => {
      const daysUntil = r.expiry_date ? Math.floor((r.expiry_date - now) / DAY_MS) : null;
      return { ...r, days_until_expiry: daysUntil, expiry_status: expiryStatus(daysUntil) };
    });
  }

  async listExpiry(productId: string, tenantId: string): Promise<{ items: ProductExpiryRecord[] }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const rows = await this.db.query<Omit<ProductExpiryRecord, "expiry_status" | "days_until_expiry">>(
      `SELECT lot.id, lot.product_id, lot.batch_number, lot.lot_code, lot.qty_on_hand AS quantity,
              lot.unit_cost_cents, lot.expiry_date, lot.received_at,
              s.name AS supplier_name, loc.name AS location_name, lot.notes,
              lot.received_at AS created_at, COALESCE(lot.updated_at, lot.received_at) AS updated_at
       FROM inventory_lots lot
       LEFT JOIN purchase_orders po ON po.tenant_id = lot.tenant_id AND po.id = lot.po_id
       LEFT JOIN suppliers s ON s.tenant_id = po.tenant_id AND s.id = po.supplier_id
       LEFT JOIN inventory_locations loc ON loc.tenant_id = lot.tenant_id AND loc.id = lot.location_id
       WHERE lot.tenant_id = @t AND lot.product_id = @p
       ORDER BY lot.expiry_date ASC NULLS LAST`,
      { t: tenantId, p: productId },
    );
    return { items: await this.decorateExpiry(rows) };
  }

  async addExpiry(productId: string, tenantId: string, input: {
    batch_number?: string | null; lot_code?: string | null; quantity: number; unit_cost_cents?: number | null;
    expiry_date?: number | null; location_id?: string | null; notes?: string | null;
  }): Promise<ProductExpiryRecord> {
    await this.catalog.getOrThrow(productId, tenantId);
    if (input.quantity <= 0) throw badRequest("quantity must be positive");
    const id = `lot_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      `INSERT INTO inventory_lots
         (id, tenant_id, product_id, batch_number, lot_code, expiry_date, qty_on_hand, unit_cost_cents, location_id, notes, received_at, updated_at)
       VALUES (@id, @t, @p, @batchNumber, @lotCode, @expiryDate, @quantity, @unitCost, @locationId, @notes, @now, @now)`,
      {
        id, t: tenantId, p: productId, batchNumber: input.batch_number ?? null, lotCode: input.lot_code ?? null,
        expiryDate: input.expiry_date ?? null, quantity: input.quantity, unitCost: input.unit_cost_cents ?? 0,
        locationId: input.location_id ?? null, notes: input.notes ?? null, now,
      },
    );
    return this.getExpiryOrThrow(id, productId, tenantId);
  }

  private async getExpiryOrThrow(id: string, productId: string, tenantId: string): Promise<ProductExpiryRecord> {
    const rows = await this.db.query<Omit<ProductExpiryRecord, "expiry_status" | "days_until_expiry">>(
      `SELECT lot.id, lot.product_id, lot.batch_number, lot.lot_code, lot.qty_on_hand AS quantity,
              lot.unit_cost_cents, lot.expiry_date, lot.received_at,
              s.name AS supplier_name, loc.name AS location_name, lot.notes,
              lot.received_at AS created_at, COALESCE(lot.updated_at, lot.received_at) AS updated_at
       FROM inventory_lots lot
       LEFT JOIN purchase_orders po ON po.tenant_id = lot.tenant_id AND po.id = lot.po_id
       LEFT JOIN suppliers s ON s.tenant_id = po.tenant_id AND s.id = po.supplier_id
       LEFT JOIN inventory_locations loc ON loc.tenant_id = lot.tenant_id AND loc.id = lot.location_id
       WHERE lot.id = @id AND lot.tenant_id = @t AND lot.product_id = @p`,
      { id, t: tenantId, p: productId },
    );
    if (rows.length === 0) throw notFound(`expiry record '${id}' not found`);
    return (await this.decorateExpiry(rows))[0]!;
  }

  async updateExpiry(id: string, productId: string, tenantId: string, input: {
    batch_number?: string | null; lot_code?: string | null; quantity?: number; unit_cost_cents?: number | null;
    expiry_date?: number | null; location_id?: string | null; notes?: string | null;
  }): Promise<ProductExpiryRecord> {
    await this.getExpiryOrThrow(id, productId, tenantId);
    await this.db.query(
      `UPDATE inventory_lots SET
         batch_number = COALESCE(@batchNumber, batch_number),
         lot_code = COALESCE(@lotCode, lot_code),
         qty_on_hand = COALESCE(@quantity, qty_on_hand),
         unit_cost_cents = COALESCE(@unitCost, unit_cost_cents),
         expiry_date = COALESCE(@expiryDate, expiry_date),
         location_id = COALESCE(@locationId, location_id),
         notes = COALESCE(@notes, notes),
         updated_at = @now
       WHERE id = @id AND tenant_id = @t AND product_id = @p`,
      {
        id, t: tenantId, p: productId, batchNumber: input.batch_number ?? null, lotCode: input.lot_code ?? null,
        quantity: input.quantity ?? null, unitCost: input.unit_cost_cents ?? null, expiryDate: input.expiry_date ?? null,
        locationId: input.location_id ?? null, notes: input.notes ?? null, now: Date.now(),
      },
    );
    return this.getExpiryOrThrow(id, productId, tenantId);
  }

  async deleteExpiry(id: string, productId: string, tenantId: string): Promise<void> {
    await this.getExpiryOrThrow(id, productId, tenantId);
    await this.db.query("DELETE FROM inventory_lots WHERE id = @id AND tenant_id = @t AND product_id = @p", { id, t: tenantId, p: productId });
  }

  // ── Images (patch is_primary + nested delete) ───────────────────────────────

  async setPrimaryImage(imageId: string, productId: string, tenantId: string): Promise<void> {
    const row = await this.db.one<{ id: string }>(
      "SELECT id FROM product_images WHERE id = @id AND tenant_id = @t AND product_id = @p",
      { id: imageId, t: tenantId, p: productId },
    );
    if (!row) throw notFound(`image '${imageId}' not found`);
    await this.db.query(
      "UPDATE product_images SET is_primary = false WHERE tenant_id = @t AND product_id = @p",
      { t: tenantId, p: productId },
    );
    await this.db.query(
      "UPDATE product_images SET is_primary = true WHERE id = @id AND tenant_id = @t",
      { id: imageId, t: tenantId },
    );
  }

  async deleteImageScoped(imageId: string, productId: string, tenantId: string): Promise<void> {
    const row = await this.db.one<{ id: string }>(
      "SELECT id FROM product_images WHERE id = @id AND tenant_id = @t AND product_id = @p",
      { id: imageId, t: tenantId, p: productId },
    );
    if (!row) throw notFound(`image '${imageId}' not found`);
    await this.db.query("DELETE FROM product_images WHERE id = @id AND tenant_id = @t", { id: imageId, t: tenantId });
  }

  // ── Audit log ────────────────────────────────────────────────────────────────

  /**
   * Flattens audit_log rows (one row per CatalogService mutation, written by
   * writeAudit — see service.ts) into one AuditEntry per changed field, which
   * is the shape web/.../AuditLogTab.tsx expects. "reason" is always null and
   * ip/device are always "—": neither is captured anywhere in the write path
   * today (writeAudit doesn't take them, and nothing upstream threads a
   * request's IP/user-agent through to the service layer) — surfaced here
   * honestly rather than fabricated.
   */
  async auditLog(productId: string, tenantId: string, limit = 200): Promise<{ items: Array<{
    id: string; product_id: string; actor: string; actor_role: string;
    action: "create" | "update" | "delete" | "archive"; field: string | null;
    old_value: string | null; new_value: string | null; reason: string | null;
    ip: string; device: string; created_at: number;
  }>; total: number }> {
    await this.catalog.getOrThrow(productId, tenantId);
    const capped = Math.min(Math.max(limit, 1), 500);
    const rows = await this.db.query<{
      id: string; actor_id: string; actor_email: string | null; actor_role: string | null;
      action: string; before_state: string | null; after_state: string | null; occurred_at: number;
    }>(
      `SELECT al.id, al.actor_id, u.email AS actor_email, u.role AS actor_role,
              al.action, al.before_state, al.after_state, al.occurred_at
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id AND u.tenant_id = al.tenant_id
       WHERE al.tenant_id = @t AND al.entity_type = 'product' AND al.entity_id = @p
       ORDER BY al.occurred_at DESC, al.id DESC
       LIMIT @limit`,
      { t: tenantId, p: productId, limit: capped },
    );

    const actionMap: Record<string, "create" | "update" | "delete" | "archive"> = {
      "product.created": "create", "product.archived": "archive", "product.updated": "update",
    };

    const items: Array<{
      id: string; product_id: string; actor: string; actor_role: string;
      action: "create" | "update" | "delete" | "archive"; field: string | null;
      old_value: string | null; new_value: string | null; reason: string | null;
      ip: string; device: string; created_at: number;
    }> = [];
    for (const row of rows) {
      const action = actionMap[row.action] ?? "update";
      const actor = row.actor_id === "system" ? "System" : (row.actor_email ?? row.actor_id);
      const actorRole = row.actor_role ?? "system";
      let before: Record<string, unknown> = {};
      let after: Record<string, unknown> = {};
      try { before = row.before_state ? JSON.parse(row.before_state) : {}; } catch { /* malformed row, skip fields */ }
      try { after = row.after_state ? JSON.parse(row.after_state) : {}; } catch { /* malformed row, skip fields */ }
      const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
      if (fields.size === 0) {
        // create() with no prior field diff — one summary row.
        items.push({
          id: row.id, product_id: productId, actor, actor_role: actorRole, action,
          field: null, old_value: null, new_value: after["sku"] ? String(after["sku"]) : null,
          reason: null, ip: "—", device: "—", created_at: Number(row.occurred_at),
        });
        continue;
      }
      for (const field of fields) {
        items.push({
          id: `${row.id}_${field}`, product_id: productId, actor, actor_role: actorRole, action,
          field,
          old_value: before[field] !== undefined && before[field] !== null ? String(before[field]) : null,
          new_value: after[field] !== undefined && after[field] !== null ? String(after[field]) : null,
          reason: null, ip: "—", device: "—", created_at: Number(row.occurred_at),
        });
      }
    }
    return { items, total: items.length };
  }

  // ── Duplicate ────────────────────────────────────────────────────────────────

  /** Clone a product: same fields, new id/sku (suffixed, deduplicated against
   *  existing SKUs), draft status, no sales/purchase history carried over. */
  async duplicate(productId: string, tenantId: string) {
    const source = await this.catalog.getOrThrow(productId, tenantId);
    let suffix = 1;
    let sku = `${source.sku}-COPY`;
    while (await this.db.one("SELECT id FROM products WHERE tenant_id = @t AND sku = @sku", { t: tenantId, sku })) {
      suffix += 1;
      sku = `${source.sku}-COPY${suffix}`;
    }
    return this.catalog.create(
      {
        sku,
        name: `${source.name} (Copy)`,
        price_cents: source.price_cents,
        category: source.category,
        tax_class: source.tax_class,
        status: "draft",
        description: source.description,
        brand: source.brand,
        msrp_cents: source.msrp_cents,
        raw_cost_price_cents: source.raw_cost_price_cents,
        wholesale_price_cents: source.wholesale_price_cents,
      },
      tenantId,
    );
  }
}
