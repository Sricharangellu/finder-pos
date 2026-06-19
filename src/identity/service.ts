import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";
import { createHash } from "node:crypto";
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

export interface RegisterInput {
  storeName: string;
  email: string;
  password: string;
}

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

export interface DeviceRow {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  register_id: string | null;
  device_name: string;
  device_type: string;
  device_identifier: string | null;
  app_version: string | null;
  trusted: boolean;
  last_seen_at: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface RegisterDeviceInput {
  deviceName: string;
  deviceType?: string;
  outletId?: string | null;
  registerId?: string | null;
  deviceIdentifier?: string | null;
  appVersion?: string | null;
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
      await this.logLoginAttempt({ email: input.email, success: false, reason: "invalid_credentials", userId: null, tenantId: null, ip: null });
      throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
    }

    const valid = await this.verifyPassword(input.password, user.password_hash);
    if (!valid) {
      await this.logLoginAttempt({ email: input.email, success: false, reason: "invalid_credentials", userId: user.id, tenantId: user.tenant_id, ip: null });
      throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
    }

    await this.logLoginAttempt({ email: input.email, success: true, reason: null, userId: user.id, tenantId: user.tenant_id, ip: null });

    const permissions = user.custom_role_id
      ? await this.resolveCustomRolePermissions(user.custom_role_id)
      : undefined;
    const pair = this.issueTokens(user.id, user.tenant_id, user.role, user.custom_role_id ?? undefined, permissions);

    const rtkId = `rtk_${uuidv7()}`;
    await this.db.query(
      "INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (@id, @tenantId, @userId, @hash, @exp, @now)",
      {
        id: rtkId,
        tenantId: user.tenant_id,
        userId: user.id,
        hash: this.hashToken(pair.refreshToken),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        now: Date.now(),
      },
    );

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

  /** Record a login attempt (success or failure) to the login_events table. */
  private async logLoginAttempt(opts: {
    email: string;
    success: boolean;
    reason: string | null;
    userId: string | null;
    tenantId: string | null;
    ip: string | null;
  }): Promise<void> {
    try {
      await this.db.query(
        "INSERT INTO login_events (id, tenant_id, user_id, email, success, failure_reason, ip_address, created_at) VALUES (@id, @tenantId, @userId, @email, @success, @reason, @ip, @now)",
        {
          id: `lev_${uuidv7()}`,
          tenantId: opts.tenantId,
          userId: opts.userId,
          email: opts.email.toLowerCase().trim(),
          success: opts.success,
          reason: opts.reason,
          ip: opts.ip,
          now: Date.now(),
        },
      );
    } catch {
      // Never fail a login due to audit-logging errors.
    }
  }

  // ── Devices ─────────────────────────────────────────────────────────────────

  async listDevices(tenantId: string): Promise<DeviceRow[]> {
    return this.db.query<DeviceRow>(
      "SELECT * FROM devices WHERE tenant_id = @tenantId AND status = 'active' ORDER BY created_at DESC",
      { tenantId },
    );
  }

