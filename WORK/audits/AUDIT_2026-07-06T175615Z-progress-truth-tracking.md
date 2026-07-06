# Audit — Progress Truth Tracking

Date: 2026-07-06T17:56:15Z  
Session: Codex session P  
Status: built_verified

## Summary

Implemented the backend "Tracking Reality" slice for Finder's retail-first operating platform.
The new `progress` module tracks hypotheses, tasks, evidence, decisions, and honest status
transitions without duplicating the existing `reports/retail-proof` or `expenses` modules.

## Changes

- Added `src/modules/progress/` with idempotent migrations for:
  - `progress_hypotheses`
  - `progress_tasks`
  - `progress_evidence`
  - `progress_decisions`
- Added progress APIs under `/api/v1/progress`:
  - `GET/POST /hypotheses`
  - `POST /hypotheses/:id/decisions`
  - `GET/POST /tasks`
  - `PATCH /tasks/:id/status`
  - `POST /tasks/:id/evidence`
  - `POST /tasks/:id/system-verify`
  - `POST /evidence`
  - `GET /summary`
- Registered the module in `src/modules/index.ts`; smoke confirms it boots before `rls`.
- Enforced the status model:
  - Manual status updates can set planned/in-progress/self-reported/blocked/skipped.
  - `validated`, `invalidated`, `evidence_attached`, and `system_verified` require the dedicated evidence, decision, or system-verification paths.
  - Task evidence linked to a hypothesis counts toward hypothesis decisions.
- Added system verification sources backed by tenant-scoped operating data:
  - `retail.first_product`
  - `retail.first_receiving`
  - `retail.first_sale`
  - `retail.expenses_categorized`
  - `retail.cost_prices_complete`
- Added audit-log writes for hypothesis creation, task creation, task status change, evidence attachment, decision creation, and system verification.

## Verification

- PASS: focused progress test via embedded Postgres harness — 3/3.
- PASS: `npm run typecheck`.
- PASS: sequential `npm test` — 354/354.
- PASS: `npm run smoke` — 20/20; module list includes `progress`.
- PASS: `node tools/hygiene-check.mjs`.
- PASS: `cd web && npm run typecheck`.
- PASS: `cd web && npm run lint` — same existing hook warnings.
- PASS: `cd web && npm test` — 102/102 when run alone.
- PASS: `cd web && npm run build`.

## Notes

- An earlier full backend run and frontend test run were noisy because gates were run in parallel; sequential reruns passed.
- No frontend surfaces were added in this slice. The next product step is a UI that consumes `/api/v1/progress` and can create tasks from retail-proof signals.
