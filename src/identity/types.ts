/**
 * RBAC roles for the Ascend platform.
 * owner > manager > cashier in terms of privilege.
 */
export type Role = "owner" | "manager" | "cashier";

/** Priority ordering — higher index = more privilege. */
export const ROLE_ORDER: Role[] = ["cashier", "manager", "owner"];

/** Returns true if `actual` is at least as privileged as `required`. */
export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(required);
}

export interface TokenClaims {
  sub: string;       // userId
  tenantId: string;
  role: Role;
  customRoleId?: string;
  permissions?: string[];
  jti?: string;
  iat?: number;
  exp?: number;
}

/** Row shape from the `users` table (platform schema). */
export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: Role;
  custom_role_id: string | null;
  mfa_enabled: boolean;
  /** Consecutive failed login attempts since last success or manual reset. */
  failed_login_attempts: number;
  /** Unix-ms timestamp until which the account is locked (NULL = not locked). */
  locked_until_ms: number | null;
  created_at: number;
  updated_at: number;
}

/** Row shape from the `custom_roles` table. */
export interface CustomRoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  permissions: string; // JSON array string
  created_at: number;
  updated_at: number;
}

/** Parsed custom role returned to clients. */
export interface CustomRole {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: number;
  updatedAt: number;
}

/** Row shape from the `tenants` table. */
export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_at: number;
}

/** Row shape from the `audit_log` table. */
export interface AuditLogRow {
  id: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: string | null;
  after_state: string | null;
  occurred_at: number;
  request_id: string | null;
}
