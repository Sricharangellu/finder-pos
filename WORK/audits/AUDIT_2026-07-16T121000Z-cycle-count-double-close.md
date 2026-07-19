# Audit — cycle-count double-close double-posts variance (session D, inventory iter 3)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop — INVENTORY focus)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/inventory/service.ts` + NEW cycle-count-close.test.ts

## Finding (concurrency correctness — verified with a failing-without-fix test)

`closeCycleCount()` read the session, checked `status == 'open'`, looped
applying each variance via `adjust()` (each its own tx), then flipped the
session to 'closed' — none of it atomic or single-winner. Two concurrent
closes both passed the open-check and applied EVERY variance a second time,
double-counting the correction into stock (e.g. a −3 variance posts as −6). A
crash mid-loop + retry double-posts the same way.

## What was done

- Extracted `adjustTx(tdb, …)` from `adjust()` (the tx body; `adjust()` now
  wraps it and still publishes the event post-commit).
- `closeCycleCount()` is now ONE transaction that locks the session row
  `FOR UPDATE` up front, applies all variances via `adjustTx` in-tx, flips to
  'closed', and publishes `inventory.adjusted` events after commit. A second
  concurrent close blocks on the lock, then reads 'closed' and 409s — the
  variance posts exactly once.

## Delivery standard

- **Architecture impact**: none; same tx-handle pattern established for
  adjustStock/transfers, now applied to the product-level adjust path.
- **Database impact**: none (row lock + one tx; no schema change).
- **Testing evidence**: NEW cycle-count-close.test.ts — a deterministic
  concurrent double-close (third connection holds the inventory row lock so
  both closes park mid-flow after reading the session) asserts the variance
  posts once (10−3=7, one cycle_count movement, one close 409s); plus a
  sequential re-close test. **Verified the concurrent test FAILS on a faithful
  revert** (double-posted → stock 4) and passes with the fix. Full inventory
  29/29 isolated; typecheck CLEAN; smoke 20/20.
- **Correctness impact**: closes stock corruption from concurrent/retried
  cycle-count closes.
- **Rollback**: revert commit.
- **Monitoring**: none new.

## Inventory focus — remaining candidates
- transfer_number COUNT(*)+1 → doc-counter (needs max-seeding).
- cross-transfer lock ordering (A→B vs B→A deadlock).
- lots/expiry FEFO edge cases; negative/zero-qty guards on receive.
