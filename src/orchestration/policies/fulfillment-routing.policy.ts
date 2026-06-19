/**
 * Fulfillment Routing Policy
 *
 * Determines which outlet/warehouse should fulfil a given order line.
 * Rules are evaluated in priority order; first match wins.
 */

export interface RoutingInput {
  productId: string;
  quantity: number;
  customerOutletId?: string;
  tenantId: string;
}

export interface RoutingDecision {
  outletId: string;
  strategy: "nearest" | "highest_stock" | "default";
  reason: string;
}

export async function determineFulfillmentRoute(
  input: RoutingInput,
  db: { one<T>(sql: string, p?: unknown): Promise<T | undefined>; query<T>(sql: string, p?: unknown): Promise<T[]> },
): Promise<RoutingDecision> {
  // Rule 1: If customer outlet has enough stock, fulfil locally.
  if (input.customerOutletId) {
    const local = await db.one<{ quantity: number }>(
      "SELECT quantity FROM inventory_items WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId",
      { productId: input.productId, outletId: input.customerOutletId, tenantId: input.tenantId },
    );
    if ((local?.quantity ?? 0) >= input.quantity) {
      return { outletId: input.customerOutletId, strategy: "nearest", reason: "local_stock_available" };
    }
  }

  // Rule 2: Route to outlet with highest stock.
  const best = await db.one<{ outlet_id: string; quantity: number }>(
    `SELECT outlet_id, quantity FROM inventory_items
      WHERE product_id = @productId AND tenant_id = @tenantId AND quantity >= @qty
      ORDER BY quantity DESC LIMIT 1`,
    { productId: input.productId, tenantId: input.tenantId, qty: input.quantity },
  );
  if (best) {
    return { outletId: best.outlet_id, strategy: "highest_stock", reason: "highest_available_stock" };
  }

  throw new Error(`no outlet has sufficient stock for product '${input.productId}' qty=${input.quantity}`);
}