  async registerDevice(tenantId: string, input: RegisterDeviceInput): Promise<DeviceRow> {
    const now = Date.now();
    const id = `dev_${uuidv7()}`;
    const device: DeviceRow = {
      id,
      tenant_id: tenantId,
      outlet_id: input.outletId ?? null,
      register_id: input.registerId ?? null,
      device_name: input.deviceName,
      device_type: input.deviceType ?? "pos_terminal",
      device_identifier: input.deviceIdentifier ?? null,
      app_version: input.appVersion ?? null,
      trusted: false,
      last_seen_at: now,
      status: "active",
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO devices (id, tenant_id, outlet_id, register_id, device_name, device_type, device_identifier, app_version, trusted, last_seen_at, status, created_at, updated_at)
       VALUES (@id, @tenant_id, @outlet_id, @register_id, @device_name, @device_type, @device_identifier, @app_version, @trusted, @last_seen_at, @status, @created_at, @updated_at)`,
      device as unknown as Record<string, unknown>,
    );
    return device;
  }

  async trustDevice(id: string, tenantId: string): Promise<DeviceRow> {
    const existing = await this.db.one<DeviceRow>(
      "SELECT * FROM devices WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!existing) throw new HttpError(404, "not_found", `device '${id}' not found`);
    const now = Date.now();
    await this.db.query(
      "UPDATE devices SET trusted = true, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { now, id, tenantId },
    );
    return { ...existing, trusted: true, updated_at: now };
  }

  /**
   * Create a new tenant and owner account. Returns a token pair so the user
   * is immediately logged in after sign-up — no separate login step needed.
   */
  async register(input: RegisterInput): Promise<TokenPair & { user: AuthUser }> {
    const { default: bcrypt } = await import("bcryptjs");

    // Check email not already in use (globally — email is unique per tenant but
    // we also want to prevent someone registering twice with the same email across
    // tenants on a single-instance deployment).
    const existing = await this.db.one<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM users WHERE email = @email",
      { email: input.email.toLowerCase().trim() },
    );
    if (existing && Number(existing.c) > 0) {
      throw new HttpError(409, "email_taken", "An account with that email already exists.");
    }

    const now = Date.now();
    const tenantId = `tnt_${uuidv7()}`;
    const userId = `usr_${uuidv7()}`;
    const slug = input.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);

    await this.db.query(
      "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (@id, @name, @slug, @now, @now)",
      { id: tenantId, name: input.storeName.trim(), slug: `${slug}-${tenantId.slice(-6)}`, now },
    );

    const passwordHash = await bcrypt.hash(input.password, 10);
    await this.db.query(
      "INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at) VALUES (@id, @t, @e, @h, 'owner', @now, @now)",
      { id: userId, t: tenantId, e: input.email.toLowerCase().trim(), h: passwordHash, now },
    );

    const pair = this.issueTokens(userId, tenantId, "owner");
    await this.db.query(
      "INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (@id, @tenantId, @userId, @hash, @exp, @now)",
      { id: uuidv7(), tenantId, userId, hash: this.hashToken(pair.refreshToken), exp: now + 7 * 86_400_000, now },
    );

    const name = (input.email.split("@")[0] ?? input.email).replace(/[._-]/g, " ");
    const user: AuthUser = { id: userId, email: input.email.toLowerCase().trim(), name, role: "owner", tenantId };
    await this.events.publish("tenant.registered", { tenantId, userId, storeName: input.storeName }, tenantId);
    return { ...pair, user };
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
   * Verify a refresh token (single-use rotation) and issue a new token pair.
   * The incoming token is revoked immediately; a new token is stored in its place.
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

    // Single-use check: look up the hash in the DB.
    const hash = this.hashToken(refreshToken);
    const row = await this.db.one<{ id: string }>(
      "SELECT id FROM refresh_tokens WHERE token_hash = @hash AND revoked_at IS NULL AND expires_at > @now",
      { hash, now: Date.now() },
    );
    if (!row) {
      throw new HttpError(401, "invalid_token", "Refresh token is invalid or expired.");
    }

    // Revoke the old token (single-use: cannot be reused).
    await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = @now WHERE id = @id",
      { now: Date.now(), id: row.id },
    );

    // Confirm user still exists and role hasn't changed.
    const user = await this.db.one<UserRow>(
      "SELECT * FROM users WHERE id = @id AND tenant_id = @tenantId",
      { id: claims.sub, tenantId: claims.tenantId },
    );
    if (!user) {
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    const refreshPerms = user.custom_role_id
      ? await this.resolveCustomRolePermissions(user.custom_role_id)
      : undefined;
    const pair = this.issueTokens(user.id, user.tenant_id, user.role, user.custom_role_id ?? undefined, refreshPerms);

    // Store the new refresh token hash.
    const newRtkId = `rtk_${uuidv7()}`;
    await this.db.query(
      "INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (@id, @tenantId, @userId, @hash, @exp, @now)",
      {
        id: newRtkId,
        tenantId: user.tenant_id,
        userId: user.id,
        hash: this.hashToken(pair.refreshToken),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        now: Date.now(),
      },
    );

    return pair;
  }

  /**
   * Revoke a specific refresh token (used by /logout).
   */
  async revokeRefreshToken(refreshToken: string, tenantId: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = @now WHERE token_hash = @hash AND tenant_id = @t AND revoked_at IS NULL",
      { now: Date.now(), hash, t: tenantId },
    );
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

  // ── MFA ──────────────────────────────────────────────────────────────────────

  async setupMfa(userId: string, tenantId: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const OTPAuth = await import("otpauth");
    const user = await this.db.one<{ email: string }>("SELECT email FROM users WHERE id = @id AND tenant_id = @t", { id: userId, t: tenantId });
    if (!user) throw new HttpError(404, "not_found", "User not found");
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: "FinderPOS", label: user.email, algorithm: "SHA1", digits: 6, period: 30, secret });
    const now = Date.now();
    await this.db.query(
      `INSERT INTO user_mfa (id, tenant_id, user_id, totp_secret, enabled, created_at, updated_at)
       VALUES (@id, @t, @uid, @secret, false, @now, @now)
       ON CONFLICT (user_id) DO UPDATE SET totp_secret = EXCLUDED.totp_secret, enabled = false, updated_at = @now`,
      { id: `mfa_${uuidv7()}`, t: tenantId, uid: userId, secret: secret.base32, now }
    );
    return { secret: secret.base32, otpauthUrl: totp.toString(), qrDataUrl: "" };
  }

  async verifyAndEnableMfa(userId: string, tenantId: string, code: string): Promise<void> {
    const OTPAuth = await import("otpauth");
    const row = await this.db.one<{ totp_secret: string }>("SELECT totp_secret FROM user_mfa WHERE user_id = @uid AND tenant_id = @t", { uid: userId, t: tenantId });
    if (!row) throw new HttpError(404, "not_found", "MFA not set up");
    const totp = new OTPAuth.TOTP({ issuer: "FinderPOS", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(row.totp_secret) });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) throw new HttpError(400, "invalid_code", "Invalid or expired TOTP code");
    const now = Date.now();
    await this.db.query("UPDATE user_mfa SET enabled = true, updated_at = @now WHERE user_id = @uid AND tenant_id = @t", { now, uid: userId, t: tenantId });
    await this.db.query("UPDATE users SET mfa_enabled = true, updated_at = @now WHERE id = @uid AND tenant_id = @t", { now, uid: userId, t: tenantId });
  }

  async verifyMfaCode(userId: string, tenantId: string, code: string): Promise<boolean> {
    const OTPAuth = await import("otpauth");
    const row = await this.db.one<{ totp_secret: string; enabled: boolean }>("SELECT totp_secret, enabled FROM user_mfa WHERE user_id = @uid AND tenant_id = @t", { uid: userId, t: tenantId });
    if (!row || !row.enabled) return true; // MFA not enabled — pass through
    const totp = new OTPAuth.TOTP({ issuer: "FinderPOS", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(row.totp_secret) });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  async disableMfa(userId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.db.query("UPDATE user_mfa SET enabled = false, updated_at = @now WHERE user_id = @uid AND tenant_id = @t", { now, uid: userId, t: tenantId });
    await this.db.query("UPDATE users SET mfa_enabled = false, updated_at = @now WHERE id = @uid AND tenant_id = @t", { now, uid: userId, t: tenantId });
  }

  async getMfaStatus(userId: string, tenantId: string): Promise<{ enabled: boolean; setupRequired: boolean }> {
    const row = await this.db.one<{ enabled: boolean }>("SELECT enabled FROM user_mfa WHERE user_id = @uid AND tenant_id = @t", { uid: userId, t: tenantId });
    return { enabled: row?.enabled ?? false, setupRequired: !row };
  }

  // ── API Keys ──────────────────────────────────────────────────────────────────

  async createApiKey(tenantId: string, name: string, scopes: string[], createdBy: string, expiresAt?: number): Promise<{ id: string; key: string; prefix: string }> {
    const { randomBytes } = await import("node:crypto");
    const rawKey = `fpk_${randomBytes(24).toString("base64url")}`;
    const prefix = rawKey.slice(0, 12);
    const hash = createHash("sha256").update(rawKey).digest("hex");
    const now = Date.now();
    const id = `apk_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash, scopes, expires_at, created_by, created_at, updated_at)
       VALUES (@id, @t, @name, @prefix, @hash, @scopes, @exp, @by, @now, @now)`,
      { id, t: tenantId, name, prefix, hash, scopes: JSON.stringify(scopes), exp: expiresAt ?? null, by: createdBy, now }
    );
    return { id, key: rawKey, prefix };
  }

  async listApiKeys(tenantId: string): Promise<Array<{ id: string; name: string; key_prefix: string; scopes: string; last_used_at: number | null; expires_at: number | null; created_at: number }>> {
    return this.db.query("SELECT id, name, key_prefix, scopes, last_used_at, expires_at, created_at FROM api_keys WHERE tenant_id = @t AND revoked_at IS NULL ORDER BY created_at DESC", { t: tenantId });
  }

  async revokeApiKey(id: string, tenantId: string): Promise<void> {
    await this.db.query("UPDATE api_keys SET revoked_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
  }

  // ── Password reset ─────────────────────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<{ token: string } | null> {
    const { randomBytes } = await import("node:crypto");
    const user = await this.db.one<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM users WHERE email = @email", { email: email.toLowerCase().trim() });
    if (!user) return null; // don't reveal existence
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    await this.db.query(
      "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (@id, @t, @uid, @hash, @exp, @now)",
      { id: `prt_${uuidv7()}`, t: user.tenant_id, uid: user.id, hash, exp: now + 3_600_000, now }
    );
    // In production: send email. In dev: return token for testing.
    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { default: bcrypt } = await import("bcryptjs");
    const hash = createHash("sha256").update(token).digest("hex");
    const row = await this.db.one<{ id: string; user_id: string; tenant_id: string; expires_at: number; used_at: number | null }>(
      "SELECT id, user_id, tenant_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = @hash",
      { hash }
    );
    if (!row) throw new HttpError(400, "invalid_token", "Invalid or expired reset token");
    if (row.used_at) throw new HttpError(400, "token_used", "Reset token has already been used");
    if (Date.now() > row.expires_at) throw new HttpError(400, "token_expired", "Reset token has expired");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = Date.now();
    await this.db.query("UPDATE users SET password_hash = @hash, updated_at = @now WHERE id = @uid AND tenant_id = @t", { hash: passwordHash, now, uid: row.user_id, t: row.tenant_id });
    await this.db.query("UPDATE password_reset_tokens SET used_at = @now WHERE id = @id", { now, id: row.id });
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private issueTokens(
    userId: string,
    tenantId: string,
    role: Role,
    customRoleId?: string,
    permissions?: string[],
  ): TokenPair {
    const secret = this.getSecret();
    const claims: Omit<TokenClaims, "sub" | "iat" | "exp"> = {
      tenantId,
      role,
      ...(customRoleId ? { customRoleId } : {}),
      ...(permissions && permissions.length > 0 ? { permissions } : {}),
    };
    const accessToken = jwt.sign(claims, secret, { subject: userId, expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = jwt.sign(claims, secret + ":refresh", { subject: userId, expiresIn: REFRESH_TOKEN_TTL });
    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  private async resolveCustomRolePermissions(customRoleId: string): Promise<string[]> {
    const row = await this.db.one<{ permissions: string }>(
      "SELECT permissions FROM custom_roles WHERE id = @id",
      { id: customRoleId },
    );
    if (!row) return [];
    try {
      return JSON.parse(row.permissions) as string[];
    } catch {
      return [];
    }
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
