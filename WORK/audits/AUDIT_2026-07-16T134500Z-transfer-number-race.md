# Audit — race-free transfer numbering (session D, inventory iter 5)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop — INVENTORY focus, resumed after Sri feature)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/inventory/service.ts` + transfer-atomicity.test.ts (1 new test)

## Finding (banned pattern — verified with a failing-without-fix test)

`createTransfer` generated `transfer_number` via `COUNT(*)+1` — the exact
pattern CODING_STANDARDS bans ("never COUNT(*)+1 or MAX+1"). Two concurrent
transfers both COUNT the same value before either inserts, producing duplicate
transfer numbers.

## What was done

- Replaced with the shared `document_counters` primitive: seed the counter to
  the current transfer count on first use (INSERT … SELECT COUNT … ON CONFLICT
  DO NOTHING — keeps numbering continuous with existing rows), then
  `nextDocNumber(tdb, tenant, "inventory_transfers", "TRF", 4)`. The counter's
  atomic upsert-increment serializes concurrent allocations.
- Deterministic barrier test: a third connection holds the source stock row so
  both transfers reach the number-generation step before either commits (the
  exact race window), then asserts the two transfer numbers are distinct.
  **Verified to FAIL on a revert to COUNT(*)+1** (both got TRF-0001) and pass
  with the fix.

## Delivery standard

- **Architecture impact**: adopts the existing race-free doc-number primitive
  (as sales/shipping already did).
- **Database impact**: uses the existing document_counters table; seeded per
  tenant on first transfer. No schema change.
- **Testing evidence**: inventory 28/28 isolated real-PG (new numbering test
  verified to fail on the pre-fix code); typecheck CLEAN; smoke 20/20.
- **Correctness impact**: removes duplicate transfer numbers under concurrency.
- **Rollback**: revert commit.
- **Monitoring**: none new.

## Inventory queue status — thinning
Remaining candidates are now low-value or need Sri: FEFO expired-lot allocation
is post-sale bookkeeping (a separate expired() report drives pulls) and true
"block selling expired" is a POS-policy decision (Sri); createLot negative-qty
is defense-in-depth on an internally-guarded path; cross-transfer A→B/B→A
deadlock resists deterministic testing. Next iteration may signal the inventory
focus is exhausted absent new direction.
