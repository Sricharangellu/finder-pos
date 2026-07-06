# FinderPOS — Work State
> Last updated: 2026-07-06 (session E, standing prod-actions surface)  |  Location: `WORK/` (canonical AI work folder — see `WORK/README.md`)

---

## ⚠️ OPEN PRODUCTION ACTIONS — Sri only (re-verified 2026-07-06)

Live production exposures that CODE CANNOT close — they need a human with prod access.
Every session: re-probe before assuming these are resolved, and update this block.

- 🔴 **`finder-pos.vercel.app` returns HTTP 500.** This is a STALE/ORPHANED Vercel
  project outside the CI deploy pipeline. The pipeline builds + aliases
  **`finder-pos-frontend.vercel.app`** (healthy, 200, wired to the backend). Anyone
  visiting the "obvious" URL sees a crash. FIX: delete the orphaned project OR repoint
  its domain to the current frontend deployment. NOTE: `src/app.ts` CORS allowlist +
  email-reset fallback still name `finder-pos.vercel.app` as canonical, so pick ONE
  canonical host and make it consistent.
- 🟡 **Confirm `NODE_ENV=production`** on the Vercel backend project (governs seed-boot
  guard, DB SSL, secure cookies).
- 🟡 **`METRICS_TOKEN` unset in prod** — `/metrics` is correctly closed (503) but no
  scraper can read it until set. Non-blocking.
- ✅ **Demo credentials rotated (RESOLVED 2026-07-06).** `owner@finder-pos.dev` now
  returns 401 on the live backend — Sri ran the rotation. Code guards (seed-e2e /
  seed-demo refuse without opt-in) remain in place to prevent re-planting.

---

## Active task

**Phase 1: Truth and cleanup** per `WORK/FORWARD_PLAN.md`. Feature/module expansion is
**PAUSED** until Phase 2 exit criteria pass. Phase 2 is now explicitly the
**Retail release pack**: finish one complete business type end-to-end before deepening
wholesale, restaurant, mobile, grocery, ecommerce, or other packs.

2026-07-06 session A — **Foundation Hardening initiative** (`WORK/FOUNDATION_HARDENING.md`),
ran under an EXCLUSIVE lock (board was clear). Completed §1–§3:
- **§1 cleanup** (`0c7a736`): removed orphaned stuck Next build dir + stray
  `tsconfig*.tsbuildinfo` (all untracked); `.gitignore` now blocks `*.tsbuildinfo`,
  `.next`/`.next.stuck-*`, and ` N.tsbuildinfo` copies.
- **§2 governance** (`098bbf7`): archived all 25 `AUDIT_*.md` into `WORK/audits/` (active
  WORK/ is now 6 clean docs); go-forward audit naming is `WORK/audits/AUDIT_<UTC-ISO>-<slug>.md`
  (collision-proof, never letters — the letter scheme caused a real merge blocker).
  AGENTS.md + WORK/README.md updated.
- **§3 wiring matrix** (`eb3b236`, `WORK/audits/AUDIT_2026-07-06T010352Z-wiring-matrix.md`):
  runtime-probed all 54 frontend `/api/v1` prefixes vs the real backend. **46/54 wired**
  (bare-prefix 404s were just no-root-route, confirmed via sub-paths). 8 unwired: `things`
  = JSDoc false-positive; `auth/*` = real fetch-path drift (small fix); `promotions` +
  `permission-requests` = real backend gaps (features); `documents`/`pricing`/`warehouse`/
  `golf` = expected UI-only Preview per RULES.md.
- **§4 (structural restructure) NOT done** — deferred to Sri: mass file-moves are the risky
  part the spec says needs a plan sign-off; not worth doing blind.

Gates this session: docs/config/file-moves only, no src/web code changed → typecheck/tests
unaffected; tree clean; servers stopped.

