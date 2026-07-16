# Audit — SSO OIDC hardening: token verification, DB state, SSRF guard (session D)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode)
Branch: `feat/delivery-pipeline`
Files: `src/modules/sso/service.ts`, NEW `src/modules/sso/sso-security.test.ts`

## Origin

External tech-debt report triage. Of its 3 "criticals", this was the one that
survived verification: `handleCallback` decoded the OIDC id_token with
`jwt.decode` (no signature check, no iss/aud/exp validation) — the code
comment admitted it. Real impact: anyone able to edit a tenant's SSO config
could point discovery at a rogue IdP and mint claims for ANY user in that
tenant (manager→owner escalation). Secondary finding upgraded from the
report's "memory leak" mislabel: the in-memory OAuth2 state Map breaks SSO
outright on serverless whenever the callback lands on a different instance.

## What was done (service.ts only — session C owns routes.ts/sso.test.ts/index.ts)

1. **id_token verification.** Callback now fetches the provider's discovery
   document + JWKS (1h in-memory cache as optimization) and verifies the
   token: signature against the JWKS key (kid match), asymmetric algorithms
   only (RS/PS/ES — no HS downgrade), audience = clientId, issuer from the
   discovery doc, expiry via jwt.verify. Failures → 401 `invalid_id_token`.
   No new dependency: Node `createPublicKey({format:"jwk"})` + jsonwebtoken.
   Token endpoint now prefers the discovery doc's `token_endpoint` (pattern
   fallback kept).

2. **DB-backed OAuth2 state.** State rows live in `settings_kv`
   (`sso.state.<state>`, 10-min TTL) — the table this module already uses;
   no migration, module still owns no tables. Callback consumes via
   `DELETE ... RETURNING` (single-use even under concurrent callbacks);
   expired rows purged on each initiate.

3. **SSRF guard** (`assertSafeDiscoveryUrl`, exported): http(s) only; in
   production https-only + no loopback/private/link-local; outside
   production http allowed only against loopback (local IdP in tests).
   Enforced at config save AND at each use (configs predating the guard).
   Honest limit: literal-IP checks only — DNS rebinding not covered.

## Delivery standard

- **Architecture impact**: none structural. SSO module still owns no tables.
- **Database impact**: none (reuses settings_kv; no schema change, both
  migration paths untouched).
- **Testing evidence**: NEW sso-security.test.ts spins a real local IdP
  (http server: discovery + JWKS + token endpoint, RS256-signed tokens):
  verified happy path with state consumed by a DIFFERENT service instance
  (serverless proof) + replay rejected; forged-key token 401;
  wrong-audience token 401; SSRF guard matrix. 4/4 new + 10/10 existing
  sso.test.ts unchanged = 14/14 isolated real-PG. Typecheck PASS.
  Smoke 20/20 PASS.
- **Security impact**: closes the rogue-IdP escalation; state single-use
  hardens against replay; SSRF surface reduced.
- **Rollback**: revert the commit; no data migration. Stale sso.state.* rows
  self-purge.
- **Monitoring/alerting needs**: none new (C-4 standing).

## Known follow-ups (found, deliberately NOT done here)

- SSO-minted refresh tokens are signed but never stored in `refresh_tokens`,
  so `identity.refresh()` will reject them — SSO sessions cannot refresh
  past 15 minutes. Fix belongs with identity/SSO routes integration; near
  session C's active area, so flagged instead of taken.
- No PKCE / no nonce in the auth flow yet (needs IdP-compat decision).
- Session C's uncommitted sso.test.ts additions will need a trivial rebase
  over this service.ts change (no signature changes; behavior additive).
