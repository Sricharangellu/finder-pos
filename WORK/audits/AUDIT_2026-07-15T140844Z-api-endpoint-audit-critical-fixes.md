# Audit — Full API Endpoint Review + 3 Critical Fixes

Date: 2026-07-15T140844Z
Session: Claude session C (Sonnet 5)
Status label: **Built and verified** (backend only; landed alongside the quotes Clean Architecture pilot on the same branch)

A full-surface review of every route file (39+ `routes.ts` files plus 12 modules with
routes embedded in `index.ts`) across REST conventions, validation, authorization, error
handling, rate limiting, pagination, filtering, sorting, logging, caching, response
consistency, and versioning. Surfaced 3 critical, verified-in-code bugs (fixed in this
pass) and ~50 lower-severity findings (not fixed here — listed below for a follow-up).

## Critical bugs found and fixed

1. **10 business-pack modules were completely unreachable in production** — not the 2
   originally scoped. `restaurant`, `workforce`, and all 8 vertical modules
   (`appointments`, `entertainment`, `education`, `healthcare`, `hospitality`,
   `manufacturing`, `automotive`, `rental`) mount at the default `/api/v1/<name>` (no
   `mountPath` override), but every internal route was *also* prefixed with the module
   name — e.g. `src/modules/healthcare/index.ts` registered `router.get("/healthcare/patients", ...)`
   under a router already mounted at `/api/v1/healthcare`, producing
   `/api/v1/healthcare/healthcare/patients`. The frontend calls the correct
   single-prefix path, so every one of these 10 modules 404'd on every real request.
   Fix: dropped the redundant internal prefix from all 10 modules' route registrations.
   The restaurant/workforce instance of this bug was found directly during the API
   review; the 8-vertical-module instance was found afterward, while writing a
   regression test for fix #3 below (switching a tenant's business type stopped the new
   `requireModule` guard from short-circuiting the request, which is what made the
   pre-existing 404 newly visible instead of masked).

2. **SSO login was unreachable.** `src/modules/sso/routes.ts`'s `/initiate` and
   `/callback` sat behind the global `/api/v1` auth gate
   (`makeAuthMiddleware`+`tenantResolver`, `src/app.ts:302`) with no bypass — but these
   are the pre-login handshake, called by a user who by definition has no token yet.
   Fix: split them into `registerPublicRoutes()` (still in `sso/routes.ts`), mounted in
   `app.ts` at `/api/v1/sso` ahead of the auth gate — same pattern already used for
   identity's `/api/identity/login`/`/refresh`. `/config` (GET/PUT/DELETE, owner-only)
   stays on the normal auth-gated router; unchanged.

