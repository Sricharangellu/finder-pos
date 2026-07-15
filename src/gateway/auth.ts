import { createHash } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../shared/http.js";
import type { Role } from "../identity/types.js";
import { hasRole } from "../identity/types.js";
import type { Plan } from "../identity/authorization.js";
import { comparePlans, evaluateCapability, evaluatePermission } from "../identity/authorization.js";
import type { DB } from "../shared/db.js";
import { runWithTenant } from "../shared/tenant-context.js";
import { SettingsService } from "../modules/settings/service.js";

export interface AuthPayload {
  tenantId: string;
  userId: string;
  role: Role;
  /** Store IDs this user is allowed to access. Empty array = all stores (owner/manager default). */
  storeIds: string[];
  /** Custom role ID when user has a tenant-defined role (Plus tier). */
  customRoleId?: string;
  /** Fine-grained permission strings granted by custom role (e.g. "orders:read"). */
  permissions: string[];
  /**
   * API key scopes. Empty array means no scope restrictions (regular JWT session).
   * Non-empty means the caller is an API key — use requireScope() to gate mutations.
   */
  scopes: string[];
}

// Augment Express Request so downstream handlers can read the auth context.
declare global {
  namespace Express {
    interface Locals {
      auth: AuthPayload;
      requestId: string;
      traceId: string;
      spanId: string;
    }
  }
}

/**
 * JWT authentication middleware. Reads a Bearer token from the Authorization
 * header, verifies its signature + expiry, and writes the decoded auth context
 * to `res.locals.auth`. Rejects with 401 if absent or invalid.
 *
 * The tenant-resolver middleware runs after this and uses `res.locals.auth.tenantId`
 * to scope every DB query.
 */
/**
 * Authorization guard factory: require at least `min` role (cashier < manager <
 * owner). Mounts after authMiddleware so `res.locals.auth` is populated.
 * Shared across modules for role-gating sensitive mutations.
 */
export function requireRole(min: Role) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const role = (res.locals["auth"] as AuthPayload | undefined)?.role ?? "cashier";
    if (!hasRole(role, min)) {
      next(new HttpError(403, "forbidden", `requires ${min} role`));
      return;
    }
    next();
  };
}

/**
 * Permission guard: checks that the authenticated user holds a specific
 * fine-grained permission string (from a custom role). Falls through if the
 * user's base role is owner/manager (they always have full access). Rejects
 * with 403 if the user's permissions list does not include `permission`.
 */
export function requirePermission(permission: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    if (!auth) {
      next(new HttpError(401, "unauthenticated", "Not authenticated."));
      return;
    }
    if (evaluatePermission(auth, permission)) {
      next();
      return;
    }
    next(new HttpError(403, "forbidden", `requires permission: ${permission}`));
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new HttpError(401, "unauthenticated", "Missing or malformed Authorization header."));
    return;
  }
  const token = header.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    next(new HttpError(500, "misconfigured", "JWT_SECRET environment variable is not set."));
    return;
  }
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const auth: AuthPayload = {
      tenantId: String(payload["tenantId"] ?? ""),
      userId: String(payload["sub"] ?? ""),
      role: (payload["role"] as Role) ?? "cashier",
      storeIds: Array.isArray(payload["storeIds"]) ? (payload["storeIds"] as string[]).map(String) : [],
      customRoleId: payload["customRoleId"] ? String(payload["customRoleId"]) : undefined,
      permissions: Array.isArray(payload["permissions"]) ? (payload["permissions"] as string[]).map(String) : [],
      scopes: [], // JWT sessions are unrestricted; scopes only apply to API key tokens
    };
    if (!auth.tenantId || !auth.userId) {
      next(new HttpError(401, "unauthenticated", "Token is missing required claims."));
      return;
    }
    res.locals["auth"] = auth;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new HttpError(401, "token_expired", "Access token has expired."));
    } else {
      next(new HttpError(401, "unauthenticated", "Invalid access token."));
    }
  }
}

/**
 * Enhanced auth middleware factory that handles both JWT sessions and API keys.
 * Use this in production (app.ts). The plain authMiddleware() above is kept
 * for tests that call it directly without a DB reference.
 *
 * API keys are identified by the "fpk_" prefix. Their scopes are read from
 * the api_keys table and stored in res.locals.auth.scopes. Use requireScope()
 * to gate routes that must not be called by read-only API keys.
 */
