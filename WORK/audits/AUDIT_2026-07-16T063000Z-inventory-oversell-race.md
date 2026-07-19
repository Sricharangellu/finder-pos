# Audit — inventory stock-adjust oversell race (session D, inventory focus, iter 10)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop — Sri-directed INVENTORY focus)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/inventory/service.ts` + NEW concurrency.test.ts

## Finding (concurrency bug — verified with a failing-without-fix test)

`inventory.adjust()` was read-modify-write inside its transaction:
SELECT stock_qty (no lock) → compute `nextQty` in JS → write the absolute
value. Two concurrent adjusts on the same product both read the same starting
qty; the second UPDATE overwrites the first based on a stale read — a lost
update that oversells stock. Concretely: product at 10, two simultaneous sales
of 6 → final 4 instead of 0, and one sale silently vanishes from the count.

The FEFO lot-allocation path in the same file already used `FOR UPDATE`
(service.ts:204); the primary stock path did not — an inconsistency, not a
deliberate choice.

## What was done

- `adjust()` SELECT now takes `FOR UPDATE`, locking the stock row so concurrent
  adjusts on the same product serialize and each reads the fresh value.
- The new-row INSERT gained `ON CONFLICT (tenant_id, product_id) DO UPDATE SET
  stock_qty = GREATEST(0, inventory.stock_qty + @delta)` for the rarer
  first-receive race (two concurrent first-ever receipts of a new product would
  otherwise collide on the PK).
- NEW concurrency.test.ts: opens a SECOND connection on the same schema, holds
  a `FOR UPDATE` lock while `adjust()` runs on the first, commits a -6 before
  releasing. Deterministic. **Verified it fails without the fix** (final 4 =
  lost update) and passes with it (final 0).

## Delivery standard

- **Architecture impact**: none; aligns the stock path with the module's own
  FEFO locking convention.
- **Database impact**: none (query-level lock + upsert; no schema change).
- **Testing evidence**: inventory 21/21 + concurrency 1/1 + movements-pagination
  3/3 = 25/25 isolated real-PG; the concurrency test was confirmed to FAIL when
  the fix is reverted (true regression test); typecheck CLEAN; smoke 20/20.
- **Security/correctness impact**: closes a stock-oversell / inventory-accuracy
  bug on the hot path (every concurrent sale of the same product).
- **Rollback**: revert commit (query-level change).
- **Monitoring**: none new.

## Inventory focus — next candidates (for subsequent iterations)
- Transfer atomicity (dual-location movement) — verify single-tx + locking.
- Cycle-count variance posting correctness.
- reserve()/availability check races vs. adjust().
