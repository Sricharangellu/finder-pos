# FinderPOS — Multi-Agent Work Lock

Status: ACTIVE

## Active Claim

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "NEXT" directive from Sri) |
| Queue item | #1 — Triage/fix 10 core-flow e2e failures (checkout ×3, inventory-receive ×3, invoice-pay ×3, logout ×1) |
| Files/areas expected | `web/e2e/*.spec.ts`; possibly terminal/purchasing/finance pages + components if real gaps found. Using ports 3000/3001 + Postgres 5432 (`finder_e2e`) |
| Started | 2026-07-03 ~21:35 CDT |
| Last update | 2026-07-03 ~21:35 CDT |
| Status | ACTIVE |
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
