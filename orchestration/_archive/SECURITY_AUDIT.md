# Security Audit — Ascend ERP

Dedicated security pass across the gateway + 19 modules. Date: 2026-06-13. Reviewer: backend agent.

## Summary
Three issues found and **fixed**; the rest of the surface (authn, tenant isolation, validation,
secrets) reviewed and passing. No critical/data-leak issues outstanding.

## Fixed in this pass

### H1 — Login endpoint had no rate limiting (brute-force) — FIXED
`/api/identity/login` and `/refresh` sat outside the `/api/v1` limiter, so credential stuffing was
unthrottled. Added a strict per-IP token-bucket limiter in front of the identity router (~20/min
sustained, burst 10). Verified: 11th rapid login attempt returns **429**.

### M1 — 500 handler leaked internal error text — FIXED
`errorMiddleware` echoed `err.message` for unhandled errors, exposing SQL/stack internals to clients.
Now logs the full stack server-side and returns a generic `{ code: "internal", message: "internal error" }`.
HttpError (4xx) messages are still returned (they're intentional, safe copy).

### M2 — Sensitive mutations were not role-gated — PARTIALLY FIXED + pattern shipped
Only settings mutations enforced a role. Extracted a shared `requireRole(min)` guard into
`gateway/auth.ts` (owner > manager > cashier) and applied **manager+** to the financial-control
endpoints `POST /accounting/deposits/:id/approve|reject`. Verified: cashier → **403**, owner passes.
Settings now uses the shared guard too (removed its local copy).

## Reviewed — passing

- **Authentication:** JWT (HS256) verified on every `/api/v1/*` request; required claims (tenantId,
  sub) enforced; expired vs invalid tokens distinguished (`token_expired` vs `unauthenticated`).
  Access tokens short-lived, refresh tokens separate. `JWT_SECRET` read from env; startup fails closed
  (500 "misconfigured") if unset.
- **Tenant isolation:** every service query filters `tenant_id` from `res.locals.auth` (set by the
  authenticated token, never from client input). No cross-tenant read path found (see DB_REVIEW.md §1).
- **Input validation:** every mutating route validates the body with zod (`parseBody`) → 400 on bad
  input; query params parsed defensively. No raw body fields reach SQL.
- **SQL injection:** all queries use named parameters (`@name`) via the db layer; no string concatenation
  of user input into SQL.
- **Secrets:** none committed to the repo. `JWT_SECRET` + `DATABASE_URL` are Vercel env vars. (The Vercel
  deploy token lives only in agent memory at the user's explicit request — flagged there to rotate if
  exposed.)
- **Rate limiting:** per-tenant tiered limiter on `/api/v1`; per-IP limiter now on auth.

## Recommended next (not blocking)

1. **Finish the RBAC matrix.** Apply `requireRole` to the remaining sensitive mutations per the benchmark
   matrix — voids/refunds, vendor credits/returns, PO receive, discount create, price changes. The guard
   and pattern are now in place; this is mechanical.
2. **DB-level RLS** as defense-in-depth (see DB_REVIEW.md §6).
3. **Refresh-token rotation/revocation** check — confirm refresh tokens are single-use/revocable on logout.
4. **Per-customer discount usage limit** is defined but not yet enforced at redeem (only the global
   `usage_limit` is). Enforce `per_customer_limit` when checkout attribution lands.
