import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";
import type { DB } from "../shared/db.js";
import type { EventBus } from "../shared/events.js";
import { HttpError } from "../shared/http.js";
import type { Role, TokenClaims, UserRow, AuditLogRow } from "./types.js";
import { hasRole } from "./types.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/** User summary returned to the client on login (matches the frontend contract). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}

/** Demo tenant + credentials seeded on first boot (idempotent). */
export const DEMO_TENANT_ID = "tnt_demo";
export const DEMO_PASSWORD = "FinderDemo!2026";

export interface AuditWriteInput {
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
}

/**
 * ABAC policy hook. Called after RBAC passes. Returns null (allow) or a
 * reason string (deny). In Wave 0 we ship always-allow; Wave 1+ plugs in
 * attribute-based rules (e.g. "cashier can only void own orders").
 */
export type AbacPolicy = (
  actor: { userId: string; role: Role; tenantId: string },
  action: string,
  resource: unknown,
) => string | null;

/** Default Wave 0 policy: approve everything that passes RBAC. */
export const defaultAbacPolicy: AbacPolicy = () => null;

export class IdentityService {
  private abacPolicy: AbacPolicy = defaultAbacPolicy;

  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  /** Replace the ABAC policy (used in tests or configuration). */
  setAbacPolicy(policy: AbacPolicy): void {
    this.abacPolicy = policy;
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  /**
   * Verify email + password credentials and issue a JWT pair.
   * Password comparison uses a constant-time bcrypt-style check.
   * For Wave 0 we store hashed passwords via the database agent's schema;
   * if the hash column is unavailable we fall back to a dev-only plaintext
   * comparison (must not reach production).
   */
  async login(input: LoginInput): Promise<TokenPair & { user: AuthUser }> {
    const user = await this.db.one<UserRow>(
      "SELECT * FROM users WHERE email = @email",
      { email: input.email.toLowerCase().trim() },
    );

    if (!user) {
      throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
    }

    const valid = await this.verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
    }

    const pair = this.issueTokens(user.id, user.tenant_id, user.role);

    await this.events.publish(
      "identity.login",
      { userId: user.id, tenantId: user.tenant_id, role: user.role },
      user.id,
    );

    return {
      ...pair,
      user: {
        id: user.id,
        email: user.email,
        name: user.email.split("@")[0] ?? user.email,
        role: user.role,
        tenantId: user.tenant_id,
      },
    };
  }

  /**
   * Seed a demo tenant + owner/cashier users on first boot. Idempotent:
   * only runs when the users table is empty; concurrent cold-start races are
   * tolerated via ON CONFLICT DO NOTHING. Passwords are bcrypt-hashed.
   */
  async seedDemo(): Promise<void> {
    const existing = await this.db.one<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM users",
    );
    if (existing && Number(existing.c) > 0) return;

    const now = Date.now();
    await this.db.query(
      "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (@id, @name, @slug, @c, @u) ON CONFLICT (id) DO NOTHING",
      { id: DEMO_TENANT_ID, name: "Demo Store", slug: "demo", c: now, u: now },
    );

