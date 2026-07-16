# Audit — API-review fixes: lockout coverage, CONTRACTS truth, error registry (session D)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode)
Branch: `feat/delivery-pipeline`

## Scope

Three items triaged out of an external API-endpoint review (most of that
review's recommendations were rejected — see triage in session; caching,
version negotiation, db/ rename, auth consolidation all declined as
churn/premature).

## What was done

1. **Login brute-force protection — finding revised, tests added.**
   The triage claimed identity had no lockout; that was WRONG. Full account
   lockout already exists (`src/identity/service.ts:18-19,156-185`): 10
   consecutive failures → 30-min lock, 429 `account_locked`, reset on
   success, MFA path covered, attempts logged. What was missing was test
   coverage — a security control that could silently regress. NEW
   `src/identity/lockout.test.ts` pins: lock-after-threshold (correct
   password 429s while locked), counter reset on success, expired-lock
   recovery. 3/3 pass isolated on real PG.

2. **CONTRACTS.md truth-restore.** Root CONTRACTS.md called itself "single
   source of truth" while describing SQLite and pre-tenant DDL (no
   tenant_id). Added a prominent HISTORICAL/superseded banner pointing to
   the maintained truth (ARCHITECTURE.md, module migrations + db/migrations,
   CODING_STANDARDS.md, DOMAIN_MODEL.md) and noting which parts still hold
   (module isolation, EventBus integration, integer cents). Kept in place
   because code comments cite it (orders/tax.ts, modules/types.ts).

3. **Pagination + versioning policy** added to
   `docs/architecture/CODING_STANDARDS.md`: cursor REQUIRED for unbounded
   append-heavy lists, offset acceptable for small bounded lists, new
   endpoints default cursor, no migration of shipped offset endpoints
   without cause; `/api/v1` additive-only, breaking change mints `/api/v2`,
   no Accept-header negotiation.

4. **Error-code registry** in `src/shared/http.ts` (additive):
   `ERROR_CODES` const documents the shared vocabulary (12 codes, one
   status each); domain codes stay module-owned by design (no bottleneck
   enum). `HttpError` gains optional `details`; `parseBody` now emits
   per-field validation issues in `details` (flattened message unchanged);
   `errorMiddleware` includes `details` only when present. Envelope change
   is strictly additive.

## Delivery standard

- **Architecture impact**: none structural. Error envelope gains optional
  `error.details` (additive). Known pre-existing inconsistency NOT churned:
  two `"validation"` (vs `validation_error`) code strings left as-is —
  changing shipped code strings violates the additive-only policy.
- **Database impact**: none. No schema change (lockout columns already
  existed in identity migrations).
- **Testing evidence**: typecheck PASS; lockout 3/3; identity + payments +
  lockout 40/40 isolated on real PG; smoke 20/20 PASS.
- **Security impact**: positive — lockout behavior now regression-pinned.
- **Rollback**: revert the single commit; no data migration involved.
- **Monitoring/alerting needs**: none new (C-4 alerting gap remains the
  standing critical).

## Honest notes

- The initial triage misreported the lockout gap because the verification
  grep only searched `routes.ts`, not `service.ts`. Corrected here.
- `scripts/test.ts` ignores CLI args (always full suite); isolated runs done
  via a scratchpad clone of its harness. Full parallel suite has known
  flakes (per ARCHITECTURE.md) and was not run; isolated runs + smoke are
  the authoritative gates used.
