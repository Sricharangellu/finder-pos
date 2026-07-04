# FinderPOS — Multi-Agent Work Lock

Status: ACTIVE

## Active Claim

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, takeover confirmed by Sri) |
| Queue item | #1 — Triage/fix 10 core-flow e2e failures (checkout ×3, inventory-receive ×3, invoice-pay ×3, logout ×1) |
| Files/areas expected | `web/e2e/*.spec.ts`; possibly terminal/purchasing/finance pages + components if real gaps found. Production build (`NEXT_PUBLIC_MOCK=false`) + real backend + Postgres via harness |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | ACTIVE |
| Blockers | none |

## Superseded Claim (session A — stale, released by Sri 2026-07-04)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "NEXT" directive from Sri) |
| Queue item | #1 — e2e core-flow triage (same item as above) |
| Status | RELEASED (stale) — no lock update and no pushed commits >24h after claim; Sri confirmed the session is no longer running. Item taken over by session E. |

## Parallel Non-Overlapping Claim (session A — CI hardening)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, resumed 2026-07-04; prior stale #1 claim correctly released) |
| Queue item | CI hardening (AUDIT_2026-07-03B rec #2): make CI gates real — add `npm run smoke` to backend job; fix e2e job (mocks were ON: dead `NEXT_PUBLIC_E2E_MODE`, missing `NEXT_PUBLIC_MOCK=false`; bare `tsx` not on PATH; `npm start` incompatible with standalone output; wait loops never fail) |
| Files/areas expected | `.github/workflows/ci.yml` ONLY. No `web/**`, no `src/**`, no e2e specs, no local ports — zero overlap with session E's item #1 |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | ACTIVE |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session C — SEC-3)

| Field | Value |
|---|---|
| Agent/session | Codex session C |
| Queue item | SEC-3 — Add frontend HSTS header in `web/middleware.ts` |
| Files/areas expected | `web/middleware.ts`, `WORK/WORK_STATE.md`, new audit note only. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — no code change needed; current `web/middleware.ts` already sets `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session C — SEC-4)

| Field | Value |
|---|---|
| Agent/session | Codex session C |
| Queue item | SEC-4 — Remove unsafe `document.write()` product-field injection from print labels modal |
| Files/areas expected | `web/app/(protected)/catalog/_components/PrintLabelsModal.tsx`, focused test if existing pattern allows, `WORK/WORK_STATE.md`, new audit note. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — non-overlapping work complete; focused Vitest PASS, full frontend Vitest 84/84, frontend typecheck/lint/build PASS, backend typecheck PASS, backend tests PASS 312/312; pushed in `540caf9` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session D — SEC-8)

| Field | Value |
|---|---|
| Agent/session | Codex session D |
| Queue item | SEC-8 — route catalog CSV export through shared API client refresh/error handling instead of direct authenticated `fetch()` |
| Files/areas expected | `web/api-client/client.ts`, `web/app/(protected)/imports-exports/page.tsx`, focused frontend API-client tests, `WORK/WORK_STATE.md`, new audit note. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | READY TO RELEASE AFTER PUSH — non-overlapping work complete; focused API-client Vitest PASS, full frontend Vitest 86/86, frontend typecheck/lint/build PASS, backend typecheck PASS, backend tests PASS 312/312 |
| Blockers | none |

## Parallel Non-Overlapping Claim

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | #4 — RLS gap: request-scoped tenant context (AsyncLocalStorage) so the DB layer sets app.tenant_id on every authenticated query; cross-tenant regression test on real Postgres. Policy stays permissive-when-unset (strict flip deferred until e2e green) |
| Files/areas expected | `src/shared/db.ts`, `src/shared/tenant-context.ts` (new), `src/gateway/auth.ts` (tenantResolver), `src/modules/rls/index.ts` (policy carve-outs), `src/gateway/tenant-isolation.test.ts` (new) — backend only, NO `web/**` edits. Embedded Postgres via test harness (no fixed ports) |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — built + verified (isolation test PASS via non-superuser role, tsc 0 errors, smoke 14/14, probe 22/22, full suite green); committed and pushed. See WORK/AUDIT_2026-07-04C.md |
| Blockers | none |

## Released Claims (session E, item #3)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | #3 — Implement ~14 mock-only endpoints on the real backend (inventory transfers/adjustments, team invite/detail, workflow templates, AR-aging sweep, Vendor-360 family ×6) |
| Files/areas expected | `src/modules/inventory/**`, `src/modules/team/**`, `src/modules/workflows/**`, `src/modules/reports/**`, `src/modules/purchasing/**`, `src/identity/migrations.ts` (additive users.name) — backend only, NO `web/**` edits. Embedded Postgres via test harness (no fixed ports) |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — all endpoints implemented + verified (probe 22/22 on real Postgres, tsc 0 errors, smoke 14/14, backend tests green); committed and pushed. See WORK/AUDIT_2026-07-04B.md |
| Blockers | none |

## Released Claims

| Field | Value |
|---|---|
| Agent/session | Codex session B |
| Queue item | #2 — Fix 8 stale frontend Vitest assertions (`catalogCart.test.tsx`, `reportsDashboard.test.tsx`) |
| Files/areas expected | `web/tests/catalogCart.test.tsx`, `web/tests/reportsDashboard.test.tsx`; read-only inspection of related components/hooks |
| Started | 2026-07-03 ~21:30 CDT |
| Last update | 2026-07-03 ~21:36 CDT |
| Status | RELEASED — non-overlapping work complete; targeted Vitest 12/12, full frontend Vitest 83/83, frontend typecheck/lint/build PASS |
| Blockers | none |

## Rules

- Claim one queue item before editing code.
- Do not work an overlapping queue item while this file is `ACTIVE`.
- If a lock looks stale, mark it `STALE?` and stop for review; do not silently overwrite it.
- Release the lock only after commit and push succeed.
- If blocked, leave the lock active and write the blocker clearly.

## Common Multi-Agent Failure Modes

- One agent verifies against stale code while another has unpushed changes.
- Two agents edit the same tests or routes and one overwrites the other.
- A dev server, backend server, or Postgres instance from another session changes e2e results.
- One agent updates migrations while another tests an older schema.
- A second agent sees failures caused by a dirty tree, not by the application.
