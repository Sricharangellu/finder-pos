# Audit — journal-entry keyset pagination (session D, loop iter 5)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop iter 5)
Branch: `feat/delivery-pipeline`
Files: `src/modules/accounting/{service,routes}.ts` + `accounting.test.ts` (2 new tests)

## Finding (verified)

Backlog item "ledger/reports unbounded-list check". Reports were cleared —
they are bounded aggregations (GROUP BY / top-N summaries), not row lists. The
real violation was `accounting.listJournal()`: a bare `LIMIT 500` on
`journal_entries` — the most append-heavy financial table (~1M rows/day per
the capacity doctrine) — with NO cursor. Ledger/audit history beyond the most
recent 500 rows per filter was silently unreachable. This is the
CODING_STANDARDS "cursor REQUIRED on unbounded append-heavy lists" rule on the
single most compliance-critical table (accounting is sacred). Neither session
B nor C claims accounting.

## What was done

- `listJournal` now returns `CursorPage<JournalEntry>` via shared/pagination —
  keyset `(created_at, id) < (cursor)` on the existing DESC ordering (the
  tiebreaker was already present). limit clamps 200/500 as before.
- `GET /accounting/journal` returns `{ items, nextCursor, limit }` — additive
  to the prior `{ items }`; `?cursor=` pages deeper. Backward compatible:
  existing clients (and the existing test at accounting.test.ts:179) read
  `.items` unchanged.

## Delivery standard

- **Architecture impact**: none; applies the documented pagination policy to
  the ledger read path. No change to the append-only posting path (accounting
  correctness untouched).
- **Database impact**: none (query-only; rides existing tenant-leading index +
  created_at ordering). No migration.
- **Testing evidence**: 2 new tests (keyset round-trip no-dup/no-gap +
  newest-first; backward-compat `{items}` shape) + 17 existing accounting
  tests = 19/19 isolated real-PG. Typecheck CLEAN. Smoke 20/20.
- **Security impact**: none; route already auth+tenant scoped. Deep ledger
  access now possible for legitimate auditors (a compliance improvement).
- **Rollback**: revert commit (read-path only).
- **Monitoring**: none new.
