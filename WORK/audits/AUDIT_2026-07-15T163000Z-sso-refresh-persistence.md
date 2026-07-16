# Audit — SSO refresh-token persistence (session D)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode)
Branch: `feat/delivery-pipeline`
Files: `src/modules/sso/service.ts`, `src/modules/sso/sso-security.test.ts`

## Origin

Follow-up flagged in AUDIT_2026-07-15T161500Z-sso-oidc-hardening.md:
`handleCallback` signed a refresh JWT but never stored its hash in
`refresh_tokens`, and `identity.refresh()` requires a matching non-revoked
row — so every SSO session silently died after the 15-minute access token
expired. Originally deferred as "near session C's area"; on inspection the
fix is entirely inside `service.ts` (session D's claimed file), so taken.

## What was done

On SSO login, persist the refresh-token row exactly as identity's
`issueLoginSession` does: uuidv7 id, sha256 hex `token_hash`, 7-day expiry,
same table. No signature/shape changes; `identity.refresh()` now accepts
and rotates SSO-issued tokens with its existing reuse-detection logic.

## Delivery standard

- **Architecture impact**: none. Mirrors the identity insert; SSO module
  still owns no tables. (Deliberate small duplication of the insert + hash
  rather than importing IdentityService — constructing it needs `events`,
  which would require touching `sso/index.ts`, session C's claimed file.
  Noted for a later consolidation when C releases.)
- **Database impact**: none (existing refresh_tokens table; both migration
  paths untouched).
- **Testing evidence**: NEW round-trip test — SSO login → identity.refresh()
  issues a rotated pair (used to 401). sso-security 5/5 + sso 10/10 +
  identity 21/21 = 36/36 isolated real-PG; typecheck PASS; smoke 20/20.
- **Security impact**: neutral-positive — SSO refresh tokens now subject to
  the same DB revocation/rotation controls as password-login tokens
  (previously they were pure JWTs with no revocation row at all).
- **Rollback**: revert the commit. Existing rows are inert.
- **Monitoring/alerting needs**: none new.
