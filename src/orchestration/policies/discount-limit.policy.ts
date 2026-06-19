/**
 * Discount Limit Policy
 *
 * Enforces maximum discount thresholds per role and order type.
 * Prevents unauthorized over-discounting.
 */

export type UserRole = "cashier" | "supervisor" | "manager" | "owner" | "admin";

const ROLE_MAX_DISCOUNT_PCT: Record<UserRole, number> = {
  cashier: 10,
  supervisor: 20,
  manager: 40,
  owner: 100,
  admin: 100,
};

const ABSOLUTE_MAX_DISCOUNT_CENTS = 50_000; // $500

export interface DiscountValidationInput {
  discountPercent: number;
  discountCents: number;
  orderTotalCents: number;
  userId: string;
  userRole: UserRole;
}

export interface DiscountValidationResult {
  allowed: boolean;
  maxAllowedPercent: number;
  reason?: string;
}

export function validateDiscount(input: DiscountValidationInput): DiscountValidationResult {
  const maxPct = ROLE_MAX_DISCOUNT_PCT[input.userRole] ?? 0;

  if (input.discountPercent > maxPct) {
    return {
      allowed: false,
      maxAllowedPercent: maxPct,
      reason: `role '${input.userRole}' may not discount more than ${maxPct}%`,
    };
  }

  if (input.discountCents > ABSOLUTE_MAX_DISCOUNT_CENTS) {
    return {
      allowed: false,
      maxAllowedPercent: maxPct,
      reason: `discount $${(input.discountCents / 100).toFixed(2)} exceeds absolute maximum`,
    };
  }

  return { allowed: true, maxAllowedPercent: maxPct };
}
