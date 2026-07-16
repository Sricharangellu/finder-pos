import { createHash, createPublicKey, randomBytes } from "node:crypto";
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

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  [key: string]: unknown;
}

const SSO_KV_KEY = "sso.oidc_config";

/** State-token purpose tag — keeps it out of the audience space of regular access/refresh tokens. */
const STATE_SUBJECT = "sso_state";

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

  /** Fetch and parse the OIDC discovery document — replaces the old naive
   *  string-replace guess at `/authorize` and `/token` paths. */
  private async fetchDiscoveryDocument(discoveryUrl: string): Promise<DiscoveryDocument> {
    const res = await fetch(discoveryUrl);
    if (!res.ok) {
      throw new HttpError(502, "oidc_discovery_error", "Failed to fetch the OIDC discovery document.");
    }
    const doc = (await res.json()) as Partial<DiscoveryDocument>;
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new HttpError(502, "oidc_discovery_error", "OIDC discovery document is missing required fields.");
    }
    return doc as DiscoveryDocument;
  }

  /** Resolve the RSA/EC public key the provider used to sign `idToken`, by
   *  fetching its JWKS and matching on `kid` (falling back to the sole key if
   *  the provider only publishes one and omits `kid`, which some do). */
  private async resolveSigningKey(jwksUri: string, kid: string | undefined) {
    const res = await fetch(jwksUri);
    if (!res.ok) {
      throw new HttpError(502, "oidc_jwks_error", "Failed to fetch the OIDC provider's JWKS.");
    }
    const { keys } = (await res.json()) as { keys?: Jwk[] };
    const jwk = (keys ?? []).find((k) => (kid ? k.kid === kid : true));
    if (!jwk) {
      throw new HttpError(502, "oidc_jwks_error", "No matching signing key found in the provider's JWKS.");
    }
    return createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: "jwk" });
  }

  /**
   * Generate an OAuth2 `state` parameter and a `nonce`, both bound into one
   * signed, self-contained token — no server-side session store required, so
   * this survives across separate serverless invocations handling `/initiate`
   * and `/callback` (the previous in-memory Map did not: it silently failed
   * whenever a different instance handled the callback).
   */
  async initiateLogin(
    tenantId: string,
    redirectUri: string,
  ): Promise<{ authorizationUrl: string; state: string }> {
    const cfg = await this.getConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new HttpError(400, "sso_not_configured", "SSO is not enabled for this tenant.");
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new HttpError(500, "misconfigured", "JWT_SECRET not set.");

    const doc = await this.fetchDiscoveryDocument(cfg.discoveryUrl);
    const nonce = randomBytes(16).toString("hex");
    const state = jwt.sign({ tenantId, nonce }, secret, { subject: STATE_SUBJECT, expiresIn: "10m" });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: cfg.scopes,
      state,
      nonce,
    });
    const authorizationUrl = `${doc.authorization_endpoint}?${params.toString()}`;
    return { authorizationUrl, state };
  }

  /**
   * Exchange an authorization code for an access token, verify the ID token's
   * signature against the provider's published JWKS (never trust a decoded
   * but unverified token), confirm `nonce`/`issuer`/`audience`, and issue a
   * Ascend JWT for the authenticated user. JIT-provisions on first login.
   */
  async handleCallback(
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new HttpError(500, "misconfigured", "JWT_SECRET not set.");

    let tenantId: string;
    let nonce: string;
    try {
      const decoded = jwt.verify(state, secret, { subject: STATE_SUBJECT }) as jwt.JwtPayload;
      tenantId = String(decoded["tenantId"] ?? "");
      nonce = String(decoded["nonce"] ?? "");
      if (!tenantId || !nonce) throw new Error("missing claims");
    } catch {
      throw new HttpError(400, "invalid_state", "OAuth2 state is invalid or expired.");
    }

    const cfg = await this.getConfig(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new HttpError(400, "sso_not_configured", "SSO is not enabled for this tenant.");
    }

    const doc = await this.fetchDiscoveryDocument(cfg.discoveryUrl);

    const tokenRes = await fetch(doc.token_endpoint, {
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

    // Verify the ID token's signature against the provider's own published
    // JWKS — decoding without verifying would let anyone hand back forged
    // claims and be trusted as-is.
    const unverified = jwt.decode(tokenData.id_token, { complete: true });
    if (!unverified || typeof unverified === "string") {
      throw new HttpError(502, "oidc_token_error", "id_token is malformed.");
    }
    const signingKey = await this.resolveSigningKey(doc.jwks_uri, unverified.header.kid);

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(tokenData.id_token, signingKey, {
        algorithms: ["RS256", "ES256"],
        issuer: doc.issuer,
        audience: cfg.clientId,
      }) as jwt.JwtPayload;
    } catch {
      throw new HttpError(502, "oidc_token_error", "id_token signature verification failed.");
    }

    // Replay protection: the nonce we sent to the IdP must round-trip in the ID token.
    if (claims["nonce"] !== nonce) {
      throw new HttpError(502, "oidc_token_error", "id_token nonce does not match the authorization request.");
    }

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
