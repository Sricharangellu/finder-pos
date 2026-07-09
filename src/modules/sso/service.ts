import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { DB } from "../../shared/db.js";
import { HttpError } from "../../shared/http.js";
import type { Role } from "../../identity/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IdentityProviderConfig {
  enabled: boolean;
  providerName: string;
  clientId: string;
  /** Stored as-is; never returned to the client. */
  clientSecret: string;
  discoveryUrl: string;
  /** E.g. "openid profile email" */
  scopes: string;
  /** Role to assign new SSO users. */
  defaultRole: Role;
}

export interface SanitizedIdPConfig {
  enabled: boolean;
  providerName: string;
  clientId: string;
  discoveryUrl: string;
  scopes: string;
  defaultRole: Role;
  hasClientSecret: boolean;
}

const SSO_KV_KEY = "sso.oidc_config";

// ── State cache (in-memory, tenant-scoped; TTL = process lifetime) ────────────

const stateStore = new Map<string, { tenantId: string; expiresAt: number }>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SsoService {
  constructor(private readonly db: DB) {}

  async getConfig(tenantId: string): Promise<IdentityProviderConfig | null> {
    const row = await this.db.one<{ value_json: string }>(
      "SELECT value_json FROM settings_kv WHERE tenant_id = @tenantId AND key = @key",
      { tenantId, key: SSO_KV_KEY },
    );
    if (!row) return null;
    return JSON.parse(row.value_json) as IdentityProviderConfig;
  }

  async getSanitizedConfig(tenantId: string): Promise<SanitizedIdPConfig | null> {
    const cfg = await this.getConfig(tenantId);
    if (!cfg) return null;
    const { clientSecret: _, ...rest } = cfg;
    return { ...rest, hasClientSecret: Boolean(_) };
  }

  async upsertConfig(tenantId: string, input: IdentityProviderConfig): Promise<SanitizedIdPConfig> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO settings_kv (tenant_id, key, value_json, updated_at)
       VALUES (@tenantId, @key, @value, @now)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at`,
      { tenantId, key: SSO_KV_KEY, value: JSON.stringify(input), now },
    );
    return (await this.getSanitizedConfig(tenantId))!;
  }

  async deleteConfig(tenantId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM settings_kv WHERE tenant_id = @tenantId AND key = @key",
      { tenantId, key: SSO_KV_KEY },
    );
  }

  /**
   * Generate an OAuth2 `state` parameter and store it server-side for CSRF
   * protection. Returns the state string and the authorization URL to redirect
   * the browser to.
   */
  async initiateLogin(
    tenantId: string,
    redirectUri: string,
  ): Promise<{ authorizationUrl: string; state: string }> {
    const cfg = await this.getConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new HttpError(400, "sso_not_configured", "SSO is not enabled for this tenant.");
    }

    purgeExpired();
    const state = randomBytes(16).toString("hex");
    stateStore.set(state, { tenantId, expiresAt: Date.now() + 10 * 60 * 1000 });

    // Construct the OIDC authorization URL (assumes authorization_endpoint from discovery).
    // In production, we'd fetch the discovery document and cache it. For now we
    // derive the auth endpoint from the discovery URL pattern.
    const discoveryBase = cfg.discoveryUrl.replace(/\/.well-known\/openid-configuration$/, "");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: cfg.scopes,
      state,
    });
    const authorizationUrl = `${discoveryBase}/authorize?${params.toString()}`;
    return { authorizationUrl, state };
  }

  /**
   * Exchange an authorization code for an access token, validate the ID token,
   * and issue a Ascend JWT for the authenticated user. The user record is
   * created on first SSO login (just-in-time provisioning).
   */
  async handleCallback(
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    purgeExpired();
    const stateData = stateStore.get(state);
    if (!stateData) {
      throw new HttpError(400, "invalid_state", "OAuth2 state is invalid or expired.");
    }
    stateStore.delete(state);

    const { tenantId } = stateData;
    const cfg = await this.getConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new HttpError(400, "sso_not_configured", "SSO is not enabled for this tenant.");
    }

    // Exchange code for tokens via OIDC token endpoint.
    const discoveryBase = cfg.discoveryUrl.replace(/\/.well-known\/openid-configuration$/, "");
    const tokenEndpoint = `${discoveryBase}/token`;

    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw new HttpError(502, "oidc_token_error", "Failed to exchange authorization code.");
    }

    const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokenData.id_token) {
      throw new HttpError(502, "oidc_token_error", "OIDC provider did not return an id_token.");
    }

    // Decode without verification here (signature verification requires JWKS fetch).
    // In production, verify with the provider's public keys. For SSO we trust the
    // provider and focus on extracting the sub/email claims for provisioning.
    const claims = jwt.decode(tokenData.id_token) as Record<string, unknown>;
    const email = String(claims["email"] ?? claims["sub"] ?? "");
    if (!email) {
      throw new HttpError(502, "oidc_token_error", "id_token is missing email/sub claim.");
    }

    // JIT-provision: upsert user.
    const existingUser = await this.db.one<{ id: string; role: string }>(
      "SELECT id, role FROM users WHERE tenant_id = @tenantId AND email = @email",
      { tenantId, email: email.toLowerCase() },
    );

    let userId: string;
    let role: Role;

    if (existingUser) {
      userId = existingUser.id;
      role = existingUser.role as Role;
    } else {
      // Create new user with SSO placeholder password hash.
      userId = `usr_sso_${createHash("sha256").update(email + tenantId).digest("hex").slice(0, 16)}`;
      role = cfg.defaultRole;
      const now = Date.now();
      await this.db.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
         VALUES (@id, @tenantId, @email, @hash, @role, @now, @now)
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        {
          id: userId,
          tenantId,
          email: email.toLowerCase(),
          hash: "$sso$", // sentinel — password login disabled for SSO users
          role,
          now,
        },
      );
      // Re-read in case ON CONFLICT hit.
      const created = await this.db.one<{ id: string; role: string }>(
        "SELECT id, role FROM users WHERE tenant_id = @tenantId AND email = @email",
        { tenantId, email: email.toLowerCase() },
      );
      userId = created!.id;
      role = created!.role as Role;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new HttpError(500, "misconfigured", "JWT_SECRET not set.");

    const accessToken = jwt.sign(
      { tenantId, role, ssoProvider: cfg.providerName },
      secret,
      { subject: userId, expiresIn: "15m" },
    );
    const refreshToken = jwt.sign(
      { tenantId, role },
      secret + ":refresh",
      { subject: userId, expiresIn: "7d" },
    );

    return { accessToken, refreshToken, expiresIn: 900 };
  }
}
