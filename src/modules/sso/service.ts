import { createHash, createPublicKey, randomBytes, type KeyObject } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
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
/** OAuth2 state rows live in settings_kv under this key prefix so they survive
 *  serverless instance recycling (an in-memory Map loses the state whenever the
 *  callback lands on a different instance than the initiate). */
const SSO_STATE_KEY_PREFIX = "sso.state.";
const STATE_TTL_MS = 10 * 60 * 1000;

// ── discoveryUrl SSRF guard ───────────────────────────────────────────────────

const PRIVATE_HOST_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
const LOOPBACK_RE = /^(localhost|127\.(\d{1,3}\.){2}\d{1,3}|\[?::1\]?)$/i;

/**
 * Reject discovery URLs that could be used for server-side request forgery:
 * only http(s), https required except loopback outside production, and
 * private/link-local literal IPs always refused. (Literal-IP check only —
 * DNS rebinding is out of scope here.)
 */
export function assertSafeDiscoveryUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_discovery_url", "discoveryUrl is not a valid URL.");
  }
  const host = url.hostname;
  const isLoopback = LOOPBACK_RE.test(host);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "invalid_discovery_url", "discoveryUrl must use http(s).");
  }
  if (process.env.NODE_ENV === "production") {
    if (url.protocol !== "https:" || isLoopback || PRIVATE_HOST_RE.test(host)) {
      throw new HttpError(400, "invalid_discovery_url", "discoveryUrl must be a public https URL.");
    }
  } else {
    // Outside production: allow http only against loopback (local IdP in tests/dev).
    if (url.protocol === "http:" && !isLoopback) {
      throw new HttpError(400, "invalid_discovery_url", "http discoveryUrl is only allowed for localhost.");
    }
    if (!isLoopback && PRIVATE_HOST_RE.test(host)) {
      throw new HttpError(400, "invalid_discovery_url", "discoveryUrl must not point at a private address.");
    }
  }
}

// ── OIDC discovery + JWKS (fetched per use, cached in-memory as optimization) ─

interface DiscoveryDoc {
  issuer?: string;
  token_endpoint?: string;
  jwks_uri?: string;
}
interface Jwk {
  kid?: string;
  kty: string;
  [k: string]: unknown;
}

const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { doc: DiscoveryDoc; keys: Jwk[]; expiresAt: number }>();

async function fetchDiscoveryAndJwks(discoveryUrl: string): Promise<{ doc: DiscoveryDoc; keys: Jwk[] }> {
  const cached = discoveryCache.get(discoveryUrl);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const docRes = await fetch(discoveryUrl);
  if (!docRes.ok) {
    throw new HttpError(502, "oidc_discovery_error", "Failed to fetch the OIDC discovery document.");
  }
  const doc = (await docRes.json()) as DiscoveryDoc;
  if (!doc.jwks_uri) {
    throw new HttpError(502, "oidc_discovery_error", "OIDC discovery document has no jwks_uri.");
  }
  assertSafeDiscoveryUrl(doc.jwks_uri);
  const jwksRes = await fetch(doc.jwks_uri);
  if (!jwksRes.ok) {
    throw new HttpError(502, "oidc_discovery_error", "Failed to fetch the provider JWKS.");
  }
  const jwks = (await jwksRes.json()) as { keys?: Jwk[] };
  const entry = { doc, keys: jwks.keys ?? [], expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS };
  discoveryCache.set(discoveryUrl, entry);
  return entry;
}

/** Verify the id_token signature against the provider's JWKS and validate
 *  issuer/audience/expiry. Returns the verified claims. */
