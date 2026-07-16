# Audit — C-3: verified DB TLS (session D)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode)
Branch: `feat/delivery-pipeline`
Files: `src/shared/db.ts` (sslConfig), NEW `src/shared/db-ssl.test.ts`, `.env.example`

## Origin

Standing critical C-3: production Postgres connections used TLS with
`rejectUnauthorized:false` (db.ts sslConfig) — encrypted but unauthenticated,
open to man-in-the-middle interception of all tenant/financial data.

## What was done

`sslConfig()` (now exported, env-injectable for tests):
- TLS on (production default, or PG_SSL truthy) → **certificates verified**
  against Node's bundled CAs. Managed PG providers use publicly-signed
  chains, so this is expected to just work.
- `PG_CA_CERT` (PEM) / `PG_CA_CERT_B64` (base64 PEM) → verified against the
  supplied private CA.
- `PG_SSL_NO_VERIFY=1` → old unverified behavior, restored ONLY explicitly,
  with a loud console warning on boot.
- `PG_SSL=false` semantics unchanged (no TLS, local CI Postgres).

## ⚠️ Deploy note for Sri (merge = prod behavior flip)

On the first production deploy after merge, DB connections will verify the
server certificate. If the prod DB's chain is NOT publicly verifiable,
connections fail at boot — /readyz and the post-deploy smoke will catch it;
remediation is setting `PG_CA_CERT(_B64)` or, as a last resort,
`PG_SSL_NO_VERIFY=1` in the Vercel env. Recommend confirming the provider's
cert chain before merging.

## Delivery standard

- **Architecture impact**: none.
- **Database impact**: connection-level only; no schema change.
- **Testing evidence**: NEW db-ssl.test.ts pins the 7-case matrix (prod
  default verified, non-prod off, PG_SSL=1 verified, PG_SSL=false off,
  escape hatch unverified, PEM CA, base64 CA) — 7/7. Typecheck PASS.
  Smoke 20/20 (local, non-TLS path unaffected). NOT verified from here:
  an actual TLS handshake against the production provider (no prod
  DATABASE_URL in this environment) — hence the deploy note above.
- **Security impact**: closes C-3 in code; MITM window remains only if the
  escape hatch is set.
- **Rollback**: revert commit, or set PG_SSL_NO_VERIFY=1 (no code change).
- **Monitoring/alerting needs**: C-4 (no deploy alerting) makes the
  post-deploy smoke the only automatic guard — one more reason to close C-4.
