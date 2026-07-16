# Audit — mock-vs-real route drift: 3 modules 404 in prod (session D, loop iter 3)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop iter 3)
Branch: `feat/delivery-pipeline`
Files: `src/modules/{customer_invoices,service_orders,product_batches}/index.ts`;
NEW `src/modules/customer_invoices/{route-mount.test.ts,test-request.ts}`

## Finding (drift sweep)

Ran the backlog's mock-vs-real drift sweep: diffed every web `apiGet/apiPost`
path against the real backend mounts. Of 16 candidate mismatches, most were
legitimate (hyphenated module `name` fields, store_locations mountPath
aliases, documented Preview verticals, a JSDoc example). THREE were real
production 404s:

- `customer_invoices`, `service_orders`, `product_batches` register their
  routes as top-level hyphenated resources (`router.get("/customer-invoices",
  …)`) — the store_locations convention — but shipped WITHOUT `mountPath`.
  The default `/api/v1/<underscore_name>` prefix produced dead paths like
  `/api/v1/customer_invoices/customer-invoices`. The web client + MSW mocks
  (5-6 handlers each) call the hyphenated top-level paths, so these pages
  worked in dev and 404'd in production. Same class as the movements drift
  (iter 1) and store_locations fix (ae79907).

## What was done

- Added `mountPath: "/api/v1"` to all three modules (mirrors store_locations).
  `name` left unchanged so migration tracking is unaffected. Purely additive
  routing fix.
- NEW route-mount.test.ts: asserts the hyphenated client-facing paths resolve
  on the real assembled app (not 404), and that the old underscore mount does
  NOT resolve (fails loudly if someone reverts). First tests for these
  modules.

## Incidental hygiene (unblock only)

Local typecheck was broken by 51 gitignored, untracked `* 2.<ext>` collision-
backup duplicates (macOS copy artifacts from a messy concurrent checkout —
exactly what the b257f9a CI guard + AGENTS.md prohibit). Removed them from the
working tree (all verified gitignored + untracked + not in any LOCK claim;
zero effect on git history or CI). The canonical files were untouched.

## Delivery standard

- **Architecture impact**: none; enforces the top-level-resource mount
  convention already used by store_locations.
- **Database impact**: none (name unchanged → migrations unaffected).
- **Testing evidence**: route-mount 2/2; shipping delivery-pipeline 15/15
  isolated (the 1 failure seen in a multi-file run was the documented
  PG_POOL_MAX=1 parallel flake — green alone). Typecheck CLEAN after junk
  removal. Smoke 20/20.
- **Security impact**: none; routes were already auth+tenant scoped, just
  unreachable.
- **Rollback**: revert commit (routing-only).
- **Monitoring**: none new. Remaining drift-sweep candidates (all benign:
  golf/pricing/warehouse/documents Preview verticals) recorded as
  not-a-bug in LOOP_STATE backlog.
