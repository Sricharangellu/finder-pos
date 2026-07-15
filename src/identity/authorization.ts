import type { Role } from "./types.js";

/**
 * Pure RBAC/entitlement rule evaluation, extracted out of the Express
 * middleware in src/gateway/auth.ts so the business rules (who can do what)
 * don't live inside HTTP-transport code. These functions have no Express
 * dependency and no side effects — the gateway middleware fetches whatever
 * data a rule needs (auth context, a DB row) and calls the matching function
 * here (evaluatePermission, comparePlans, evaluateCapability) to get a
 * boolean, then translates that boolean into the appropriate HTTP response.
 */

// ── Permission ────────────────────────────────────────────────────────────

/** owner/manager always pass; everyone else needs the permission in their list. */
export function evaluatePermission(
  auth: { role: Role; permissions: string[] },
  permission: string,
): boolean {
  if (auth.role === "owner" || auth.role === "manager") return true;
  return auth.permissions.includes(permission);
}

// ── Subscription plan hierarchy ──────────────────────────────────────────

// DB-13: Subscription plan hierarchy — each plan includes all plans below it.
export const PLAN_ORDER = ["starter", "growth", "professional", "enterprise", "platform"] as const;
export type Plan = (typeof PLAN_ORDER)[number];

/** Returns true if `actual` is at least as privileged as `required`. */
export function comparePlans(actual: string, required: Plan): boolean {
  const ai = PLAN_ORDER.indexOf(actual as Plan);
  const ri = PLAN_ORDER.indexOf(required);
  return ai >= ri;
}

// ── Tenant capability ─────────────────────────────────────────────────────

/** Deny-by-default: a missing row or a non-truthy `enabled` value means disabled. */
export function evaluateCapability(row: { enabled: boolean | number } | undefined): boolean {
  return row ? row.enabled === true || row.enabled === 1 : false;
}
