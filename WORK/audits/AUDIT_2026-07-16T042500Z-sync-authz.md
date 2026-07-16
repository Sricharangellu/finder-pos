# Audit — sync mutation authorization gap (session D, loop iter 6)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop iter 6)
Branch: `feat/delivery-pipeline`
Files: `src/modules/sync/routes.ts` + `sync.test.ts` (1 new authz test)

## Finding (verified)

Backlog item "requirePermission on sync/webhook mutation routes (verify
first)". Verification split the candidate:
- **webhooks module: already correctly guarded** — every mutation uses
  `requireRole("owner")` (webhooks/routes.ts). No gap. The "verify first"
  caution was warranted.
- **sync module: NO guards on any mutation.** Every `router.post` in
  sync/routes.ts — `/online` (toggle company-wide sync engine), `/push`
  (force-drain the queue), `/pull` (stub), `/integrations` (connect/configure
  a third-party integration, settings may hold credentials) — was reachable
  by ANY authenticated user, including a cashier. The rest of the codebase
  gates mutations behind requireRole; sync was missed.

## What was done

- `/online`, `/push`, `/pull` → `requireRole("manager")` (operational sync
  control; owner passes via the cashier<manager<owner hierarchy).
- `POST /integrations` → `requireRole("owner")`, matching the webhooks
  module's external-config precedent (integration settings can carry
  credentials).
- Reads (`/status`, `/queue`, `/import-batches`, providers, integrations GET)
  left open to any authenticated tenant user — unchanged.

## Delivery standard

- **Architecture impact**: none; applies the standard requireRole mutation
  gate. gateway/auth.ts only imported (not edited — it is session C's claim).
- **Database impact**: none.
- **Testing evidence**: 1 new authz test — cashier 403 on
  online/push/pull/integrations, manager 403 on integrations (owner-only),
  manager 200 on /online, cashier 200 on read. 8 existing sync tests still
  green (they run as owner via the shared helper) = 9/9 isolated real-PG.
  Typecheck CLEAN. Smoke 20/20.
- **Security impact**: closes a privilege gap — cashiers could previously flip
  a tenant's sync state, drain its queue, or wire up external integrations.
- **Rollback**: revert commit (guards only).
- **Monitoring**: none new.

## Note

This nears the loop's review-debt cap (loop_commits 12/15). The protocol
pauses + notifies at 15 unreviewed loop commits so PR #66 gets a review before
more stacks up.
