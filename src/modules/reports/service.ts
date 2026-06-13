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
}
