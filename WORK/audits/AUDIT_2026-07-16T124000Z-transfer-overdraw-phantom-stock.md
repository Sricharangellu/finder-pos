# Audit — transfer over-draw creates phantom stock (session D, inventory iter 4)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop — INVENTORY focus)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/inventory/service.ts` + transfer-atomicity.test.ts (1 new test)

## Finding (stock creation — verified with a failing-without-fix test)

`createTransfer()` never validated source availability. `adjustStockTx` clamps
the source debit at `GREATEST(0, …)`, but the destination leg is credited the
FULL requested quantity — so transferring more than the source holds conjures
stock: 100 units from a location holding 10 leaves the source at 0 (only −10
applied) and the destination at +100, a net +90 units created from nothing.

## What was done

- Inside the transfer transaction, lock the source stock row `FOR UPDATE` and
  read on-hand; if `quantity > available`, throw
  `409 insufficient_stock` before any movement. No phantom stock; the source
  lock also participates in the transfer's atomicity.
- NEW test: transfer 100 from a location holding 10 → 409, both locations
  unchanged, no transfer record. **Verified to FAIL without the guard**
  (destination credited 100 → phantom stock) and pass with it.

## Deferred (noted)

- Cross-transfer deadlock (A→B vs B→A opposite lock order) — real but hard to
  reproduce deterministically in a test (deadlock timing), so it does not meet
  the loop's "regression test must fail without the fix" bar. Canonical lock
  ordering remains a tracked follow-up.
- transfer_number COUNT(*)+1 → doc-counter (needs max-seeding).

## Delivery standard

- **Architecture impact**: none.
- **Database impact**: none (row lock + read; no schema change).
- **Testing evidence**: full inventory 30/30 isolated real-PG (new over-transfer
  test verified to fail on the pre-fix code); typecheck CLEAN; smoke 20/20.
- **Correctness impact**: closes silent stock creation via over-transfer.
- **Rollback**: revert commit.
- **Monitoring**: none new.