export function makeAuthMiddleware(db: DB): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      next(new HttpError(401, "unauthenticated", "Missing or malformed Authorization header."));
      return;
    }
    const token = header.slice(7);

    // ── API key path ──────────────────────────────────────────────────────────
    if (token.startsWith("fpk_")) {
      const prefix = token.slice(0, 12);
      const hash = createHash("sha256").update(token).digest("hex");
      const now = Date.now();

      const row = await db.one<{
        id: string; tenant_id: string; key_hash: string;
        scopes: string; expires_at: number | null; created_by: string | null;
      }>(
        "SELECT id, tenant_id, key_hash, scopes, expires_at, created_by FROM api_keys WHERE key_prefix = @prefix AND revoked_at IS NULL",
        { prefix },
      );

      if (!row || row.key_hash !== hash) {
        next(new HttpError(401, "unauthenticated", "Invalid API key."));
        return;
      }
      if (row.expires_at !== null && now > row.expires_at) {
        next(new HttpError(401, "token_expired", "API key has expired."));
        return;
      }

      let scopes: string[] = ["read"];
      try { scopes = JSON.parse(row.scopes) as string[]; } catch { /* use default */ }

      const role: Role = scopes.includes("admin") ? "manager" : "cashier";
      const auth: AuthPayload = {
        tenantId: row.tenant_id,
        userId: row.created_by ?? row.id,
        role,
        storeIds: [],
        permissions: [],
        scopes,
      };
      res.locals["auth"] = auth;

      // Record last usage fire-and-forget — non-fatal if it fails.
      void db.query("UPDATE api_keys SET last_used_at = @now WHERE id = @id", { now, id: row.id }).catch(() => {});
      next();
      return;
    }

    // ── JWT path (same logic as authMiddleware) ───────────────────────────────
    const secret = process.env.JWT_SECRET;
    if (!secret) { next(new HttpError(500, "misconfigured", "JWT_SECRET environment variable is not set.")); return; }
    try {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
      const auth: AuthPayload = {
        tenantId: String(payload["tenantId"] ?? ""),
        userId: String(payload["sub"] ?? ""),
        role: (payload["role"] as Role) ?? "cashier",
        storeIds: Array.isArray(payload["storeIds"]) ? (payload["storeIds"] as string[]).map(String) : [],
        customRoleId: payload["customRoleId"] ? String(payload["customRoleId"]) : undefined,
        permissions: Array.isArray(payload["permissions"]) ? (payload["permissions"] as string[]).map(String) : [],
        scopes: [],
      };
      if (!auth.tenantId || !auth.userId) { next(new HttpError(401, "unauthenticated", "Token is missing required claims.")); return; }
      res.locals["auth"] = auth;
      next();
    } catch (err) {
      next(err instanceof jwt.TokenExpiredError
        ? new HttpError(401, "token_expired", "Access token has expired.")
        : new HttpError(401, "unauthenticated", "Invalid access token."));
    }
  };
}

/**
 * Scope guard for API key callers. JWT sessions (scopes: []) are always allowed.
 * An API key must explicitly include the required scope; otherwise 403.
 *
 * Usage: router.post("/", requireScope("write"), handler(...))
 */
export function requireScope(scope: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    if (!auth) { next(new HttpError(401, "unauthenticated", "Not authenticated.")); return; }
    // Empty scopes = JWT session = unrestricted.
    if (auth.scopes.length === 0 || auth.scopes.includes(scope)) { next(); return; }
    next(new HttpError(403, "forbidden", `API key requires '${scope}' scope for this operation.`));
  };
}

/**
 * Tenant resolver: must run AFTER authMiddleware.
 * Sets the PostgreSQL session-level GUC `app.tenant_id` so Row-Level Security
 * policies can enforce tenant isolation without per-query predicates.
 *
 * The setter is a no-op when there is no active pg transaction client attached
 * (e.g. in tests that bypass the DB). The auth check above already rejected any
 * request without a valid tenant, so we can trust `res.locals.auth.tenantId`.
 */
/**
 * requirePlan(plan) — middleware that checks the tenant's subscription plan.
 * Reads from the `subscriptions` table on every request (no caching — plans
 * can change without restart). Fails open if the table is unavailable.
 *
 * Usage: router.get("/advanced", requirePlan("professional"), handler(...))
 */
export function requirePlan(required: Plan): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    if (!auth?.tenantId) { next(new HttpError(401, "unauthenticated", "Not authenticated.")); return; }
    const db = res.locals["db"] as DB | undefined;
    if (!db) { next(); return; } // no DB context — fail open (shouldn't happen in prod)
    try {
      const sub = await db.one<{ plan: string }>(
        "SELECT plan FROM subscriptions WHERE tenant_id = @t LIMIT 1",
        { t: auth.tenantId },
      );
      const plan = sub?.plan ?? "starter";
      if (!comparePlans(plan, required)) {
        next(new HttpError(403, "plan_required", `This feature requires the '${required}' plan or higher. Current plan: '${plan}'.`));
        return;
      }
    } catch {
      // Subscriptions table unavailable — fail open so existing tenants are not blocked.
    }
    next();
  };
}