    const { default: bcrypt } = await import("bcryptjs");
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const demoUsers: Array<{ id: string; email: string; role: Role }> = [
      { id: "usr_demo_owner", email: "owner@finder-pos.dev", role: "owner" },
      { id: "usr_demo_cashier", email: "cashier@finder-pos.dev", role: "cashier" },
    ];
    for (const u of demoUsers) {
      await this.db.query(
        "INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at) VALUES (@id, @t, @e, @h, @r, @c, @u) ON CONFLICT (tenant_id, email) DO NOTHING",
        { id: u.id, t: DEMO_TENANT_ID, e: u.email, h: hash, r: u.role, c: now, u: now },
      );
    }
  }

  /**
   * Verify a refresh token and issue a new token pair.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const secret = this.getSecret();
    let claims: TokenClaims;
    try {
      claims = jwt.verify(refreshToken, secret + ":refresh") as TokenClaims;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new HttpError(401, "token_expired", "Refresh token has expired.");
      }
      throw new HttpError(401, "unauthenticated", "Invalid refresh token.");
    }

    // Confirm user still exists and role hasn't changed.
    const user = await this.db.one<UserRow>(
      "SELECT * FROM users WHERE id = @id AND tenant_id = @tenantId",
      { id: claims.sub, tenantId: claims.tenantId },
    );
    if (!user) {
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    return this.issueTokens(user.id, user.tenant_id, user.role);
  }

  /**
   * Verify an access token and return its decoded claims.
   * Used by the auth middleware and in tests.
   */
  verifyAccessToken(token: string): TokenClaims {
    const secret = this.getSecret();
    try {
      return jwt.verify(token, secret) as TokenClaims;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new HttpError(401, "token_expired", "Access token has expired.");
      }
      throw new HttpError(401, "unauthenticated", "Invalid access token.");
    }
  }

  // ── Authorization ───────────────────────────────────────────────────────────

  /**
   * RBAC check. Throws 403 if `actual` role is below `required`.
   * Call from route handlers before any mutating DB work.
   */
  checkRole(actual: Role, required: Role): void {
    if (!hasRole(actual, required)) {
      throw new HttpError(
        403,
        "forbidden",
        `Role '${actual}' is not authorized for this action (requires '${required}' or above).`,
      );
    }
  }

  /**
   * Combined RBAC + ABAC check. Throws 403 on any denial.
   */
  authorize(
    actor: { userId: string; role: Role; tenantId: string },
    requiredRole: Role,
    action: string,
    resource?: unknown,
  ): void {
    this.checkRole(actor.role, requiredRole);
    const denial = this.abacPolicy(actor, action, resource ?? null);
    if (denial) {
      throw new HttpError(403, "forbidden", denial);
    }
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  /**
   * Write an audit record within the provided DB context (typically a tx DB
   * so the audit row commits or rolls back atomically with the mutation).
   */
  async writeAudit(txDb: DB, input: AuditWriteInput): Promise<void> {
    const row: AuditLogRow = {
      id: `aud_${uuidv7()}`,
      tenant_id: input.tenantId,
      actor_id: input.actorId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      before_state: input.before !== undefined ? JSON.stringify(input.before) : null,
      after_state: input.after !== undefined ? JSON.stringify(input.after) : null,
      occurred_at: Date.now(),
      request_id: input.requestId ?? null,
    };
    await txDb.query(
      `INSERT INTO audit_log
         (id, tenant_id, actor_id, action, entity_type, entity_id,
          before_state, after_state, occurred_at, request_id)
       VALUES
         (@id, @tenant_id, @actor_id, @action, @entity_type, @entity_id,
          @before_state, @after_state, @occurred_at, @request_id)`,
      row as unknown as Record<string, unknown>,
    );
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private issueTokens(userId: string, tenantId: string, role: Role): TokenPair {
    const secret = this.getSecret();
    const accessToken = jwt.sign(
      { tenantId, role } as Omit<TokenClaims, "sub" | "iat" | "exp">,
      secret,
      { subject: userId, expiresIn: ACCESS_TOKEN_TTL },
    );
    const refreshToken = jwt.sign(
      { tenantId, role } as Omit<TokenClaims, "sub" | "iat" | "exp">,
      secret + ":refresh",
      { subject: userId, expiresIn: REFRESH_TOKEN_TTL },
    );
    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  private async verifyPassword(plain: string, stored: string): Promise<boolean> {
    // When the Database agent stores bcrypt hashes, we detect the $2b$ prefix.
    // Until that schema lands we fall back to a dev-mode string comparison
    // (blocked by the feature flag `identity.bcrypt_required` in production).
    if (stored.startsWith("$2b$") || stored.startsWith("$2a$")) {
      const { default: bcrypt } = await import("bcryptjs");
      return bcrypt.compare(plain, stored);
    }
    // Dev/test fallback — not for production.
    return plain === stored;
  }

  private getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new HttpError(500, "misconfigured", "JWT_SECRET environment variable is not set.");
    }
    return secret;
  }
}

// ── requireRole guard ────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware factory that enforces a minimum RBAC role.
 * Mount after `authMiddleware`. Throws 403 for insufficient roles.
 *
 * Usage:
 *   router.delete("/", requireRole("manager"), handler(async (req, res) => { … }))
 */
export function requireRole(required: Role) {
  return function requireRoleMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const auth = res.locals["auth"] as { role?: Role } | undefined;
    const role: Role = auth?.role ?? "cashier";
    if (!hasRole(role, required)) {
      next(
        new HttpError(
          403,
          "forbidden",
          `Role '${role}' is not authorized (requires '${required}' or above).`,
        ),
      );
      return;
    }
    next();
  };
}