3. **Business-pack isolation was never enforced server-side.** The existing
   `requireCapability()` guard (`src/gateway/auth.ts`) turned out to be built against a
   dead mechanism — `tenant_capabilities` is only ever seeded with `retail`/`wholesale`
   rows (`src/modules/business/service.ts`), so calling `requireCapability("healthcare")`
   would have 403'd every tenant, including ones legitimately on the healthcare business
   type. The mechanism that's actually wired to business-type selection is
   `SettingsService.getCapabilities()` (`src/modules/settings/service.ts`) — business
   type → `BUSINESS_BUNDLES` (`src/shared/moduleRegistry.ts`) → per-module
   enabled/disabled, already correctly deny-by-default for modules outside the tenant's
   bundle — but it was only ever consumed by the frontend (`GET /api/v1/capabilities`),
   never enforced at the route layer. Fix: added `requireModule(moduleKey)` to
   `src/gateway/auth.ts` (reuses `SettingsService.getCapabilities`, fails closed — same
   posture as `requireCapability`, not `requirePlan`'s fail-open) and applied
   `router.use(requireModule("<key>"))` at the top of each of the 8 vertical modules'
   `register()`, using each vertical's representative key from `MODULE_REGISTRY`:
   appointments, tickets (entertainment), student_accounts (education), patient_records
   (healthcare), room_billing (hospitality), production_orders (manufacturing),
   work_orders (automotive), rental_contracts (rental).

## Changes

- `src/modules/{restaurant,workforce}/routes.ts` — dropped redundant internal path
  prefix on every route.
- `src/modules/{appointments,entertainment,education,healthcare,hospitality,manufacturing,automotive,rental}/index.ts`
  — dropped redundant internal path prefix on every route; added
  `router.use(requireModule("<key>"))` as the first line of `register()`; added
  `requireModule` to the existing `gateway/auth.js` import.
- `src/gateway/auth.ts` — new `requireModule(moduleKey)` middleware.
- `src/gateway/index.ts` — export `requireModule`.
- `src/modules/sso/routes.ts` — split `/initiate`/`/callback` into
  `registerPublicRoutes()`; `registerRoutes()` now only has `/config`.
- `src/app.ts` — mount SSO's public routes ahead of the `/api/v1` auth gate, same
  rate-limit tier as identity (`capacity: 10, refillRate: 0.33`).
- New regression tests: `restaurant.test.ts`, `workforce.test.ts` (double-prefix), one
  new test in `sso.test.ts` (no-Authorization-header reachability), and
  `{appointments,entertainment,education,healthcare,hospitality,manufacturing,automotive,rental}.test.ts`
  (deny-by-default + business-type-switch-unlocks, one file per module — none of these
  8 modules had any test coverage before this change).
- Also includes the quotes Clean Architecture pilot on the same branch: Repository +
  DTO extraction on `quotes` (new `quotes.repository.ts`/`quotes.dto.ts`, `create()`
  wrapped in `db.tx` for atomicity, `quote.converted` event on `convertToOrder()`), plus
  pure rule-evaluation extraction from `src/gateway/auth.ts` into new
  `src/identity/authorization.ts` — see `~/.claude/plans/eager-splashing-hoare.md`.

## Verification

- `npm run typecheck` clean after every step.
- New tests: 16/16 passing across the 8 vertical modules (both scenarios: denied by
  default, unlocked after business-type switch); 3/3 for restaurant/workforce
  double-prefix; SSO regression test passing (38/38 in `sso.test.ts` + related
  gateway/identity files, including the new no-token test).
- Full backend suite: 399/400 passing in the original working tree before this session
  hit an unrelated OS-level permission issue (see Notes); the 1 failure was
  `progress.test.ts` hanging ~6.5h then timing out — unrelated to this change,
  consistent with concurrent-session Postgres port contention from other active Ascend
  worktrees per `WORK/LOCK.md`. Full suite re-run from a fresh clone (see Notes) — see
  this PR's CI results for the authoritative final numbers.

## Architecture / database / security impact (delivery standard)

- **Architecture impact:** none — no new abstraction, reuses `SettingsService.getCapabilities`
  and the existing `handler`/`HttpError`/error-envelope conventions.
- **Database impact:** none — no schema change, no migration.
- **Security impact:** closes a real cross-tenant business-pack isolation gap (finding
  #3) and restores SSO login (#2); the 10-module routing fix (#1) has no security
  dimension, it's pure reachability.
- **Rollback:** revert the branch; all changes are additive/route-registration only, no
  data migration to unwind.
- **Monitoring/alerting:** none added — worth noting `requireModule` denials
  (`module_not_enabled` 403s) aren't currently distinguished in metrics from other 403s;
  not blocking, flagged for the observability backlog.

## Notes / next

- **Mid-session OS permission issue:** partway through wrap-up (verification/commit),
  `/Users/sri/Desktop/Prj/Ascend` (the shared main working tree, and by extension every
  worktree off it, including this branch's original worktree) started returning `EPERM`
  for all read/write access — a macOS Full Disk Access / Files-and-Folders permission
  problem, not a git lock (confirmed via `lsof`) and not specific to one file (confirmed
  via `ls` on the directory itself). This is why this branch was finished from a fresh
  `gh repo clone` under `/private/tmp` instead of the original worktree — same content
  (verified via `git status` diff matching the original worktree's changed-file list
  exactly), different filesystem location, so git/commit/push would work again.
  **Manual follow-up needed once the original path is accessible again:** mark this
  session's `WORK/LOCK.md` claim (session C) as RELEASED, and add the item below to
  `WORK/FORWARD_PLAN.md` — neither could be edited from the fresh clone since they're
  live coordination docs other concurrent sessions may have moved on independently.
- **Queued follow-up (not started):** SSO's OIDC ID token is accepted via `jwt.decode()`
  with no signature verification (`src/modules/sso/service.ts` — no JWKS fetch, no
  `jwt.verify`, no `nonce`), and the OAuth `state` store is an in-process `Map`
  (`src/modules/sso/service.ts`) which won't survive across Vercel's separate serverless
  invocations — the same class of bug as the tracked C-2 critical (in-process job-queue
  state not surviving across instances). Both found during a follow-up security-report
  verification pass this session; queued as the next claim after this PR, not bundled in.
- ~50 lower-severity findings from the same review were **not** fixed in this pass —
  reported in-session to Sri, not persisted verbatim in this file. Highlights: no
  role-gate on several money-movement mutations (order refund/void, payment capture,
  pay bill/invoice) and inventory stock mutations (adjust/receive/transfer/deduct);
  inconsistent/unbounded pagination in several modules; inconsistent list-response
  envelopes across modules; DELETE returning 200 instead of 204 in a few modules. Worth
  a dedicated follow-up pass, prioritized by the same order used above (money/security
  first).
- The frontend's `/api/v1/restaurant/dashboard` call
  (`web/app/(protected)/restaurant/dashboard/page.tsx`) has no matching backend route at
  all, prefix bug aside — separate, smaller gap noticed in passing, not fixed here.
