# Audit — inventory transfer atomicity (session D, inventory focus, iter 2)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop — INVENTORY focus)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/inventory/service.ts` + NEW transfer-atomicity.test.ts

## Finding (partial-failure data loss — verified with a failing-without-fix test)

`createTransfer()` moved stock with THREE independent statements: two separate
`adjustStock` calls (each its own transaction) plus a separate transfer-record
INSERT. A crash or error between the source debit and the destination credit
committed the debit and lost the credit — stock left the source and never
arrived. On a POS/inventory system that is silent stock loss.

## What was done

- Extracted `adjustStockTx(tdb, …)` — the location-stock logic against a
  caller-supplied transaction handle — and added `FOR UPDATE` (the same
  read-modify-write race fixed on the product-level `adjust()` in the prior
  iteration; `adjustStock` now delegates to it).
- `createTransfer()` runs both legs + the record INSERT in ONE
  `withTenant(tenantId).tx(...)`, so a failure in any step rolls back the whole
  transfer.
- NEW transfer-atomicity.test.ts: seeds the destination at INT_MAX so the
  credit overflows the INTEGER column (deterministic failure on the 2nd leg),
  asserts the source is unchanged and no record persists; plus a happy-path
  test. **Verified against a faithful revert to the original code** — the
  atomicity test FAILS there ("source stock must be unchanged", 5 units lost)
  and passes with the fix.

## Deferred (tracked follow-ups)

- `transfer_number` still uses `COUNT(*)+1` (banned racy pattern) — but the
  column is non-unique, so the race is cosmetic (occasional duplicate display
  numbers). Swapping to the race-free doc-counter needs max-seeding against
  existing transfer numbers (as session A did for sales/shipping); noted inline
  and here rather than risk a deploy-time collision.
- Cross-transfer deadlock: two simultaneous transfers A→B and B→A lock the two
  rows in opposite order. Lower likelihood; canonical lock ordering is a
  possible next item.

## Delivery standard

- **Architecture impact**: none; uses the tx helper's existing nesting
  (isTx → reuse) via a shared adjustStockTx handle.
- **Database impact**: none (no schema change).
- **Testing evidence**: inventory 21/21 + concurrency 1/1 + transfer-atomicity
  2/2 + movements-pagination 3/3 = 27/27 isolated real-PG; the atomicity test
  confirmed to FAIL on the pre-fix code; typecheck CLEAN; smoke 20/20.
- **Correctness impact**: closes silent stock loss on partial transfer failure;
  also serializes concurrent location-stock adjusts (FOR UPDATE).
- **Rollback**: revert commit.
- **Monitoring**: none new.
