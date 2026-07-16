# orchestration/ — project-process docs (NOT the workflow engine)

This folder is **project orchestration**: playbooks, status, and history for the
multi-agent engineering process that builds Ascend. It contains no runtime code.

Looking for the **workflow/saga engine** (WorkflowRunner, sagas, job queue,
outbox consumers)? That is [`src/orchestration/`](../src/orchestration/).

## Contents

| File / dir | What it is |
|---|---|
| `AGENT_BACKEND_CYCLE.md` | Playbook for the scheduled backend agent cycle |
| `AGENT_FRONTEND_CYCLE.md` | Playbook for the scheduled frontend agent cycle |
| `PROJECT_STATUS.md` | Living status snapshot of the project |
| `RUNBOOK.md` | Incident playbooks |
| `SYSTEM_DESIGN.md` | System design narrative |
| `INTEGRATION_LOG.md` | Integration history log |
| `ERP_BENCHMARK.md`, `CATALOG_PRODUCT_FINDER.md`, `SCOPE_EXPANSION.md` | Research / scoping notes |
| `gaps/` | Per-module gap triage |
| `_archive/` | Retired docs (see its README for why each was retired) |

These files are referenced by path from scheduled agent routines configured
outside this repository — do not move or rename this folder without updating
those routines.

## Note on `ROADMAP.md` references

Many docs here reference `orchestration/ROADMAP.md`. That file was deliberately
retired in commit `519a49c` ("clean dirty drift", #33) and no longer exists —
those references are historical, not broken links to restore. Current work
tracking lives in `WORK/` (see `WORK/README.md` and `WORK/LOCK.md`); roadmaps
live in `docs/architecture/` (`ACPA_ROADMAP.md`, `PLATFORM_ROADMAP.md`).
