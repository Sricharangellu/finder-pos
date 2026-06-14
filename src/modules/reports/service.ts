import type { DB } from "../../shared/db.js";

/** Tenant-scoped sales analytics. Read-only over the orders + order_lines +
 *  payments tables (a lightweight read model / CQRS-lite — reports owns no
 *  tables of its own). Supports a time window via `sinceMs` (epoch ms). */

export interface SalesSummary {
  orders: { open: number; completed: number; refunded: number; voided: number; total: number };
  /** Revenue recognised from completed orders. */
  revenue: { grossCents: number; taxCents: number; netCents: number };
  payments: { capturedCount: number; capturedCents: number; byMethod: Record<string, number> };
}

export interface TopProduct {
  productId: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface HourlyBucket {
  hour: number;        // 0–23 (UTC)
  label: string;       // "8 AM"
  orderCount: number;
  revenueCents: number;
  value: number;       // 0–100 index relative to the busiest hour
}

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export interface AgingRow {
  partyId: string; // customer_id (AR) or supplier_id (AP)
  buckets: AgingBuckets;
}

export interface AgingReport {
  totals: AgingBuckets;
  parties: AgingRow[];
}

export interface SalesByGroup {
  key: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface ValuationRow {
  productId: string;
  name: string;
  stockQty: number;
  costCents: number;
  retailCents: number;
  costValueCents: number;
  retailValueCents: number;
}

export interface Valuation {
  rows: ValuationRow[];
  totalCostCents: number;
  totalRetailCents: number;
}

const emptyBuckets = (): AgingBuckets => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });

/** Place an outstanding balance into an aging bucket by days overdue. */
function addToBucket(b: AgingBuckets, balance: number, dueDate: number | null, now: number): void {
  const daysOverdue = dueDate ? Math.floor((now - dueDate) / 86_400_000) : 0;
  if (daysOverdue <= 0) b.current += balance;
  else if (daysOverdue <= 30) b.d1_30 += balance;
  else if (daysOverdue <= 60) b.d31_60 += balance;
  else if (daysOverdue <= 90) b.d61_90 += balance;
  else b.d90_plus += balance;
  b.total += balance;
}

export class ReportsService {
  constructor(private readonly db: DB) {}