function verifyIdToken(idToken: string, keys: Jwk[], issuer: string | undefined, clientId: string): Record<string, unknown> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === "string") {
    throw new HttpError(401, "invalid_id_token", "id_token is not a valid JWT.");
  }
  const kid = decoded.header.kid;
  const jwk = (kid ? keys.find((k) => k.kid === kid) : undefined) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) {
    throw new HttpError(401, "invalid_id_token", "No matching signing key in the provider JWKS.");
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as never, format: "jwk" });
  } catch {
    throw new HttpError(401, "invalid_id_token", "Provider JWKS key is not usable.");
  }
  try {
    return jwt.verify(idToken, key, {
      algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384"],
      audience: clientId,
      ...(issuer ? { issuer } : {}),
    }) as Record<string, unknown>;
  } catch {
    throw new HttpError(401, "invalid_id_token", "id_token failed signature/claim validation.");
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
    assertSafeDiscoveryUrl(input.discoveryUrl);
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

  /** Drop expired sso.state.* rows (cheap; runs on each initiate). */
  private async purgeExpiredStates(): Promise<void> {
    await this.db.query(
      "DELETE FROM settings_kv WHERE key LIKE @prefix AND updated_at < @cutoff",
      { prefix: SSO_STATE_KEY_PREFIX + "%", cutoff: Date.now() - STATE_TTL_MS },
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
    assertSafeDiscoveryUrl(cfg.discoveryUrl); // config may predate the guard

    await this.purgeExpiredStates();
    const state = randomBytes(16).toString("hex");
    const now = Date.now();
    await this.db.query(
      `INSERT INTO settings_kv (tenant_id, key, value_json, updated_at)
       VALUES (@tenantId, @key, @value, @now)`,
      {
        tenantId,
        key: SSO_STATE_KEY_PREFIX + state,
        value: JSON.stringify({ expiresAt: now + STATE_TTL_MS }),
        now,
      },
    );

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
    // Consume the state row (DELETE ... RETURNING makes replay a hard failure
    // even across concurrent callbacks) and recover which tenant initiated.
    const stateRow = await this.db.one<{ tenant_id: string; value_json: string }>(
      "DELETE FROM settings_kv WHERE key = @key RETURNING tenant_id, value_json",
      { key: SSO_STATE_KEY_PREFIX + state },
    );
    const parsed = stateRow ? (JSON.parse(stateRow.value_json) as { expiresAt: number }) : null;
    if (!stateRow || !parsed || parsed.expiresAt < Date.now()) {
      throw new HttpError(400, "invalid_state", "OAuth2 state is invalid or expired.");
    }

    const tenantId = stateRow.tenant_id;
    const cfg = await this.getConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new HttpError(400, "sso_not_configured", "SSO is not enabled for this tenant.");
    }
    assertSafeDiscoveryUrl(cfg.discoveryUrl);

    // Fetch the discovery document + JWKS: needed to verify the id_token, and
    // gives us the canonical token endpoint (pattern-derived fallback kept for
    // providers whose discovery doc omits it).
    const { doc, keys } = await fetchDiscoveryAndJwks(cfg.discoveryUrl);
    const discoveryBase = cfg.discoveryUrl.replace(/\/\.well-known\/openid-configuration$/, "");
    const tokenEndpoint = doc.token_endpoint ?? `${discoveryBase}/token`;

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

    // Verify the id_token signature against the provider's JWKS and validate
    // iss/aud/exp. Without this, anyone who can edit a tenant's SSO config can
    // point it at a rogue IdP and mint claims for any user in that tenant.
    const claims = verifyIdToken(tokenData.id_token, keys, doc.issuer, cfg.clientId);
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

    // Persist the refresh token hash exactly as identity's login does —
    // identity.refresh() looks tokens up by sha256 hash in refresh_tokens,
    // so without this row an SSO session cannot refresh past 15 minutes.
    const issuedAt = Date.now();
    await this.db.query(
      "INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (@id, @tenantId, @userId, @hash, @exp, @now)",
      {
        id: uuidv7(),
        tenantId,
        userId,
        hash: createHash("sha256").update(refreshToken).digest("hex"),
        exp: issuedAt + 7 * 86_400_000,
        now: issuedAt,
      },
    );

    return { accessToken, refreshToken, expiresIn: 900 };
  }
}