**Next 3 actions:** (1) fix `auth/*` fetch-path drift (small); (2) decide promotions +
permission-requests: build backend or mark the pages Preview; (3) if wanted, scope §4
structural restructure as an explicit incremental plan (don't move blind).

2026-07-05 Codex session O follow-up (full findings in `WORK/AUDIT_2026-07-05H.md`):
the pushed CI run proved backend, frontend build, production deploy, and post-deploy
smoke green, but Playwright still failed because the module marketplace E2E clicked a
disabled switch. Several authenticated route checks were also flaky after worker
retries redirected to `/login`. The E2E tests now use explicit authenticated
navigation recovery, and the module switch test only clicks enabled switches while
asserting disabled controls honestly when that is what the UI renders. Local
verification: frontend typecheck PASS, frontend lint PASS with the same four
pre-existing hook warnings, Playwright test discovery PASS (26 tests), `git diff
--check` PASS. Full browser proof must come from the next GitHub CI run.

2026-07-05 Codex session O (retail-first E2E gate alignment - full findings in
`WORK/AUDIT_2026-07-05F.md`): the backend operational-readiness work is now proven
through CI backend gates and production smoke, but the CI Playwright job was red because
`web/e2e/verticals.spec.ts` still asserted the old false product claim that every
non-retail vertical is fully active/complete in CI. The E2E suite now matches the
binding product rule: retail is the current Built/verified release pack; non-retail
business packs are Preview and should be checked for authenticated rendering/no crash,
not full workflow readiness. Verification: frontend typecheck PASS, `git diff --check`
PASS, Playwright test discovery PASS (26 tests). Full Playwright execution is left to
GitHub CI because another active session's lock avoided ports/concurrent Next builds.

2026-07-05 Codex session N (production smoke auth alignment - full findings in
`WORK/AUDIT_2026-07-05D.md`): post-deploy CI smoke was corrected after session M's
production deploy exposed a stale assumption. The live backend correctly returns `401`
for unauthenticated `GET /api/v1/flags`; the old smoke step still expected public `200`.
`.github/workflows/ci.yml` now asserts the intended auth boundary instead of treating
secure behavior as a failure. Verification passed: live flags auth-boundary curl PASS
(`401`), `git diff --check` PASS. The broader session M gates were already green on
the pushed commit before the stale smoke step failed.

2026-07-05 session E part 3 (business-profile contract + audit history — full findings
in `WORK/AUDIT_2026-07-05G.md`): a real backend/mock drift is **fixed and verified** —
real `POST /settings/business-profile` required businessType and ignored `moduleFlags`,
so Business Profile module toggles only worked against the mock (400 on real backend)
and a type switch reset all manual overrides. The endpoint now supports moduleFlags
delta updates, enabledModules explicit sets, and businessType bundle resets (empty body
400), with every change audit-logged (`business_profile.type_changed` /
`.modules_changed`, real actor ids) — closing the Settings plan bullet "last
business-type/module changes with actor and timestamp". The Business Profile page shows
a Recent Changes section (actor + timestamp + human diff) with mock parity. Gates:
focused settings 23/23 (real Postgres), full backend suite 332/332, smoke 20/20,
backend+web tsc 0, Vitest 94/94, lint 4 pre-existing warnings, mock-off build green.

2026-07-05 session E part 2 (retail setup checklist + honest onboarding — full
findings in `WORK/AUDIT_2026-07-05E.md`): two "Signup and setup" plan requirements are
**Built and verified**. (1) `RetailSetupChecklist` on the dashboard: the seven required
retail tasks (outlet, register, tax, payment modes, receipt, first product, first
receiving) with LIVE completion detection against the same APIs the setup pages write
to — fails closed, deep links, dismissible, auto-hides when complete or non-retail.
(2) Onboarding business types now render from the capabilities registry; retail is
badged Ready, all other packs Preview with an honest amber notice on confirm — setup
no longer presents every vertical as equally complete. Gates: web tsc 0, Vitest 94/94,
lint 4 pre-existing warnings, mock-off build green, backend tsc 0. Noted follow-up:
the signup page's separate hardcoded business-type grid needs the same Preview
treatment when claimed.

2026-07-05 session E (capabilities-driven shell + Business Profile — full findings in
`WORK/AUDIT_2026-07-05C.md`): retail-first queue item #3 is **Built and verified**.
The frontend now renders from the business-pack control plane: new
`CapabilitiesContext` (tenant layer, fail-open, 5-min cache) feeds a rewired
`useModuleFlags` (same signature, 5 consumers untouched) and four-layer nav filtering
in `EnterpriseShell` (moduleGate → capabilities route gate → user feature gate). The
Settings modes page's hardcoded MODES list is replaced by a capabilities-driven
Business Profile / Plan & Modules view with a business-type switcher that previews
impact (`GET /capabilities/impact`) before applying, and per-module toggles with
source/disabled-reason badges. Mock parity: `GET /capabilities` (+ aliases + impact)
served from the same in-memory bundle state as the business-profile handlers.
**Real-backend nav bug fixed:** useModuleFlags previously read raw feature-flags and
missed business-pack DEFAULTS — a fresh real tenant's nav collapsed to core-only.
Gates: web tsc 0, Vitest 91/91 (new context tests), lint same 4 pre-existing warnings,
`NEXT_PUBLIC_MOCK=false` build green, backend tsc 0 (no backend changes). Follow-ups
noted in the audit: migrate `useAccountMode` onto capabilities.features; retail setup
task checklist UX; demo switcher Preview labels.
2026-07-05 Codex session M (backend operational readiness - full findings in
`WORK/AUDIT_2026-07-05B.md`): production/backend infra readiness is **Built and
verified as a deploy gate**, not a claim that the whole app is deployment-ready.
Added `npm run ops:check`, wired backend deployment to run the richer live readiness
check, closed production metrics by default when `METRICS_TOKEN` is absent, expanded
the default CORS allowlist for the deployed frontend URLs, and added `PG_SSL` so
production-mode checks can run against local/CI Postgres without weakening the
production default. Pre-deploy live truth: the currently deployed backend failed the
new ops check because `/metrics` was publicly readable and the deployed frontend origin
did not receive CORS allowance. The code now fixes those classes of drift once deployed,
but real metrics scraping still requires configuring `METRICS_TOKEN`; without it,
production `/metrics` is intentionally closed with `503 metrics_unconfigured`.
Verification passed: backend typecheck PASS, focused ops/metrics tests PASS 4/4,
local production-mode ops check PASS 6/6, focused settings suite PASS 20/20, full
backend suite PASS 329/329, smoke PASS 15/15, frontend typecheck PASS, frontend lint
PASS with the same 4 pre-existing hook warnings, frontend Vitest PASS 89/89, and
frontend production build PASS with `NEXT_PUBLIC_MOCK=false`.

2026-07-05 Codex session L (business impact preview - full findings in
`WORK/AUDIT_2026-07-05A.md`): retail-first queue item #2 is **Built and verified**.
The backend now exposes a read-only business-type/module impact contract at
`GET /api/v1/capabilities/impact`, with a settings-module alias at
`GET /api/v1/settings/capabilities/impact`. It previews the difference between the
current tenant capabilities and a requested target business type or module override
without writing tenant settings. The response reports added/removed modules, unchanged
enabled modules, required-field deltas, workflow deltas, permission/report/page deltas,
setup tasks, slim current/target snapshots, the exact apply payload for
`POST /api/v1/settings/business-profile`, and warnings that entitlement enforcement is
still a placeholder and only retail may be treated as Built/verified. Real-Postgres
tests prove Retail -> Wholesale preview, module override preview, and bad module
rejection. Verification passed: backend typecheck PASS, focused settings suite PASS
20/20, full backend suite PASS 327/327, smoke PASS 15/15, frontend typecheck PASS,
frontend lint PASS with the same 4 pre-existing hook warnings, frontend Vitest PASS
89/89, and frontend production build PASS with `NEXT_PUBLIC_MOCK=false`.

2026-07-04 Codex session K (business capabilities endpoint - full findings in
`WORK/AUDIT_2026-07-04M.md`): retail-first queue item #1 is **Built and verified**.
The backend now exposes a read-only current-tenant/current-user capabilities contract at
`GET /api/v1/capabilities`, with a settings-module alias at
`GET /api/v1/settings/capabilities`. It reports business type, business-pack source,
module enablement/defaults/manual overrides/disabled reasons, effective feature flags, user access
scope, subscription plan summary, explicit non-enforced entitlement placeholder,
required fields, workflows, module groups, core modules, and available business types.
Fresh tenants default to the retail pack; business-profile selection and manual module
flag overrides are proven by real-Postgres settings tests. `POST /api/v1/settings/business-profile`
now accepts every existing `BUSINESS_BUNDLES` key instead of an outdated short subset.
Verification passed: backend typecheck PASS, focused settings suite PASS 17/17, full
backend suite PASS 324/324, smoke PASS 15/15, frontend typecheck PASS, frontend lint
PASS with the same 4 pre-existing hook warnings, frontend Vitest PASS 89/89, and
frontend production build PASS with `NEXT_PUBLIC_MOCK=false`.

2026-07-04 Codex session J (retail-first platform plan rewrite - full findings in
`WORK/AUDIT_2026-07-04L.md`): Sri clarified the development strategy. Finder remains
one modular business operating platform, but the first product release must be **Retail
end-to-end**. Future agents must not build deeper wholesale/restaurant/mobile/grocery
vertical functionality until retail is Built and verified against the real backend.
`WORK/RULES.md` now carries the binding retail-first mandate. `WORK/FORWARD_PLAN.md`
now defines Phase 2 as the Retail release pack, Phase 3 as the business-pack control
plane (`GET /api/v1/capabilities`, impact preview, capabilities-driven setup/settings/
demo switching), Phase 4 as production hardening, and Phase 5 as non-retail expansion.
Business-type switching for demo accounts is planned as a capabilities-driven preview,
not proof that every business pack is production-ready.

2026-07-04 Codex session I (production mock-off deploy guard - full findings in
`WORK/AUDIT_2026-07-04K.md`): queue item #5 is **partially closed for production
deployment safety**. The production deploy workflow now passes `NEXT_PUBLIC_MOCK=false`,
and `scripts/deploy.sh` refuses any production frontend deploy that explicitly tries to
ship with `NEXT_PUBLIC_MOCK` set to anything other than `false`. Non-production
deployments still default to mock/demo mode so demos and preview URLs remain usable, and
the existing live-site demo override (`?demo=1` / localStorage demo flag) still works.
Verification passed: deploy script syntax check PASS, production mock guard refusal PASS,
and frontend production build PASS with `NEXT_PUBLIC_MOCK=false` plus
`BACKEND_URL=https://finder-pos-backend.vercel.app`; backend typecheck PASS; frontend
typecheck PASS; frontend lint PASS with the same 4 pre-existing hook warnings; frontend
Vitest PASS 89/89; backend full suite PASS 322/322 after a first local 319/322 timeout
run was isolated to Postgres migration-lock contention (`PG_TX_TIMEOUT_MS=120000` rerun
green; focused failed files PASS 22/22). Remaining item #5 work is the product decision
about a dedicated staging database/deploy target and whether to change the source
default in `web/next.config.mjs`; production can no longer silently ship MSW mock mode
through the current deploy path.

2026-07-04 Sri product-scope correction (recorded in `WORK/FORWARD_PLAN.md`): Finder is
**not only a retail POS**. The authoritative scope is now a modular business operating
platform for product-based businesses: one backend truth and shared core entities, with
business packs for retail, wholesale/B2B, restaurant/food, mobile/electronics,
grocery/expiry, ecommerce, services, and enterprise operations. Current business-mode
implementation is **Partial**: `moduleRegistry`, `business-profile`, feature flags,
settings modes, module marketplace, nav gates, and permissions exist, but they mostly
control visibility. The next architecture work is to harden this into real plan +
business type + entitlement + permission enforcement, required-field rules, workflow
templates, and a company-facing impact view that shows what changes when a business type
or module is enabled.

2026-07-04 session E part 3 (e2e core-flow triage — full findings in
`WORK/AUDIT_2026-07-04J.md`): queue item #1 is **Built and verified** — **all 13 core
specs PASS** against production build (`NEXT_PUBLIC_MOCK=false`) + real backend + real
Postgres, including a full cash sale (search → add → tender → collect → receipt).
Baseline was 25/47 with all 10 core-flow specs failing. Went beyond spec fixes: 6 real
product bugs fixed — hardcoded `reg_01` register default (real tenants stranded on
"register not found"), $NaN money from snake_case/camelCase wire drift across
product/order/payment shapes (normalizers at the terminal's fetch boundaries), a
session-killing `silentRefresh` race (single-use rotation + concurrent refreshes →
random logouts; now single-flight), register guard stranding cashiers on 409, missing
page h1s (sr-only in shell), unlabeled user-menu/register-form controls. New
`web/e2e/fixtures.ts`: worker-scoped context (rotation-compatible) with self-healing
auth + drain-before-close. Double-claim collision with the Antigravity team arbitrated
by Sri: session E's implementation kept; team's merged foundation fixes retained
(next.config webpackBuildWorker — the real cause of the "build hang" — and the
playwright storageState fix). Vertical-page e2e failures (12) remain deprioritized.

2026-07-04 Codex session H / product variant atomicity (deployment-readiness/product
lifecycle hardening — full findings in `WORK/AUDIT_2026-07-04I.md`): product variant
bulk writes are **Built and verified** for database atomicity and post-commit event
publication. `assignVariants()` and `generateVariants()` now run their multi-row product
changes inside one tenant-scoped transaction; if any child validation or generated SKU
allocation fails, the whole operation rolls back. Product `created`/`updated` events are
deferred until after commit for these bulk operations, fixing the transaction/event
deadlock found during verification when sync handlers tried to open a second DB
transaction while the outer variant transaction was still holding the only test-pool
connection. Verification passed: focused catalog real-Postgres test PASS 31/31, backend
typecheck PASS, smoke PASS 15/15, full backend suite PASS 322/322, frontend
typecheck/lint/test/build PASS. Lint still reports the same 4 pre-existing hook
warnings. The e2e core-flow blocker remains under the active Antigravity lock, so this
session did not touch `web/e2e/**`.

2026-07-04 Codex session G / product catalog variants (parallel non-overlapping
product workflow proof — full findings in `WORK/AUDIT_2026-07-04H.md`): product
creation and master/parent/child variant relationships are **Built and verified** for
the scoped catalog slice. The backend now rejects nested variant graphs, rejects using
a child as a master, rejects making an existing master a child, supports labeled variant
assignment, supports child unlink, and can generate idempotent variant matrices from
attribute groups. The new product page now creates standalone, master, and child
variant products with the backend-supported pricing, catalog, barcode, inventory-rule,
physical, operations, ecommerce, and variant fields instead of a shallow SKU/name/price
payload. Verification passed: backend suite PASS 320/320, backend typecheck PASS,
smoke PASS 15/15, focused frontend tests PASS 12/12, full frontend Vitest PASS 89/89,
frontend typecheck PASS, frontend lint PASS with the same 4 pre-existing hook warnings,
and frontend production build PASS. Remaining product gaps: no searchable parent
picker, no variant-matrix UI, no Playwright e2e proof for master -> child -> variants,
and multi-child variant writes are not yet atomic.

2026-07-04 session F / SEC-9 (parallel non-overlapping backend security hardening —
full findings in `WORK/AUDIT_2026-07-04G.md`, pushed in `a83ed5a`): Redis-backed IP
and tenant rate limiters now use a sorted-set rolling window instead of fixed-window
bucket keys, so clients cannot double-dip across a window boundary. Added focused tests
proving both IP and tenant Redis paths deny the boundary burst and keep stable
non-timestamped Redis keys.
Verification passed: focused rate-limit test PASS 6/6, backend typecheck PASS, smoke
PASS 14/14, full backend suite PASS 315/315, frontend typecheck PASS, frontend lint PASS
with the same 4 pre-existing React hook warnings, and frontend production build PASS.
The local build hang was traced to a corrupted `web/node_modules/js-tokens/package.json`
plus Next's separate webpack build worker idling on Node 24; the local package was
replaced without package-file churn and `web/next.config.mjs` now builds webpack
in-process so `next build` exits deterministically.

2026-07-04 session A (later, three small items — all **Built and verified**, pushed):
(1) **e2e-in-CI milestone**: after the playwright setup storage-state fix (`ac7ed34` —
`storageState: undefined` inherits instead of clearing; ENOENT on fresh checkouts), CI
run 28699188069 completed the FULL suite for the first time ever: **25 passed /
22 failed (12.2m)** — matches the local baseline; the 22 are session E's item #1.
(2) **stripe deploy drift fixed** (`de02f29`): exact-pin `stripe@22.2.2` — deploy.sh
stages fresh `npm install`s that drifted past the pinned apiVersion literal. Deploy
still needs Sri's valid `VERCEL_TOKEN` secret. (3) **/healthz version stamp**
(`68fd40b`): reports `version` (git SHA) + `builtAt`; deploy.sh writes `version.json`
into the staging bundle. Also: git process files (`41c54b2`) — PR template, CODEOWNERS,
AGENTS.md trunk-based workflow with PR-mode cutover; master branch protection enabled
(no force-push/deletion); staged PR-required flip is a Sri-only GitHub setting.

2026-07-04 session A (parallel non-overlapping CI hardening — `.github/workflows/ci.yml`
only): **CI gates are now real.** (1) Backend job gained a `npm run smoke` step —
full POS lifecycle on the service Postgres — **VERIFIED green in CI run 28696807979**.
(2) The e2e job had NEVER completed in its history; six stacked defects fixed: built with
dead `NEXT_PUBLIC_E2E_MODE` flag and mocks ON (Playwright was testing MSW, not the
backend it booted) → now `NEXT_PUBLIC_MOCK=false` + same-origin rewrites; bare `tsx` not
on Actions PATH → `npx tsx`; `npm start` refuses `output:standalone` → runs
`.next/standalone/server.js` with assets copied; wait loops swallowed startup failures →
fail-fast with logs; `npm ci` under job-level `NODE_ENV=production` silently skipped
devDependencies (typescript/tsx) → `--include=dev`; production mode is structurally
impossible on a CI runner (forces DB SSL — service container has none — and Secure-only
cookies over plain HTTP) → backend runs `NODE_ENV=test`, production behavior stays
covered by HTTPS staging/prod smoke tests. Commits `a0c91fd`, `8049ce1`, `c01e609`.
**NEW QUEUE ITEM (found, not fixed — outside claim):** `deploy-prod.yml` fails on every
master push: `src/modules/payments/stripe.ts(15)` pins apiVersion `"2026-05-27.dahlia"`
but fresh installs resolve newer Stripe types expecting `"2026-06-24.dahlia"` — pin the
stripe dependency version or update the literal; also the workflow re-typechecks with
`npm install`-time drift. **BLOCKER at handoff:** GitHub git transport unreachable from
this network (push/fetch time out; web+API fine) — `c01e609` + lock/work-state commits
queued locally, background retry loop armed, lock ACTIVE until push lands.

2026-07-04 session H (parallel non-overlapping backend auth-cookie proof — full
findings in `WORK/AUDIT_2026-07-04F.md`): SEC-7 is **Built and verified**. The actual
Express identity cookie path already sets `sameSite: "lax"` for both `finder_refresh`
and `finder_session_hint`; added route-level regression coverage proving login returns
`finder_refresh` with `HttpOnly`, `SameSite=Lax`, and `Path=/`, while the session hint
remains JavaScript-readable and also uses `SameSite=Lax`. Verification: backend test
runner PASS 313/313, backend typecheck PASS, frontend typecheck/lint/build PASS, smoke
PASS 14/14. Lint still reports the same 4 pre-existing hook warnings.

2026-07-04 session G (parallel non-overlapping frontend API hardening — full findings
in `WORK/AUDIT_2026-07-04E.md`): SEC-8 is **Built and verified**. Catalog CSV export
no longer uses a direct authenticated `fetch()` from `imports-exports/page.tsx`; it now
uses a shared `apiDownload()` helper that attaches the bearer token, handles API error
envelopes, and performs the same one-time silent refresh/retry path as JSON `apiFetch`.
Added API-client tests proving blob downloads include the bearer token and retry after a
401 with a refreshed token. Also verified the stale BUG-1/BUG-2/BUG-3 work-state items
were already fixed before this session: only one `customer-invoices` MSW handler block
exists, and Warehouse/Pricing tab loads already catch errors and clear loading state.
Verification: focused API-client Vitest PASS, full frontend Vitest PASS 86/86, frontend
typecheck/lint/build PASS, backend typecheck PASS, backend tests PASS 312/312. Lint
still reports the same 4 pre-existing hook warnings.

2026-07-04 session F (parallel non-overlapping frontend security hardening — full
findings in `WORK/AUDIT_2026-07-04D.md`): SEC-4 is **Built and verified**. The catalog
print labels modal no longer builds label markup with product fields interpolated into
an HTML string. It now creates label nodes with DOM APIs and assigns product name/SKU/
barcode via `textContent`, closing the stored-XSS path from malicious product data.
Added a regression test with malicious product fields proving no `img`, `script`, or
`svg` nodes are created and print/close still run. Also verified SEC-3 was already fixed
before this session: `web/middleware.ts` already sets the HSTS header. Verification:
focused Vitest PASS, full frontend Vitest PASS 84/84, frontend typecheck PASS, lint PASS
with the same 4 pre-existing hook warnings, production build PASS, backend typecheck
PASS, backend tests PASS 312/312.

2026-07-04 session E part 2 (RLS gap — full findings in `WORK/AUDIT_2026-07-04C.md`):
queue item #4 is **Built and verified**. Instead of hand-editing 489 raw query sites,
the fix is systemic: the gateway's `tenantResolver` now enters an AsyncLocalStorage
tenant scope from the verified JWT, and `shared/db.ts` sets `app.tenant_id` on every
query in that scope — RLS filters every authenticated request to its tenant even when
a query forgets its WHERE clause. RLS policy updated to keep `tenant_id IS NULL`
(global flags) and `tenant_id='system'` (system jobs) rows visible. Also made the 30s
tx statement_timeout real (SET LOCAL previously ran before BEGIN — a no-op since day
one). New cross-tenant regression test (`src/gateway/tenant-isolation.test.ts`) proves
the backstop via a non-superuser role: leaky query returns 0 cross-tenant rows, forged
INSERT rejected. NOTE: production must run the app as a non-superuser DB role or RLS
is inert. Strict flip (deny-when-unset) deferred — needs BYPASSRLS login-role split +
e2e green. Gates: tsc 0 errors, smoke 14/14, probe 22/22, full backend suite green.

2026-07-04 session E (parallel non-overlapping mock-only endpoints — full findings in
`WORK/AUDIT_2026-07-04B.md`): queue item #3 is **Built and verified**. All ~14 mock-only
endpoints now exist on the real backend against real Postgres tables: inventory
transfers (new `inventory_transfers` table + GET/POST), location-level adjustments
(mode-aware add/remove/set), team invite + detail (`users.name` column added), workflow
templates catalog + install, AR-aging dunning sweep, and the full Vendor-360 family
(6 GET routes with computed KPIs from PO/bill/credit history). Also fixed a pre-existing
bug the live probe exposed: `adjustStock` INSERT referenced a nonexistent `id` column on
`inventory_stock` — every first per-location adjustment would 500 (invisible to unit
tests). Verification: live-Postgres probe 22/22 HTTP checks including stock movement
verified in the DB; `tsc` 0 errors; smoke 14/14; backend `npm test` green. No `web/**`,
e2e specs, ports, or shared DB resources touched — session A owns queue item #1.

2026-07-03 session D (parallel non-overlapping stale Vitest cleanup — full findings in
`WORK/AUDIT_2026-07-03D.md`): queue item #2 is **Built and verified**. Updated only
`web/tests/catalogCart.test.tsx` and `web/tests/reportsDashboard.test.tsx` to match the
current mock catalog and current reports dashboard contract. The old assertions expected
coffee-shop products (`Latte`, `Espresso`, `Pastry`, `Butter Croissant`) and an older
reports layout (`tax`, `net`, `Order status`); the app now serves retail products
(`Spring Water 500ml`, `Orange Juice 1L`, snacks categories) and spec metric cards plus
Products sold / Payment methods tables. Verification: targeted Vitest PASS 12/12,
full frontend Vitest PASS 83/83, frontend `typecheck && lint && build` PASS. Lint still
reports the same 4 pre-existing React hook warnings. No backend code, e2e specs, ports,
or database resources were touched because Claude session A owns queue item #1.

2026-07-03 session C (orchestration/test-runner follow-up — full findings in `WORK/AUDIT_2026-07-03C.md`):
orchestration runtime defect is now **Built and verified** at smoke level. Commit
`54c2c2e` added runtime state tables (`workflow_instances`, `workflow_instance_steps`,
`workflow_events`, `retry_state`, `workflow_locks`, `job_queue`), avoided the existing
business `workflow_steps` table collision, synchronized the command registry from the
actual `CommandBus`, registered the remaining command handlers, and added a smoke
assertion that fails if any workflow instance ends in `failed`. `npm run smoke` now has
14 steps and verifies "orchestration recorded no failed workflow instances." Follow-up
local change: `scripts/test.ts` now runs backend tests with `NODE_ENV=test` and
`FINDER_BACKGROUND_JOBS=false`, preventing orchestration job timers from keeping tests
pending after DB pool cleanup. Backend gate after this change: `npm run typecheck` PASS,
`npm run smoke` PASS, `npm test` PASS 311/311.

Frontend gate: `cd web && npm run typecheck && npm run lint && npm run build` PASS.
Lint still reports 4 pre-existing React hook warnings. `cd web && npm test` still FAILS
8 stale Vitest assertions (`web/tests/catalogCart.test.tsx` 5,
`web/tests/reportsDashboard.test.tsx` 3), matching the known queue item.

Coordination update: `WORK/LOCK.md` is now the required multi-agent claim file. Before
editing code, any AI agent must claim one queue item there, stop on overlapping active
claims, and release the lock only after commit + push. This prevents duplicate work,
dirty-tree overwrites, stale verification, server/port conflicts, and migration/test
failures caused by another active AI session.

2026-07-03 session B (deep verification — full findings in `WORK/AUDIT_2026-07-03B.md`):
live-stack proof DONE on local Postgres 15. Smoke 13/13 green (real POS lifecycle).
Endpoint probe: ~464/484 frontend-declared endpoints exist on the real backend.
**First-ever complete e2e run** (production build, mocks OFF, real backend):
**25 passed / 22 failed** — 10 core-flow failures (checkout/receive/invoice-pay/logout;
partly stale locators) + 12 vertical-page failures (some crash without mocks).
Agent instructions created (`AGENTS.md` repo + workspace; `WORK/RULES.md` = standing
policy). Cleanups: tracked `src/shared/db 2.ts` removed; **ALL agent worktrees removed**
(dirty states preserved as wip salvage commits; 12 salvage branches parked — harvest
inventory in AUDIT_2026-07-03B appendix; note: end-of-day Z-report and inventory
adjustment modal branches are Phase-2 relevant). `NEXT_PUBLIC_MOCK` made env-overridable
(default still "true"). Stale e2e locators fixed (setup + login spec).

**Confirmed defects (priority order — each is one session's work item)**

**Retail-first development queue (new authoritative build order after this documentation
rewrite):**

1. **Business-pack capabilities endpoint**: build read-only `GET /api/v1/capabilities`
   for the current tenant/user from the existing module registry, business profile,
   feature flags, plan/entitlement placeholders, and permissions —
   **DONE 2026-07-04 Codex session K; see `WORK/AUDIT_2026-07-04M.md`.**
2. **Business-type impact preview**: read-only endpoint for setup/settings/demo switcher
   that shows what changes before applying a business type/module change —
   **DONE 2026-07-05 Codex session L; see `WORK/AUDIT_2026-07-05A.md`.**
3. **Retail setup/auth proof**: signup/login/logout/session recovery -> select retail
   -> configure outlet/register/tax/payment/receipt basics against real backend.
4. **Retail catalog/inventory proof**: create retail product -> receive stock -> prove
   inventory movement and product availability.
5. **Retail POS proof**: open register -> search/scan -> add to cart -> tax/discount/
   loyalty where enabled -> pay -> receipt -> inventory decrement.
6. **Retail closeout proof**: close register -> end-of-day report -> audit log.
7. **Retail refund/return proof**: refund or return -> payment/order status -> inventory
   movement -> audit log.
8. **Only after items 1-7 are Built and verified**: deepen wholesale, restaurant,
   mobile/electronics, grocery, ecommerce, and enterprise packs one at a time.

Legacy queue items below remain historical evidence and follow-up context; they do not
override the retail-first order above.

1. **e2e core-flow failures (10/47)**: triage checkout ×3, inventory-receive ×3,
   invoice-pay ×3, logout ×1 — separate stale locators from real integration gaps; fix
   until core specs green against production build + real backend —
   **DONE 2026-07-04 session E; all 13 core specs PASS incl. full cash sale; 6 product
   bugs fixed along the way. See AUDIT_2026-07-04J.md.**
2. **8 stale vitest tests**: `web/tests/catalogCart.test.tsx` (5), `web/tests/reportsDashboard.test.tsx` (3) — **DONE 2026-07-03 session D; full `cd web && npm test` PASS 83/83.**
3. **~14 mock-only endpoints** incl. core `POST /inventory/transfers`, `POST /inventory/adjustments`,
   `POST /team`, `GET /team/:id`, `GET /workflows/templates`, Vendor-360 family (6 routes) —
   **DONE 2026-07-04 session E; live-Postgres probe 22/22, smoke 14/14. See AUDIT_2026-07-04B.md.**
4. **RLS gap**: `withTenant()` adopted in only ~10/46 modules; policy permissive when unset —
   **DONE 2026-07-04 session E (request-scoped tenant context; see AUDIT_2026-07-04C.md).
   Follow-up remains: strict deny-when-unset flip, gated on e2e green + login-role split.**
5. **Mock default flip decision**: production deploy path is now guarded to build with
   `NEXT_PUBLIC_MOCK=false` and refuse mock-mode prod deploys
   (**PARTIAL 2026-07-04 Codex session I; see AUDIT_2026-07-04K.md**). Remaining
   decision: choose a dedicated staging database/deploy target and then decide whether
   the source default in `web/next.config.mjs` should flip from mock-on to real-backend
   by default.
6. **Vertical pages crash without mocks (12 e2e failures)** — deprioritized per RULES.md
   expansion pause; do not fix before items 1–6.

**Blockers:** none.

---

## Enterprise Domain Roadmap (reference — sequencing PAUSED per FORWARD_PLAN Phase 1)

> Full spec: [`docs/ENTERPRISE_DOMAIN_ROADMAP.md`](docs/ENTERPRISE_DOMAIN_ROADMAP.md)

**Design principle:** Build in **dependency order**, not feature order. Do not add isolated features — complete domain-by-domain so every module connects through a consistent data model, RBAC, audit logging, and shared business rules.

### Build sequence

| Priority | Domain | Path | Status |
|---|---|---|---|
| 1 | Sales & Order Management | `/sales` | 🔶 Partial — **next domain** |
| 2 | Customer 360 | `/customers/[id]` upgrade | 🔶 Partial |
| 3 | Supplier 360 | `/vendors/[id]` upgrade | 🔶 Partial |
| 4 | Warehouse Management (WMS) | `/warehouse` | 🔲 Not started |
| 5 | Pricing Engine | `/pricing` | 🔶 Embedded in Products |
| 6 | Promotion Engine | `/promotions` upgrade | 🔶 Basic page |
| 7 | Enterprise Workflow Engine | `/workflows` upgrade | 🔶 Basic page |
| 8 | Notification Center | `/notifications` upgrade | 🔶 Basic page |
| 9 | Document Center | `/documents` | 🔲 Not started |
| 10 | Business Intelligence | `/analytics` | 🔶 Basic dashboards |
| 11 | Automation Engine | `/automations` | 🔶 Basic page |
| 12 | Integration Hub | `/integrations` upgrade | 🔶 Basic page |
| 13 | Analytics & AI | `/ai-insights` | 🔶 Basic page |

### Order lifecycle (immutable — use status transitions only)
`Customer → Cart → Order → Payment → Invoice → Delivery → Return → Refund → Accounting`

### Order status state machine
`Draft → Confirmed → Processing → Packed → Shipped → Delivered → Completed | Returned | Cancelled | Backordered | On Hold`

---

## Enterprise Inventory Pipeline (authoritative)

> Full spec: [`docs/ENTERPRISE_INVENTORY_PIPELINE.md`](docs/ENTERPRISE_INVENTORY_PIPELINE.md)

### Pipeline status flow
`Suggested → Draft PO → Sent to Supplier → Confirmed → Partially Received → Fully Received → Supplier Billed → Cost Verified → Closed`

### Key design rules

| Rule | Detail |
|---|---|
| **Never blind import** | Every EDI/CSV import runs 13 safeguard checks before touching inventory |
| **Price history always** | Every PO receive → insert into `supplier_product_price_history` |
| **Preferred supplier lock** | Never overwrite preferred supplier without explicit approval |
| **Duplicate = hard block** | Duplicate PO number or invoice number = blocked, not warned |
| **Large cost change → approval** | Threshold configurable per tenant; movement held until approved |
| **Reorder formula** | `(Avg Daily Sales × Lead Time) + Safety Stock − Available − Incoming` |
| **Supplier comparison** | Always surface cheapest recent price across all linked suppliers |

### 5 new schema tables
`supplier_product_price_history`, `reorder_suggestions`, `edi_imports`, `edi_import_errors`, `purchase_invoice_matches`

### 3 new pages needed
| Page | Path | Status |
|---|---|---|
| Inventory Pipeline | `/inventory/pipeline` | Not built |
| EDI Imports | `/purchasing/edi-imports` | Not built |
| Error Check Center | `/inventory/errors` | Not built |

---

## Enterprise Product Spec (authoritative)

> Full spec: [`docs/ENTERPRISE_PRODUCT_SPEC.md`](docs/ENTERPRISE_PRODUCT_SPEC.md)

Products are the **central business entity** — every other module references them. The product module is a PIM + Inventory + Supply Chain system, not a CRUD form.

### Key design rules

| Rule | Detail |
|---|---|
| **360° workspace** | Product Detail = tabbed workspace (24 tabs), not a form. Left nav + center content + right KPI panel + sticky action bar |
| **Master → Variant split** | Master holds shared data (name, brand, images, SEO). Variant holds sellable data (SKU, barcode, price, inventory) |
| **Lifecycle state machine** | Draft → Pending Approval → Approved → Published → Selling → Low Stock → Reorder → Discontinued → Archived |
| **Tracking modes** | Per product: No/SKU/Barcode/Serial/Batch/Lot/RFID/IMEI/GTIN/Expiry tracking |
| **Warehouse granularity** | Warehouse → Zone → Aisle → Rack → Shelf → Bin → Pallet (per-location stock) |
| **List view modes** | Collapsed master / Expanded parent-child / Grid / Ecommerce / Inventory / Label |
| **Bulk safety** | Preview before apply, audit log per field, rollback, requires `products.bulk_update` permission |
| **Label printing** | Mixed-type queue, per-product-type templates, 15+ label sizes, USB/BT/Wi-Fi/ZPL/ESC/POS |

### New schema tables (label printing + ecommerce)
`ecommerce_product_settings`, `label_templates`, `product_label_settings`, `label_print_jobs`, `label_print_job_items`, `printers`, `printer_drivers`, `print_logs`

### New RBAC codes
`products.bulk_update`, `ecommerce_products.publish`, `labels.print`, `labels.manage_templates`, `printers.test`

---

## Enterprise UX Spec (authoritative)

> Full spec: [`docs/ENTERPRISE_UX_SPEC.md`](docs/ENTERPRISE_UX_SPEC.md)

### UX rules that apply on every new page/component

| Rule | Detail |
|---|---|
| **Permission-gated nav** | Hide sidebar items if user lacks `[module].view` |
| **Permission-gated buttons** | Wrap all create/edit/delete/approve in `<Can permission="...">` |
| **Page header standard** | Title + description + breadcrumb + gated import/export/create buttons |
| **Detail page tabs** | Use tab pattern from spec §4 (Product, Customer, Outlet, User, Role) |
| **Table requirements** | Search + filters + pagination + bulk actions + export + empty/loading/error states |
| **Form requirements** | Sections + required indicators + inline validation + unsaved-changes guard |
| **Confirmation modal** | Required for: refund, void, delete, archive, disable user, revoke sessions, receive inventory, change permissions |
| **Offline UX** | Terminal shows online/offline badge, last-sync time, pending queue count |
| **Page connections** | Dashboard → detail pages; Orders → Customer; PO → Vendor; etc. Always wire `href` links |
| **RBAC components** | `Can`, `CanAny`, `CanAll`, `PermissionGuard`, `RoleGuard`, `OutletAccessGuard`, `ReadOnlyWrapper` |

---

## Enterprise Architecture (authoritative)

> Full spec: [`docs/ENTERPRISE_ARCHITECTURE.md`](docs/ENTERPRISE_ARCHITECTURE.md)

### Non-negotiable design rules
| Rule | Description |
|---|---|
| **Multi-tenant first** | Every business-owned table must have `tenant_id UUID NOT NULL`. Never query without tenant filter. |
| **Inventory ledger** | Every stock change creates an `inventory_movements` record. No simple qty updates. |
| **Immutable financials** | Orders, payments, refunds: use status changes + adjustment records. Never silent edits. |
| **Offline-first POS** | IndexedDB, sync queue, idempotency keys, device IDs, conflict resolution. |
| **Event-driven** | Key actions emit events (`order.created`, `payment.completed`, `inventory.decreased`, etc.). |

### Schema table inventory (30 tables defined)

| Domain | Tables |
|---|---|
| Identity & Access | `tenants`, `tenant_settings`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_sessions` |
| Organization | `outlets`, `registers`, `cash_drawer_sessions` |
| Catalog | `categories`, `brands`, `products`, `product_variants`, `price_books`, `price_book_items` |
| Inventory Ledger | `inventory_balances`, `inventory_movements`, `stock_transfers`, `stock_transfer_items` |
| Customers | `customer_groups`, `customers` |
| Sales | `orders`, `order_items`, `payment_methods`, `payments`, `refunds` |
| Returns | `returns`, `return_items` |
| Purchasing | `vendors`, `vendor_products`, `purchase_orders`, `purchase_order_items` |
| Taxes/Promos | `tax_rates`, `discounts`, `gift_cards`, `gift_card_transactions` |
| Platform | `audit_logs`, `devices`, `sync_events`, `webhooks`, `webhook_deliveries`, `daily_sales_summary` |

### Build phases
| Phase | Status | Focus |
|---|---|---|
| 1 — Foundation | 🔶 Frontend built, backend mock | tenants, users, roles, outlets, registers, auth, audit_logs |
| 2 — Catalog & Inventory | 🔶 Frontend built, backend mock | products, variants, inventory_balances, inventory_movements |
| 3 — POS Sales | 🔶 Frontend built, backend mock | orders, order_items, payments, tax, discounts |
| 4 — Customers & Loyalty | 🔶 Frontend built, backend mock | customers, customer_groups, gift_cards, loyalty_points |
| 5 — Purchasing | 🔶 Frontend built, backend mock | vendors, purchase_orders, receiving, cost updates |
| 6 — Enterprise Layer | 🔲 Partial frontend | sync_events, devices, webhooks, reports, approval workflows |
| 7 — Scale Layer | 🔲 Not started | Read replicas, queues, analytics warehouse, search, ERP sync |

### Key architecture decisions
- **Stack**: Next.js 14 + TypeScript (frontend) · Express + TypeScript + PostgreSQL (backend, in `src/`)
- **ORM target**: Prisma or Drizzle (currently raw SQL in backend)
- **Auth**: JWT access tokens + refresh token rotation · Argon2 password hashing · MFA for owners
- **Money**: Always integer cents in DB and API, never floats · `formatMoney(cents)` on display
- **Inventory movements**: Every balance change must reference a movement type: `SALE`, `RETURN`, `PURCHASE_RECEIVE`, `TRANSFER_IN/OUT`, `ADJUSTMENT_IN/OUT`, `DAMAGE`, `LOSS`, `COUNT_CORRECTION`
- **Permissions**: 28 granular permission codes across 8 domains (see full spec)

---

## Launch-readiness status

| Area | Status | Notes |
|---|---|---|
| **Authentication** | ✅ Built | Login (368 ln), Signup (174 ln), protected layout, route guard |
| **Terminal / Register** | ✅ Built | Full checkout: barcode scan, cart, tender, receipt, offline queue, card reader screen |
| **Product Catalog** | ✅ Built | List + filters + sort + bulk update + CSV import/export + duplicate + detail page + variants + price book + **20-tab workspace**: General, Variants, Pricing, Inventory, Purchase by Supplier, Sales by Customer, Reorder, Supplier Prices, Suppliers, Expiry, Images, eCommerce, Categories, Sales, Returns, Credits, Invoices, Compliance, Analytics, Audit Log |
| **Inventory** | ✅ Built | Overview, receive stock, counts, serials, expiry, reorder suggestions, locations, transfers (via operations) |
| **Purchasing / POs** | ✅ Built | PO list + tabbed detail (lines, receive, billing, credits), reorder suggestions → PO creation |
| **Orders** | ✅ Built | Order list + status filter |
| **Customers** | ✅ Built | List + customer detail + purchase history + loyalty points |
| **Sales Analytics** | ✅ Built | Sales page, insights, reports suite (8 sub-reports) |
| **Reports** | ✅ Built | Sales, AR aging, P&L, inventory, expiry, sales-by-rep, sales-by-vendor, end-of-day, register closures, time cards |
| **Vendors** | ✅ Built | Vendor list + vendor detail |
| **Purchasing** | ✅ Built | PO list + detail tabs |
| **Loyalty** | ✅ Built | Tiers, member list, rewards management |
| **Gift Cards** | ✅ Built | Issue, balance check, transaction history |
| **Discounts / Promotions** | ✅ Built | Discounts page + catalog promotions page (full CRUD) |
| **Returns** | ✅ Built | Returns page at /returns |
| **Payments** | ✅ Built | Payment list + reconciliation |
| **Quotes** | ✅ Built | Quote builder + convert to order |
| **Service Orders** | ✅ Built | Work order list + status pipeline |
| **Invoicing** | ✅ Built | Customer invoices, line items, status workflow |
| **Workforce** | ✅ Built | Employee list, shift scheduler, time-off requests |
| **Ecommerce** | ✅ Built | Store settings, sync status, channel management |
| **Finance** | ✅ Built | P&L overview, accounts, COA |
| **Accounting** | ✅ Built | Journal entries, reconciliation |
| **Operations** | ✅ Built | Outlet management, register sessions, transfer orders |
| **Shipping** | ✅ Built | Shipment tracking, carrier config |
| **Tax Compliance** | ✅ Built | MSA/PACT reporting, state flavor ban tracking |
| **Team / Roles** | ✅ Built | Employee directory, clock in/out, 10 roles, account status, time entries, 3-tab detail modal |
| **Workflows** | ✅ Built | Automation rules, condition/action builder, step editor |
| **Settings** | ✅ Built | Mega-page: store profile, tax rates, payment modes, loyalty tiers, shipping, security, COA, receipt templates, API keys, currencies |
| **Settings → Permissions** | ✅ Built | Role-based feature toggles (Admin/Manager/Cashier/Warehouse/Read-only) with RBAC PATCH endpoint |
| **Settings → Business Modes** | ✅ Built | Enable/disable verticals (Retail/Restaurant/Golf/B2B/Ecommerce/Kiosk/etc.) — wired to moduleFlags API |
| **Settings → Kiosk Mode** | ✅ Built | Kiosk config: PIN, idle timeout, payment methods, price visibility, portal URL |
| **Settings → B2B Portal** | ✅ Built | B2B config: customer groups with discount %, payment terms, order approval, credit limits |
| **Setup** | ✅ Built | Business profile, modules toggle — sub-pages route to correct Settings section |
| **Integrations** | ✅ Built | App marketplace, connected integrations |
| **Notifications** | ✅ Built | Notification inbox + channel preferences |
| **Audit Log** | ✅ Built | System event log with actor + resource |
| **Imports / Exports** | ✅ Built | CSV/bulk import jobs, export scheduler |
| **Onboarding** | ✅ Built | First-run setup wizard |
| **Tax Compliance** | ✅ Built | PACT Act, MSA reporting, state restrictions |
| **Display** | ✅ Built | Customer-facing display screen |
| **Appointments** | ✅ Built | Appointment scheduler |

### Vertical modules

| Vertical | Status | Pages |
|---|---|---|
| **Restaurant** | ✅ Built | Floor plan, kitchen display, tabs |
| **Automotive** | ✅ Built | Vehicles, work orders |
| **Healthcare** | ✅ Built | Patients, prescriptions, dispense |
| **Hospitality** | ✅ Built | Rooms, charges, settle |
| **Education** | ✅ Built | Students, fees, collect |
| **Entertainment** | ✅ Built | Events, tickets, QR redeem |
| **Manufacturing** | ✅ Built | Production orders, BOM, status |
| **Rental** | ✅ Built | Asset register, contracts, return |
| **Golf** | ✅ Built | Tee sheet, bookings, members, pro-shop — 4 pages + nav wired |

---

## Mock handler coverage

All API routes for built modules have MSW handlers in `web/mocks/mockHandlers.ts`.

Key patterns:
- `V1 = "*/api/v1"` wildcard prefix
- `await lat()` first line in every handler
- IIFE spread pattern: `...(() => { let state; return [...handlers]; })(),`
- Sub-paths registered BEFORE `/:id` to avoid wrong matching

---

## Known bad redirects (quick fixes)

| Route | Currently redirects to | Should redirect to |
|---|---|---|
| `/inventory/returns` | `/vendors` | `/returns` |
| `/setup/loyalty` | `/settings` | `/loyalty` |

---

## Context cliff notes

- Pages: `web/app/(protected)/[module]/page.tsx`
- Mock handlers: `web/mocks/mockHandlers.ts` (NOT lightspeedHandlers.ts)
- Types: `web/api-client/types.ts`
- API client: `web/api-client/client.ts` → `apiGet / apiPost / apiPatch / apiDelete`
- Nav shell: `web/components/EnterpriseShell.tsx` — 3 places to update per new nav item
- Money: `formatMoney(cents)` from `@/lib/money`
- Catalog products in mock: `prod_1`–`prod_8`
- Settings page covers: taxes, payment modes, loyalty tiers, shipping, security, COA, receipts, API keys

---

## Next targets (priority order for launch)

1. **Golf vertical** ✅ DONE — 4 pages + nav wired; `module: "golf"` → `module: "tee_sheet"` fixed
2. **FE-R4: Restaurant Dashboard** ✅ DONE — `/restaurant/dashboard` with KPIs, hourly chart, top items, active sessions (2026-07-01)
3. **UX-2: Module marketplace** ✅ DONE — `/setup/modules` page already complete
4. **UX-3: Vertical dashboard widgets** ✅ DONE — `VerticalWidgets.tsx` already complete
5. **Split oversized pages** — reports/page.tsx ✅ DONE (866→246 ln); next: customers/page.tsx (810 ln), dashboard (803 ln), discounts (765 ln)
6. **Settings page split** ✅ DONE — CoaSection, DepositsSection, LoyaltyTiersSection extracted (2026-07-01)

---

## Enterprise Guardian — Last Audit

> Run: 2026-06-30 (post customers/[id] split)  |  Score: 94/100  |  Status: ✅ LAUNCH-READY (≥88, zero CRITICAL)
> Prior score: 93/100 → +1 pt (customers/[id] split 1705→441 ln, 9 extracted _components files, zero TS errors)

### Domain Scores

| Domain | Score | Grade | Top Finding |
|---|---|---|---|
| TypeScript strictness | 100/100 | ✅ | Zero `error TS`, zero unguarded `any` in production code |
| Security | 98/100 | ✅ | Zero secrets, no XSS, no dangerouslySetInnerHTML |
| API contract | 92/100 | ✅ | All FE-51/FE-52 handlers correct; `await lat()` on all |
| Component quality | 88/100 | ✅ | customers/[id] split (1705→441 ln); catalog (1498) next |
| Accessibility | 95/100 | ✅ | `role="alert"` on all errors; icon buttons labeled |
| Performance | 89/100 | ✅ | 2 page splits done; catalog (1498), inventory (1229), purchasing still >800 ln |
| Design system | 86/100 | ✅ | `web/lib/date.ts` created; 5 import sites fixed; formatMoney + border-slate-200 done |
| Nav/routing | 97/100 | ✅ | All stubs verified valid; no bad redirects remaining |

### CRITICAL (blocks launch — fix first)

_None. TypeScript clean, security clean, all stubs point to real files._

### HIGH (degrading enterprise readiness)

_None._

### MEDIUM (tech debt — fix before v2)

- [x] **Design system — local date helpers** — ✅ DONE: `web/lib/date.ts` created with `fmtDate`, `fmtDateShort`, `fmtDateTime`, `fmtTime`; 5 import sites fixed (payments, appointments, imports-exports, inventory/counts, inventory/serials). Remaining pages (insights, ecommerce, purchasing, quotes, workforce) still have local definitions — audit these next.

- [x] **Design system — date helpers migration** — ✅ DONE: all 44 raw `new Date(x).toLocale*()` calls across 26 files replaced with `fmtDate`/`fmtTime`/`fmtDateTime` from `@/lib/date`. 3 custom-format sites kept intentionally (weekday header, 2-digit year, appointment picker). Zero TS errors. Commit `46e1a89`.

- [ ] **Design system — money in form inputs** — `(cents / 100).toFixed(2)` used to seed edit-form inputs in `catalog/page.tsx` (ln 94, 98, 99, 843–845), `customers/[id]/page.tsx` (ln 680, 699), `accounting/page.tsx` (ln 336). Correct for edit inputs (need dollar string), but comment-document why to avoid false audit flags.

- [ ] **Page size — split required** — pages exceeding 800-line threshold:
  - `settings/page.tsx` — ✅ DONE: 1818→644 ln (CoaSection, DepositsSection, LoyaltyTiersSection extracted)
  - `customers/[id]/page.tsx` — ✅ DONE: 1705→441 ln, 9 files in `customers/[id]/_components/`
  - `reports/page.tsx` — ✅ DONE: 866→246 ln (4 section files + reportHelpers.tsx)
  - `customers/page.tsx` — 810 ln — next split candidate
  - `dashboard/page.tsx` — 803 ln — next split candidate

### LOW (polish — backlog)

- [ ] `web/lib/offlineOutbox.ts` — IDB typing `(req.result as T[]).sort((a: any, b: any)...)` — use `IDBRequest<T[]>`.
- [ ] `web/lib/offlineOutbox.ts:176` — `(registration as any).sync.register(...)` — add ambient `BackgroundSyncManager` type.
- [ ] 9 stub pages report "no loading state" — these are pure re-exports with zero async work; false positive for that check. No action needed.

### Next session must-do (Claude's priority queue)

Score: 94/100 — launch-ready, zero CRITICAL.

#### Catalog detail page — DONE (2026-07-01)

| # | What | Status |
|---|---|---|
| 1 | Stock by location (`GET /catalog/:id/stock`) | ✅ DONE — InventoryTab StockByLocation panel, on-hand/committed/available/avg-cost |
| 2 | Richer expiry (`/catalog/:id/expiry`) | ✅ DONE — ExpiryTab rewritten: 4-tier status, lot_code, location, notes, pre-computed days |
| 3 | Compliance endpoint (`PATCH /catalog/:id/compliance`) | ✅ DONE — already wired in MarketingTab |
| 4 | Hidden fields (tags, dims, ecommerce, vendor_upc) | ✅ DONE — all present in GeneralTab/InventoryTab |
| 5 | Live margin calculator | ✅ DONE — already in GeneralTab price table |
| 6 | Tab badges (expiry alert count) | ✅ DONE — red pill on Expiry tab when expired/critical batches |
| 7 | Margin + price on product header | ✅ DONE — price pill + colour-coded margin % in header |
| 8 | Barcode test button | ✅ DONE — in Actions menu, 3s inline pass/fail result |

#### Page splits still pending
- `customers/page.tsx` — 810 ln — extract filter bar, table, customer detail drawer
- `dashboard/page.tsx` — 803 ln — extract KPI section, top products, payment breakdown
- `discounts/page.tsx` — 765 ln — extract discount form, promotions section

**Done this session (2026-07-01, page splits):**
- workflows, terminal, quotes, operations, workforce, receive-stock, insights all split (7 pages)
- insights: 515→55 ln; ScheduledReportsTab + ForecastingTab + insightsTypes extracted; commit `aba0197`

**Done this session (2026-07-01, continued):**
- Date migration: 44 raw `toLocale*()` calls across 26 files → `fmtDate`/`fmtTime`/`fmtDateTime`; 3 custom formats intentionally kept; zero TS errors; commit `46e1a89`

**Done this session (2026-07-01):**
- Settings page split: CoaSection + DepositsSection + LoyaltyTiersSection → `_components/` (1003→644 ln)
- FE-R4 Restaurant Dashboard: `/restaurant/dashboard` — covers, avg ticket, table turns, peak hour, hourly revenue chart, top items, active sessions
- reports/page.tsx split: 4 sections → `_components/` (866→246 ln); shared helpers in reportHelpers.tsx
- catalog/[id]/page.tsx restructured: 3-tab editor (General | Inventory | Marketing) — 763→136 ln; GeneralTab (price table w/ markup/margin), InventoryTab (supplier, replenish, variants), MarketingTab (loyalty, compliance)

---

## Full-Stack Audit — 2026-07-02

> Audited by: Claude Sonnet 4.6 | Commit at audit time: `efefd76`
> Scope: 129 pages · 465 API handlers · auth · security headers · offline · notifications · RBAC · error handling

---

### SECURITY

#### ✅ PASSING

| Area | Detail |
|---|---|
| **Auth guard (frontend)** | `middleware.ts` checks `finder_session_hint` cookie on every protected route; redirects to `/login?next=<path>` if absent |
| **Auth guard (React)** | `(protected)/layout.tsx` reads `useAuth().status`; renders null + redirects on `"unauthenticated"` — double layer |
| **JWT verification (backend)** | `gateway/auth.ts` — `jsonwebtoken.verify()` on every request; rejects missing or invalid Bearer tokens with HTTP 401 |
| **httpOnly refresh token** | `finder_refresh` cookie is httpOnly (JS-unreadable); `finder_session_hint` is non-httpOnly hint only — actual auth secret never exposed to JS |
| **Token refresh race protection** | `_refreshPromise` singleton in `api-client/client.ts` prevents concurrent refreshes (lines 40, 90–95) |
| **Rate limiting** | `src/gateway/rateLimit.ts` — IP-based token-bucket (60 req burst / 20 RPS sustained); Redis-backed in prod (Lua atomic script prevents TOCTOU); per-tenant tiered limiter (standard/premium/enterprise) |
| **CORS** | Allowlist-based; defaults to `finder-pos.vercel.app` + `finder-pos-web.vercel.app` in prod; configurable via `ALLOWED_ORIGINS` env var; dev-only wildcard |
| **Security headers (frontend)** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo disabled) |
| **CSP** | Restrictive in prod: `script-src 'self' 'unsafe-inline'`; `connect-src` limited to self + `NEXT_PUBLIC_API_BASE_URL`; `frame-ancestors 'none'` |
| **SQL injection** | All queries use `@named` / `?` placeholder compilation (`src/shared/db.ts` `compile()`); no raw string interpolation found in service layer |
| **Tenant isolation** | `db.withTenant(tenantId)` sets Postgres `app.tenant_id` config per transaction; RLS policies enforce at DB layer; every query in `custom_roles/service.ts` scopes to `tenant_id` |
| **Parameterized secrets check** | No hardcoded API keys, tokens, or passwords found in `web/app/` source code |
| **Helmet (backend)** | `helmet` imported and applied in `src/app.ts` — adds baseline HTTP security headers on backend |
| **No XSS via React** | Zero `dangerouslySetInnerHTML` in any page component; React escapes all interpolated values |
| **Offline outbox** | IndexedDB (not localStorage); carries idempotency key on every queued checkout for safe replay |
| **SSE notifications** | `useNotifications()` uses `EventSource` (not polling); per-tenant broker in `src/shared/sse.ts`; 25s heartbeat keeps proxies alive; cleanup on `close`/`error` |
| **gitignore** | `.env`, `node_modules/`, `dist/`, `.vercel`, `*.db` all ignored |
| **No competitor brand names** | Zero references found in source tree |

---

#### 🔴 CRITICAL — Must Fix Before Production

| ID | File | Issue | Risk |
|---|---|---|---|
| **SEC-1** | `.env` (repo root) | A `VERCEL_TOKEN` is stored in `.env` which IS in `.gitignore` but the file EXISTS on disk. If the repo is ever archived, zipped, or deployed via `git archive`, this token leaks. **Rotate this token immediately via the Vercel dashboard.** | Token compromise → unauthorized deploys |
| **SEC-2** | `web/middleware.ts:54` | CSP uses `'unsafe-eval'` in development. If the dev build is ever accidentally deployed to staging/prod (e.g., via `NODE_ENV` misconfiguration), eval-based XSS becomes possible. Should be `NODE_ENV === "production"` guard verified at deploy time, not runtime. | XSS if wrong build deployed |
| **SEC-3** | `web/middleware.ts` | **RESOLVED before 2026-07-04 session F** — middleware already sets `Strict-Transport-Security: max-age=31536000; includeSubDomains`. | Former HTTPS downgrade risk |

---

#### 🟠 HIGH — Fix Before Launch

| ID | File | Issue | Risk |
|---|---|---|---|
| **SEC-4** | `web/app/(protected)/catalog/_components/PrintLabelsModal.tsx` | **DONE 2026-07-04 session F** — label print document now creates DOM nodes and assigns product fields through `textContent`; malicious product-field regression test added. | Former stored XSS via product data |
| **SEC-5** | `web/middleware.ts` | `middleware.ts` allows `/api` path prefix through without auth check (line: `"/api"` in `PUBLIC_PATH_PREFIXES`). This is correct for MSW in dev, but means all Next.js API routes (`/api/*`) are publicly accessible. If any server-side API routes are added under `web/app/api/`, they must implement their own auth. Currently no real API routes exist there, but this is a silent footgun. | Future API routes exposed |
| **SEC-6** | `src/app.ts` | CORS uses `isDev = process.env.NODE_ENV !== "production"` — any non-production NODE_ENV value (e.g., `"staging"`, `"test"`) opens CORS to all origins. Should be `isDev = process.env.NODE_ENV === "development"` for safety. | CORS bypass in staging |

---

#### 🟡 MEDIUM — Tech Debt

| ID | Issue |
|---|---|
| **SEC-7** | **DONE 2026-07-04 session H** — route-level backend test proves login sets `finder_refresh` with `HttpOnly`, `SameSite=Lax`, and `Path=/`; session hint also uses `SameSite=Lax`. |
| **SEC-8** | **DONE 2026-07-04 session G** — catalog CSV export now uses `apiDownload()` from the shared API client, including bearer auth, API error envelopes, and one-time 401 silent-refresh retry. |
| **SEC-9** | **DONE 2026-07-04 session F** — Redis-backed IP and tenant limiters now use rolling sorted-set windows with regression tests proving no fixed-boundary double-dip. |
| **SEC-10** | Password reset and signup pages have no client-side rate limiting UI feedback. Backend rate limits, but UX shows no "too many attempts" state — users retry excessively. |

---

### BUGS

#### 🔴 CONFIRMED BUGS

| ID | File | Bug | Impact |
|---|---|---|---|
| **BUG-1** | `web/mocks/mockHandlers.ts:4244 + 5517` | **Duplicate `customer-invoices` handlers** — `GET /customer-invoices`, `GET /customer-invoices/:id`, `POST /customer-invoices`, `PATCH /customer-invoices/:id/status`, `GET /customer-invoices/lookup-upc` all registered **twice** (10 duplicate registrations total). MSW matches the FIRST handler; the second block (lines 5517–5587) is dead code. The second block may have different seed data — silently wrong data if someone edits it thinking it's live. | Wrong/stale mock data; confusing to maintain |
| **BUG-2** | `web/app/(protected)/warehouse/page.tsx` | All 6 tab data-fetch calls (`apiGet(...).then(...)`) have **no `.catch()`**. If any endpoint returns an error, the `loading` state stays `true` forever — the tab shows infinite skeleton. Pages freeze with no user-visible error. | Infinite loading on API failure |
| **BUG-3** | `web/app/(protected)/pricing/page.tsx` | Same as BUG-2 — all 5 tab fetches (`PriceBooksTab`, `TierPricingTab`, etc.) use `.then()` with no `.catch()`. Error state `setError` is defined in some tabs (`ContractPricesTab`) but not all. `PriceBooksTab` and `TierPricingTab` have no error state at all — failures silently set `loading=false` with empty data. | Silent empty UI on error |
| **BUG-4** | `web/app/(protected)/inventory/transfers/page.tsx` | **1-line stub** — `export { default } from "../../operations/page"`. The `/inventory/transfers` route renders the full Operations page, not a transfers page. Users navigating to "Transfers" from inventory sub-nav land on the wrong page. | Confusing UX — wrong page shown |
| **BUG-5** | `web/mocks/mockHandlers.ts` | `GET /orders` handler filters by status but the seed orders (`ord_s_1`–`ord_s_6`) are defined inside the IIFE that also creates `termOrders`. If the orders page filter is used before the IIFE runs (race), 0 orders return. In practice no race, but the handler at line 3851 filters `termOrders` which may not include the 6 seed orders if they were added to a different array. Needs cross-check. | Potential empty orders list |
| **BUG-6** | Multiple stub pages (see list below) | **36 pages are 1-line re-exports** pointing to other modules. Some are intentional (setup/* → settings), but others (finance/bills, finance/payment-made, ecommerce/customers, ecommerce/orders, etc.) render the wrong parent page. Users who bookmark or navigate directly to these URLs see unexpected content. | Confusing UX; SEO/link confusion |

**Stub pages that render wrong content (not intentional aliases):**
`/inventory/count` → operations, `/finance/bills` → finance, `/finance/payment-made` → finance, `/finance/settings` → finance, `/ecommerce/customers` → ecommerce, `/ecommerce/products` → ecommerce, `/ecommerce/shipping` → ecommerce, `/ecommerce/promotions` → ecommerce, `/ecommerce/orders` → ecommerce, `/ecommerce/categories` → ecommerce, `/catalog/gift-cards` → gift-cards, `/catalog/products` → catalog, `/catalog/suppliers` → vendors

---

#### 🟡 MEDIUM BUGS

| ID | File | Bug |
|---|---|---|
| **BUG-7** | `web/app/(protected)/customers/[id]/_components/OrdersTab.tsx:42` | Fetches `GET /orders?limit=200` and client-filters by `customerId`. If a customer has >200 orders, earlier ones are silently dropped. No pagination or "showing N of M" indicator. |
| **BUG-8** | `web/app/(protected)/pricing/page.tsx` (SimulatorTab) | `SimulatorTab` `runSim()` is not wrapped in try/catch. If the API call fails, `loading` stays `true` and the button shows "Resolving…" indefinitely. |
| **BUG-9** | `web/lib/offlineOutbox.ts` | IDB sort uses `(req.result as T[]).sort((a: any, b: any) => ...)` — `any` cast bypasses type safety. If IDB returns non-array (corrupt store), this throws uncaught runtime error. |
| **BUG-10** | `web/lib/offlineOutbox.ts:176` | `(registration as any).sync.register("checkout-replay")` — Background Sync API is typed `as any`, so TypeScript won't catch breaking changes. Also: no fallback check whether Background Sync is actually supported before calling. |

---

### API ENDPOINT COVERAGE

#### Summary
- **Total mock handlers:** 465 routes across `mockHandlers.ts` (7,475 lines)
- **All routes use `await lat()`** — simulated latency on every handler ✅
- **`/api` prefix passthrough** — all real API calls go to `NEXT_PUBLIC_API_BASE_URL`; MSW intercepts `*/api/v1/*` in dev/test ✅

#### Endpoints by domain

| Domain | Count | Notes |
|---|---|---|
| Catalog / Products | ~45 | Full CRUD + variants, batches, expiry, pricing, suppliers, images, analytics, audit |
| Orders | ~12 | Create, list, get, refund, void, email-receipt, timeline, split, kitchen-course |
| Payments | 3 | Create payment, register open/close sessions |
| Customers | ~15 | CRUD, loyalty tier, product prices, adjustments |
| Customer Invoices | 5 (×2 duplicate — BUG-1) | lookup-upc, list, get, create, status patch |
| Purchasing / POs | ~10 | PO CRUD, receive, billing, credits |
| Vendors | ~10 | List, detail, products, POs, invoices, credits, receiving |
| Inventory | ~20 | Serials, reorder, counts, count lines, batches, store-locations, product-locations |
| Inventory Pipeline | 9 | Overview, pending, receiving, reorder, issues (patch), history |
| WMS (Warehouse) | 6 | Dashboard, locations, receiving, putaway, picks, cycle-counts |
| Pricing Engine | 6 | Price books, tier rules, contracts, scheduled, margin rules, simulate |
| EDI Imports | 7 | Queue, upload, validate, process, history, errors, partner config |
| Fulfillment | 7 | Locations, assign, pick-lists CRUD, pack |
| Sales (quotes/orders) | ~12 | Quotations CRUD + workflow, sales orders CRUD + approve/assign/invoice/cancel |
| Accounting | ~10 | Accounts, COA tree, journal entries, reconciliation |
| Team / Roles | ~10 | CRUD, clock-in/out, time entries, custom roles, assign |
| Workforce | ~8 | Employees, shifts, time-off |
| Loyalty | ~10 | Tiers, members, rewards CRUD, adjustments |
| Notifications | 4 | List, mark-read, mark-all-read, create |
| Audit Log | 1 | List with filters |
| Workflows | 7 | CRUD + steps CRUD |
| Golf | ~12 | Tee sheet, bookings, members, pro-shop |
| Restaurant | ~10 | Dashboard, tables, tabs, kitchen queue |
| Automotive | 5 | Work orders, vehicles CRUD |
| Healthcare | 5 | Patients CRUD, dispense |
| Hospitality | 6 | Rooms, charges, settle |
| Education | 6 | Students CRUD, fees, collect |
| Entertainment | 5 | Events, tickets, redeem |
| Manufacturing | 4 | Orders CRUD + status |
| Rental | 5 | Assets, contracts, return |
| Appointments | 2 | List, create |
| Shipping / Ecommerce | 3 | Webhooks CRUD |
| Sync | 3 | Status, queue, push |
| Service Orders | ~5 | CRUD + status patch |
| Promotions | ~5 | CRUD |
| Reports / Insights | ~5 | Sales reps + performance, scheduled reports |
| SSE Stream | 1 | `/api/v1/stream` — MSW mock returns empty stream |

#### Missing mock handlers (FE calls with no handler → 404 in dev)
| Route | Used by |
|---|---|
| `GET /api/v1/customers/:id/orders` | `OrdersTab.tsx` workarounds with `GET /orders?limit=200` — no dedicated endpoint |
| `GET /api/v1/pricing/simulate` | Added by this session ✅ |
| `GET /api/v1/warehouse/*` | Added by this session ✅ |
| `GET /api/v1/catalog/:id/comms` | No communications/comms tab yet |
| `GET /api/v1/customers/:id/comms` | Customer 360 Comms tab not built |

---

### FIREWALLS & NETWORK SECURITY

| Layer | Status | Detail |
|---|---|---|
| **Frontend middleware** | ✅ | Next.js middleware guards all non-`/api` routes; redirects unauthenticated → `/login` |
| **Backend JWT gate** | ✅ | `makeAuthMiddleware()` runs before every route in `src/app.ts`; 401 on invalid/missing token |
| **IP rate limiter** | ✅ | 60 burst / 20 RPS per IP; Redis-backed in prod (atomic Lua); in-memory fallback in dev |
| **Tenant rate limiter** | ✅ | Per-tenant tiered limits (standard/premium/enterprise); runs after auth so tenantId is known |
| **CORS allowlist** | ✅ | Hardcoded Vercel origins in prod; `ALLOWED_ORIGINS` env override; dev-only wildcard |
| **CSP** | ⚠️ | `unsafe-inline` for scripts/styles (required by Next.js without nonce); `unsafe-eval` in dev (SEC-2) |
| **HSTS** | 🔴 | **Missing** — no `Strict-Transport-Security` header in frontend middleware (SEC-3) |
| **XFF IP spoofing** | ✅ | `extractClientIp()` uses rightmost-N strategy based on `TRUST_PROXY_DEPTH`; prevents spoofed `X-Forwarded-For` bypassing rate limits |
| **Helmet** | ✅ | Applied in backend Express app — `X-Powered-By` removed, HSTS set for HTTPS responses |
| **Clickjacking** | ✅ | `X-Frame-Options: DENY` + `frame-ancestors 'none'` in CSP |
| **MIME sniffing** | ✅ | `X-Content-Type-Options: nosniff` |
| **Permissions policy** | ✅ | Camera, microphone, geolocation disabled; payment limited to self |

---

### FALLBACKS & SAFEGUARDS

| Area | Status | Detail |
|---|---|---|
| **Offline checkout** | ✅ | `offlineOutbox.ts` — IndexedDB queue, idempotency keys, Background Sync replay, manual retry fallback |
| **Token refresh** | ✅ | `apiFetch` retries once after 401 via `silentRefresh()`; clears session + redirects on failure |
| **Loading skeletons** | ✅ | All major pages show skeleton loaders (`animate-pulse`) during fetch |
| **Error state display** | ⚠️ | `/warehouse` and `/pricing` tab components have no `.catch()` — freeze on error (BUG-2, BUG-3) |
| **Empty states** | ✅ | All tables have explicit empty-state messages |
| **Confirmation modals** | ✅ | Void, refund, delete, archive all require confirm modal with explicit warning copy |
| **`safeLoad()` wrapper** | ✅ | `api-client/client.ts` — catches unhandled rejections; used in settings, catalog, customers |
| **Environment variable fail-fast** | ✅ | `buildApp()` throws on missing `JWT_SECRET` / `DATABASE_URL` in production before serving |
| **Redis fail-open** | ✅ | Rate limiter Redis path catches errors and calls `next()` — Redis outage doesn't block traffic |
| **SSE reconnect** | ⚠️ | `useNotifications.ts` uses `EventSource` which auto-reconnects; however, there is no max-retry or exponential backoff — on network partition it retries indefinitely at browser default interval (~3s), potentially flooding the server |
| **DB connection pooling** | ✅ | `pg.Pool` with `poolStats()` health check; transactions scoped with `withTenant()` and `withRequestId()` |
| **BIGINT parse** | ✅ | `types.setTypeParser(20, ...)` prevents silent precision loss on int8 values |
| **Order immutability** | ✅ | Orders use status transitions + `order_events` timeline; no in-place edits |
| **Inventory ledger** | ✅ | Every stock change must create an `inventory_movements` record (enforced in architecture spec) |
| **Audit log** | ✅ | `/audit-log` page wired; `audit_logs` table in schema |

---

### NOTIFICATIONS

| Feature | Status | Detail |
|---|---|---|
| **Delivery mechanism** | ✅ SSE | `useNotifications()` opens `EventSource('/api/v1/stream')`; real-time push from backend |
| **Backend broker** | ✅ | `SseBroker` in `src/shared/sse.ts`; per-tenant fan-out; 25s heartbeat; cleanup on disconnect |
| **Redis pub/sub** | ✅ | Cross-instance fan-out via `finder:events` Redis channel (multi-replica safe) |
| **Notification bell** | ✅ | `NotificationBell.tsx`; unread count badge; mark-all-read; dismiss per item |
| **Notification page** | ✅ | `/notifications` — full list, filter (all/unread), severity badges (info/warning/critical) |
| **Event types handled** | ✅ | `order_created`, `payment_captured`, `low_stock`, `tier_upgraded` |
| **Missing event types** | ⚠️ | No handlers for: `sync_error`, `purchase_order_received`, `new_order`, `order_fulfilled`, `payment_failed` — these exist in `NotificationType` enum but `buildNotification()` returns `null` (drops them silently) |
| **In-app toast** | ⚠️ | No toast/snackbar system — notifications only appear in the bell dropdown; high-priority alerts (payment failed, low stock critical) have no immediate visual pop |
| **Email/SMS** | ⚠️ | Architecture specifies email/SMS/push channels; only in-app is wired; `SENDGRID_API_KEY` warned-but-optional in `buildApp()` |
| **Notification preferences** | ✅ | `/notifications` page has channel preference UI (per-type toggles) |
| **SSE reconnect gap** | ⚠️ | If SSE connection drops, notifications between disconnect and reconnect are lost (no catch-up query on reconnect) — should `GET /notifications?since=<lastTs>` on reconnect |

---

### DOMAIN ROADMAP STATUS (updated)

| Priority | Domain | Path | Status |
|---|---|---|---|
| 1 | Sales & Order Management | `/orders`, `/orders/[id]` | ✅ Built (order list + detail + timeline) |
| 2 | Customer 360 | `/customers/[id]` | ✅ Built (8 tabs incl. Orders tab) |
| 3 | Supplier 360 | `/vendors/[id]` | ✅ Built (6 tabs) |
| 4 | Warehouse Management (WMS) | `/warehouse` | ✅ Built (6 tabs: Dashboard, Locations, Receiving, Putaway, Picks, Cycle Counts) |
| 5 | Pricing Engine | `/pricing` | ✅ Built (6 tabs: Price Books, Tier, Contracts, Scheduled, Margin Rules, Simulator) |
| 6 | Promotion Engine | `/promotions`, `/discounts` | 🔶 Basic page — needs upgrade |
| 7 | Enterprise Workflow Engine | `/workflows` | 🔶 Basic page — needs approval chain |
| 8 | Notification Center | `/notifications` | 🔶 In-app only — missing toast, email/SMS, catch-up on reconnect |
| 9 | Document Center | `/documents` | 🔲 Not started |
| 10 | Business Intelligence | `/analytics` | 🔶 Basic dashboards |
| 11 | Automation Engine | `/automations` | 🔶 Basic page |
| 12 | Integration Hub | `/integrations` | 🔶 Basic page |
| 13 | Analytics & AI | `/ai-insights` | 🔶 Basic page |

---

### NEXT PRIORITY QUEUE (post-audit)

#### Immediate fixes (before any new features)

1. **SEC-1** — Rotate the Vercel token in `.env` immediately
2. **SEC-10** — Add user-visible client-side rate-limit feedback to password reset/signup

#### Next domain build

6. **Domain 6: Promotion Engine** — `/promotions` full upgrade (coupon types, stacking rules, campaign builder)
7. **Domain 7: Workflow Engine** — configurable approval chain for price changes, refunds, inventory adjustments
8. **Notification gaps** — add toast system, add `sync_error`/`payment_failed` event handlers, SSE catch-up on reconnect
