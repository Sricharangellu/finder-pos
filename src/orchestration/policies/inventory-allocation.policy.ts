/**
 * Inventory Allocation Policy
 *
 * Decides how to allocate available inventory across competing demands
 * (walk-in POS vs ecommerce orders vs transfers).
 */

export type DemandPriority = "walk_in" | "ecommerce" | "transfer" | "reservation";

export interface AllocationRequest {
  productId: string;
  quantity: number;
  priority: DemandPriority;
  tenantId: string;
}

export interface AllocationDecision {
  canAllocate: boolean;
  allocatedQty: number;
  shortfall: number;
  reason: string;
}

const PRIORITY_ORDER: DemandPriority[] = ["walk_in", "ecommerce", "transfer", "reservation"];

export function getPriorityScore(priority: DemandPriority): number {
  return PRIORITY_ORDER.length - PRIORITY_ORDER.indexOf(priority);
}

export function canAllocate(available: number, request: AllocationRequest): AllocationDecision {
  if (available <= 0) {
    return { canAllocate: false, allocatedQty: 0, shortfall: request.quantity, reason: "no_stock" };
  }
  if (available >= request.quantity) {
    return { canAllocate: true, allocatedQty: request.quantity, shortfall: 0, reason: "full_fill" };
  }
  // Walk-in POS always gets what's available; others get partial or nothing.
  if (request.priority === "walk_in") {
    return { canAllocate: true, allocatedQty: available, shortfall: request.quantity - available, reason: "partial_fill_walk_in" };
  }
  return { canAllocate: false, allocatedQty: 0, shortfall: request.quantity, reason: "insufficient_stock_for_priority" };
}
