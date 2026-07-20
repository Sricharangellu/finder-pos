# orchestration/ — project-process docs (NOT the workflow engine)

This folder is **project orchestration**: playbooks, status, and history for the
multi-agent engineering process that builds Ascend. It contains no runtime code.

Looking for the **workflow/saga engine** (WorkflowRunner, sagas, job queue,
outbox consumers)? That is [`src/orchestration/`](../src/orchestration/).

## Contents

| File / dir | What it is |
|---|---|
| `AGENT_BACKEND_CYCLE.md`, `AGENT_FRONTEND_CYCLE.md` | **Superseded (2026-07-20)** — kept at this exact path (content replaced with a redirect) because external scheduled routines may reference them by path. Current process: `docs/architecture/ORCHESTRATION.md` + `WORK/LOOP_PROTOCOL.md`. |
| `_archive/` | Retired docs, including the pre-2026-07-20 `PROJECT_STATUS.md`, `RUNBOOK.md`, `SYSTEM_DESIGN.md`, `INTEGRATION_LOG.md`, `ERP_BENCHMARK.md`, `CATALOG_PRODUCT_FINDER.md`, `SCOPE_EXPANSION.md`, and `gaps/` (per-module gap triage, superseded by `docs/architecture/GAPS.md`) |

These files are referenced by path from scheduled agent routines configured
outside this repository — do not move or rename this folder without updating
those routines.

## Where things live now (2026-07-20 consolidation)

- **Orchestration** (workflows, plans, agents, skills): `docs/architecture/ORCHESTRATION.md`
- **Design principles**: `docs/architecture/DESIGN_PRINCIPLES.md`
- **Architecture** (as-built + roadmap + domain model): `docs/architecture/ARCHITECTURE.md`
- **Gaps** (current, code-verified — not a month-stale assessment): `docs/architecture/GAPS.md`
- **Live work state**: `WORK/LOOP_STATE.md`, `WORK/LOCK.md`, `WORK/FORWARD_PLAN.md`

## Note on `ROADMAP.md` references

Many archived docs here reference `orchestration/ROADMAP.md`. That file was
deliberately retired in commit `519a49c` ("clean dirty drift", #33) and no
longer exists — those references are historical, not broken links to
restore.
