# WORK/ — Canonical AI Work Folder

**Every agent, workflow, and AI session writes its process output HERE and only here.**
Established 2026-07-03 by Sri's directive. This folder is the single source of truth for
project state, plans, audits, and reports. No AI-generated state/plan/report file may be
created anywhere else in the repo.

## Rules

1. **One folder.** All AI process artifacts — work state, forward plans, audit reports,
   readiness matrices, session handoffs, gap analyses — live in `WORK/`. Never at repo
   root, never scattered in `docs/` or `orchestration/`.
2. **Override in place.** Update the existing file. Do NOT create variants
   (`FILE 2.md`, `_v2`, `_FINAL`, `_NEW`, dated copies of living docs). Create a new
   file only for a genuinely new kind of artifact, and register it in the index below.
3. **Override only if required.** Before overwriting, read the target. If your change
   contradicts what is there, reconcile or append — do not silently clobber another
   session's state. Immutable snapshots (audit reports) are never edited after the
   session that wrote them; write the next audit as a new dated file.
4. **Session read order:** this README → `WORK_STATE.md` → `FORWARD_PLAN.md` →
   newest `AUDIT_*.md`. Do not re-read the whole repo to reconstruct context.
5. **Honest status labels only** (required in every doc):
   `Built and verified` · `Built but not verified` · `UI-only` · `Mocked` · `Partial` ·
   `Planned` · `Not production-ready`.
   Never describe a module as done without saying which label applies.
6. **Product documentation is separate.** `docs/`, `contracts/`, `orchestration/` hold
   product/architecture specs and stay where they are. `WORK/` holds *process* state.
7. **One active queue item.** Before touching code, claim work in `LOCK.md`. Do not work
   the same queue item as another active agent. If the lock overlaps your intended task,
   stop and reconcile instead of creating competing fixes.

## File index

| File | Kind | Write policy |
|---|---|---|
| `README.md` | Folder rules | Override only when the rules themselves change |
| `RULES.md` | Build rules: prime directive, domain rules, definition of done, per-task prompt, readiness matrix | Matrix updated with new evidence only; rules change only on Sri's directive |
| `WORK_STATE.md` | Live session state (active task, files in flight, decisions, next actions, blockers) | Override in place after every commit |
| `LOCK.md` | Multi-agent coordination lock: active queue item, owner, files/areas, status | Update at session start and end; never ignore an active overlapping lock |
| `FORWARD_PLAN.md` | Authoritative phase-based plan + release gates + audit prompt | Override only when the plan genuinely changes |
| `AUDIT_YYYY-MM-DD.md` | Immutable audit snapshot + readiness matrix | Append-only during its session; never edited after |

Session read order is: `README.md` → `RULES.md` → `WORK_STATE.md` → `FORWARD_PLAN.md` →
newest `AUDIT_*.md`.
