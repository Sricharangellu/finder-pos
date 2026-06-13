import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";

/** Customers + loyalty. Tenant-scoped. Points are earned on payment.captured
 *  ($1 net spent = 1 point) and redeemed at 100 points = $5.00. */

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  created_at: number;
  updated_at: number;
}

export interface CreateCustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface CustomerSummary {
  customer: { id: string; name: string; email: string | null; phone: string | null; points: number };
  visits: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastVisitAt: number | null;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; totalCents: number; createdAt: number }>;
}

/** Redemption rate: 100 points → 500 cents ($5.00). */
export const POINTS_PER_REDEEM_BLOCK = 100;
export const CENTS_PER_REDEEM_BLOCK = 500;

export class CustomersService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateCustomerInput, tenantId: string): Promise<Customer> {
    const now = Date.now();
    const row: Customer = {
      id: `cus_${uuidv7()}`,
      tenant_id: tenantId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      points: 0,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO customers (id, tenant_id, name, email, phone, points, created_at, updated_at)
       VALUES (@id, @tenant_id, @name, @email, @phone, @points, @created_at, @updated_at)`,
      row as unknown as Record<string, unknown>,
    );
    await this.events.publish("customer.created", { id: row.id, tenantId }, row.id);
    return row;
  }

  async get(id: string, tenantId: string): Promise<Customer | undefined> {
    return this.db.one<Customer>(
      "SELECT * FROM customers WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  async list(tenantId: string): Promise<Customer[]> {
    return this.db.query<Customer>(
      "SELECT * FROM customers WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT 200",
      { tenantId },
    );
  }

  /** Add points to a customer (idempotency is the caller's concern). */
  async awardPoints(customerId: string, points: number, tenantId: string): Promise<void> {
    if (points <= 0) return;
    await this.db.query(
      `UPDATE customers SET points = points + @points, updated_at = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      { points, now: Date.now(), id: customerId, tenantId },
    );
    await this.events.publish(
      "loyalty.points_awarded",
      { customerId, tenantId, points },
      customerId,
    );
  }

  /** Redeem points for a cash-value discount. Must be a positive multiple of 100. */
  async redeem(
    customerId: string,
    points: number,
    tenantId: string,
  ): Promise<{ pointsRemaining: number; valueCents: number }> {
    if (points <= 0 || points % POINTS_PER_REDEEM_BLOCK !== 0) {
      throw new HttpError(400, "bad_request", `points must be a positive multiple of ${POINTS_PER_REDEEM_BLOCK}`);
    }
    const customer = await this.get(customerId, tenantId);
    if (!customer) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    if (customer.points < points) {
      throw new HttpError(400, "insufficient_points", `balance ${customer.points} < requested ${points}`);
    }
    const remaining = customer.points - points;
    await this.db.query(
      "UPDATE customers SET points = @remaining, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { remaining, now: Date.now(), id: customerId, tenantId },
    );
    const valueCents = (points / POINTS_PER_REDEEM_BLOCK) * CENTS_PER_REDEEM_BLOCK;
    await this.events.publish(
      "loyalty.points_redeemed",
      { customerId, tenantId, points, valueCents },
      customerId,
    );
    return { pointsRemaining: remaining, valueCents };
  }

  /** CRM summary: lifetime spend, visits, last visit, and a recent-orders timeline.
   *  Aggregates the shared orders table (completed orders) for this customer. */
  async summary(customerId: string, tenantId: string): Promise<CustomerSummary> {
    const customer = await this.get(customerId, tenantId);
    if (!customer) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    const agg = await this.db.one<{ visits: number; spent: number; last: number | null }>(
      `SELECT COUNT(*)::int AS visits, COALESCE(SUM(total_cents),0) AS spent, MAX(created_at) AS last
         FROM orders WHERE tenant_id = @tenantId AND customer_id = @customerId AND status = 'completed'`,
      { tenantId, customerId },
    );
    const recent = await this.db.query<{ id: string; order_number: string; status: string; total_cents: number; created_at: number }>(
      `SELECT id, order_number, status, total_cents, created_at
         FROM orders WHERE tenant_id = @tenantId AND customer_id = @customerId
        ORDER BY created_at DESC LIMIT 10`,
      { tenantId, customerId },
    );
    const visits = Number(agg?.visits ?? 0);
    const totalSpentCents = Number(agg?.spent ?? 0);
    return {
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, points: Number(customer.points) },
      visits,
      totalSpentCents,
      avgOrderCents: visits > 0 ? Math.round(totalSpentCents / visits) : 0,
      lastVisitAt: agg?.last != null ? Number(agg.last) : null,
      recentOrders: recent.map((o) => ({
        id: o.id, orderNumber: o.order_number, status: o.status, totalCents: Number(o.total_cents), createdAt: Number(o.created_at),
      })),
    };
  }

  /** Resolve which customer (if any) an order belongs to. Reads the shared orders table. */
  async customerForOrder(orderId: string, tenantId: string): Promise<string | null> {
    const row = await this.db.one<{ customer_id: string | null }>(
      "SELECT customer_id FROM orders WHERE id = @orderId AND tenant_id = @tenantId",
      { orderId, tenantId },
    );
    return row?.customer_id ?? null;
  }
}