  async salesSummary(tenantId: string, sinceMs?: number): Promise<SalesSummary> {
    const since = sinceMs ?? 0;
    const orderRows = await this.db.query<{ status: string; n: number }>(
      "SELECT status, COUNT(*)::int AS n FROM orders WHERE tenant_id = @tenantId AND created_at >= @since GROUP BY status",
      { tenantId, since },
    );
    const orders = { open: 0, completed: 0, refunded: 0, voided: 0, total: 0 };
    for (const r of orderRows) {
      const n = Number(r.n);
      if (r.status in orders) (orders as Record<string, number>)[r.status] = n;
      orders.total += n;
    }

    const rev = await this.db.one<{ gross: number; tax: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS gross, COALESCE(SUM(tax_cents), 0) AS tax
         FROM orders WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since`,
      { tenantId, since },
    );
    const grossCents = Number(rev?.gross ?? 0);
    const taxCents = Number(rev?.tax ?? 0);

    const payRows = await this.db.query<{ method: string; amt: number; n: number }>(
      `SELECT method, COALESCE(SUM(amount_cents), 0) AS amt, COUNT(*)::int AS n
         FROM payments WHERE tenant_id = @tenantId AND status = 'captured' AND created_at >= @since
        GROUP BY method`,
      { tenantId, since },
    );
    const byMethod: Record<string, number> = {};
    let capturedCount = 0;
    let capturedCents = 0;
    for (const r of payRows) {
      byMethod[r.method] = Number(r.amt);
      capturedCount += Number(r.n);
      capturedCents += Number(r.amt);
    }

    return {
      orders,
      revenue: { grossCents, taxCents, netCents: grossCents - taxCents },
      payments: { capturedCount, capturedCents, byMethod },
    };
  }

  /** Best-selling products by revenue from completed orders in the window. */
  async topProducts(tenantId: string, sinceMs?: number, limit = 10): Promise<TopProduct[]> {
    const since = sinceMs ?? 0;
    const lim = Math.min(Math.max(limit, 1), 50);
    const rows = await this.db.query<{ product_id: string; name: string; units: number; revenue: number }>(
      `SELECT ol.product_id, MAX(ol.name) AS name,
              SUM(ol.quantity)::int AS units,
              SUM(ol.line_cents) AS revenue
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY ol.product_id
        ORDER BY revenue DESC
        LIMIT @limit`,
      { tenantId, since, limit: lim },
    );
    return rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      units: Number(r.units),
      revenueCents: Number(r.revenue),
    }));
  }

  /** Sales bucketed by hour-of-day (UTC) from completed orders in the window.
   *  Returns all 24 hours; `value` is a 0–100 index vs the busiest hour. */
  async hourly(tenantId: string, sinceMs?: number): Promise<HourlyBucket[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ hour: number; orders: number; revenue: number }>(
      `SELECT EXTRACT(HOUR FROM to_timestamp(created_at / 1000.0))::int AS hour,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_cents), 0) AS revenue
         FROM orders
        WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since
        GROUP BY hour`,
      { tenantId, since },
    );
    const byHour = new Map<number, { orders: number; revenue: number }>();
    let max = 0;
    for (const r of rows) {
      const revenue = Number(r.revenue);
      byHour.set(Number(r.hour), { orders: Number(r.orders), revenue });
      if (revenue > max) max = revenue;
    }
    return Array.from({ length: 24 }, (_, hour) => {
      const b = byHour.get(hour) ?? { orders: 0, revenue: 0 };
      return {
        hour,
        label: hourLabel(hour),
        orderCount: b.orders,
        revenueCents: b.revenue,
        value: max > 0 ? Math.round((b.revenue / max) * 100) : 0,
      };
    });
  }

  /** Accounts Receivable aging — open invoice balances bucketed by days overdue. */
  async arAging(tenantId: string, now = Date.now()): Promise<AgingReport> {
    const rows = await this.db.query<{ customer_id: string; balance: number; due_date: number | null }>(
      `SELECT customer_id, (total_cents - paid_cents) AS balance, due_date
         FROM invoices
        WHERE tenant_id = @t AND status <> 'void' AND (total_cents - paid_cents) > 0`,
      { t: tenantId },
    );
    return this.buildAging(rows.map((r) => ({ partyId: r.customer_id, balance: Number(r.balance), dueDate: r.due_date })), now);
  }

  /** Accounts Payable aging — open supplier bill balances bucketed by days overdue. */
  async apAging(tenantId: string, now = Date.now()): Promise<AgingReport> {
    const rows = await this.db.query<{ supplier_id: string; balance: number; due_date: number | null }>(
      `SELECT supplier_id, (total_cents - paid_cents) AS balance, due_date
         FROM bills
        WHERE tenant_id = @t AND status <> 'void' AND (total_cents - paid_cents) > 0`,
      { t: tenantId },
    );
    return this.buildAging(rows.map((r) => ({ partyId: r.supplier_id, balance: Number(r.balance), dueDate: r.due_date })), now);
  }

  private buildAging(rows: Array<{ partyId: string; balance: number; dueDate: number | null }>, now: number): AgingReport {
    const totals = emptyBuckets();
    const byParty = new Map<string, AgingBuckets>();
    for (const r of rows) {
      if (!byParty.has(r.partyId)) byParty.set(r.partyId, emptyBuckets());
      addToBucket(byParty.get(r.partyId)!, r.balance, r.dueDate, now);
      addToBucket(totals, r.balance, r.dueDate, now);
    }
    return { totals, parties: Array.from(byParty, ([partyId, buckets]) => ({ partyId, buckets })).sort((a, b) => b.buckets.total - a.buckets.total) };
  }

  /** Revenue + units grouped by product category (completed orders in window). */
  async salesByCategory(tenantId: string, sinceMs?: number): Promise<SalesByGroup[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ key: string; units: number; revenue: number }>(
      `SELECT COALESCE(p.category, 'Uncategorized') AS key,
              SUM(ol.quantity)::int AS units, SUM(ol.line_cents) AS revenue
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
         LEFT JOIN products p ON p.id = ol.product_id AND p.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @t AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY key ORDER BY revenue DESC`,
      { t: tenantId, since },
    );
    return rows.map((r) => ({ key: r.key, name: r.key, units: Number(r.units), revenueCents: Number(r.revenue) }));
  }

  /** Revenue + order units grouped by customer (completed orders in window). */
  async salesByCustomer(tenantId: string, sinceMs?: number): Promise<SalesByGroup[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ key: string; name: string; units: number; revenue: number }>(
      `SELECT o.customer_id AS key, COALESCE(MAX(c.name), 'Walk-in') AS name,
              COUNT(*)::int AS units, SUM(o.total_cents) AS revenue
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
        WHERE o.tenant_id = @t AND o.status = 'completed' AND o.created_at >= @since AND o.customer_id IS NOT NULL
        GROUP BY o.customer_id ORDER BY revenue DESC`,
      { t: tenantId, since },
    );
    return rows.map((r) => ({ key: r.key, name: r.name, units: Number(r.units), revenueCents: Number(r.revenue) }));
  }

  /** Inventory valuation at cost and retail (on-hand qty × cost / price). */
  async inventoryValuation(tenantId: string): Promise<Valuation> {
    const rows = await this.db.query<{ product_id: string; name: string; stock_qty: number; cost_cents: number | null; price_cents: number | null }>(
      `SELECT i.product_id, COALESCE(p.name, i.product_id) AS name, i.stock_qty,
              pc.cost_cents, p.price_cents
         FROM inventory i
         LEFT JOIN products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
         LEFT JOIN product_costs pc ON pc.product_id = i.product_id AND pc.tenant_id = i.tenant_id
        WHERE i.tenant_id = @t AND i.stock_qty > 0
        ORDER BY i.stock_qty DESC`,
      { t: tenantId },
    );
    let totalCost = 0, totalRetail = 0;
    const out: ValuationRow[] = rows.map((r) => {
      const qty = Number(r.stock_qty);
      const cost = Number(r.cost_cents ?? 0);
      const retail = Number(r.price_cents ?? 0);
      const costValue = cost * qty;
      const retailValue = retail * qty;
      totalCost += costValue; totalRetail += retailValue;
      return { productId: r.product_id, name: r.name, stockQty: qty, costCents: cost, retailCents: retail, costValueCents: costValue, retailValueCents: retailValue };
    });
    return { rows: out, totalCostCents: totalCost, totalRetailCents: totalRetail };
  }
}