/**
 * requireCapability(capability) — server-side business-package isolation guard (WP 02).
 *
 * Rejects with 403 unless the caller's tenant has `capability` enabled in
 * `tenant_capabilities`. This is the layer that makes package separation real:
 * the frontend hides features by capability, but CapabilitiesContext deliberately
 * *fails open* (every check returns true on a capabilities outage), so the server
 * must be the actual boundary — a retail tenant hitting a wholesale route has to
 * get 403, not a merely-hidden-yet-reachable endpoint.
 *
 * Fail-CLOSED by design: if the capability can't be affirmatively confirmed
 * (missing DB context or a query error), access is denied. Strict separation
 * ("zero cross-contamination") demands deny-by-default — the deliberate opposite
 * of requirePlan()'s fail-open entitlement gate above.
 *
 * The 403 message never names the capability, so a retail user cannot learn that
 * other business packages exist.
 *
 * Usage: router.post("/quotes", requireCapability("wholesale"), handler(...))
 */
export function requireCapability(capability: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    if (!auth?.tenantId) { next(new HttpError(401, "unauthenticated", "Not authenticated.")); return; }
    const db = res.locals["db"] as DB | undefined;
    // Deny-by-default: no DB context means the license cannot be confirmed → 403.
    if (!db) { next(new HttpError(403, "capability_unavailable", "This feature is not available for your account.")); return; }
    try {
      const row = await db.one<{ enabled: boolean | number }>(
        "SELECT enabled FROM tenant_capabilities WHERE tenant_id = @t AND capability = @cap LIMIT 1",
        { t: auth.tenantId, cap: capability },
      );
      if (!evaluateCapability(row)) {
        next(new HttpError(403, "capability_not_enabled", "This feature is not available for your account."));
        return;
      }
    } catch {
      // Cannot verify the capability → deny (strict separation is deny-by-default).
      next(new HttpError(403, "capability_unavailable", "This feature is not available for your account."));
      return;
    }
    next();
  };
}

/**
 * requireModule(moduleKey) — business-pack module isolation guard.
 *
 * Ascend is one platform serving 12+ business verticals (retail, healthcare,
 * automotive, rental, ...); each tenant's selected business type unlocks a
 * curated module bundle (see src/shared/moduleRegistry.ts BUSINESS_BUNDLES).
 * Today that resolution (SettingsService.getCapabilities) only drives what the
 * *frontend* shows — it correctly defaults a module to disabled unless it's
 * core or in the tenant's business-type bundle (or explicitly turned on), but
 * nothing enforced it server-side, so a retail tenant could call
 * `/api/v1/healthcare/...` directly and get real data.
 *
 * This reuses that same resolution (not a second, parallel policy) so the
 * backend agrees with whatever the frontend already decided, and fails closed
 * — matching requireCapability() above, not requirePlan()'s fail-open — since
 * this is the actual isolation boundary between business packs.
 *
 * Usage: router.use(requireModule("patient_records")) at the top of a
 * vertical module's router.
 */
export function requireModule(moduleKey: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    if (!auth?.tenantId) { next(new HttpError(401, "unauthenticated", "Not authenticated.")); return; }
    const db = res.locals["db"] as DB | undefined;
    // Deny-by-default: no DB context means the module can't be confirmed enabled → 403.
    if (!db) { next(new HttpError(403, "module_unavailable", "This feature is not available for your account.")); return; }
    try {
      const capabilities = await new SettingsService(db).getCapabilities(auth);
      const enabled = capabilities.modules.some((m) => m.key === moduleKey && m.enabled);
      if (!enabled) {
        next(new HttpError(403, "module_not_enabled", "This feature is not available for your account."));
        return;
      }
    } catch {
      next(new HttpError(403, "module_unavailable", "This feature is not available for your account."));
      return;
    }
    next();
  };
}

export function tenantResolver(_req: Request, res: Response, next: NextFunction): void {
  // Enter the request-scoped tenant context (AsyncLocalStorage). From here on,
  // every DB query issued anywhere in this request's async chain runs inside a
  // transaction with `app.tenant_id` set (see shared/db.ts), so Postgres RLS
  // enforces tenant isolation even if a query forgets its WHERE clause.
  const auth = res.locals["auth"] as AuthPayload | undefined;
  if (auth?.tenantId) {
    runWithTenant(auth.tenantId, () => next());
    return;
  }
  next();
}
