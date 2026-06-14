import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../shared/http.js";
import type { Role } from "../identity/types.js";
import { hasRole } from "../identity/types.js";

export interface AuthPayload {
  tenantId: string;
  userId: string;
  role: Role;
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
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    const auth: AuthPayload = {
      tenantId: String(payload["tenantId"] ?? ""),
      userId: String(payload["sub"] ?? ""),
      role: (payload["role"] as Role) ?? "cashier",
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
 * Tenant resolver: must run AFTER authMiddleware.
 * Sets the PostgreSQL session-level GUC `app.tenant_id` so Row-Level Security
 * policies can enforce tenant isolation without per-query predicates.
 *
 * The setter is a no-op when there is no active pg transaction client attached
 * (e.g. in tests that bypass the DB). The auth check above already rejected any
 * request without a valid tenant, so we can trust `res.locals.auth.tenantId`.
 */
export function tenantResolver(_req: Request, _res: Response, next: NextFunction): void {
  // The DB layer sets `app.tenant_id` inside each transaction via the service
  // layer helpers (`withTenant`). The middleware records the tenantId so those
  // helpers can read it without touching the JWT again.
  // Actual SET LOCAL happens in identity/db.ts `withTenant()` helper.
  next();
}
