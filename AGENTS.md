# FinderPOS — Agent Instructions

Read this first. It applies to EVERY agent, workflow, and AI session working in this repo
(Claude Code, subagents, background agents, any other tool).

## The one rule that overrides everything

All AI process output — work state, plans, audits, reports, matrices, handoffs — goes in
**`WORK/`** and nowhere else. Update files in place; override only if required (read the
target first, reconcile, don't clobber). Never create `FILE 2.md`, `_v2`, `_FINAL`, or
dated copies of living docs. Full rules: `WORK/README.md`.

## Session start (in order, ~2 minutes)

1. `WORK/README.md` — folder rules
2. `WORK/RULES.md` — build rules, definition of done, per-task prompt, readiness matrix
3. `WORK/WORK_STATE.md` — active task, next actions, blockers
4. `WORK/FORWARD_PLAN.md` — phase plan and release gates
5. Newest `WORK/AUDIT_*.md` — last verified truth

Do not cold-read the whole repo; the context you need is in those four files.

## Current marching orders

Feature/module/page expansion is **PAUSED**. Work the phase plan in
`WORK/FORWARD_PLAN.md`: verify truth → harden the core retail spine → production
hardening → only then expand. One work item per session, verified before commit.

## Verification commands (run before claiming anything works)

```bash
npm run typecheck          # backend, from repo root
npm test                   # backend suite (unit-level, stubbed DB)
npm run smoke              # REAL end-to-end proof: boots app on real Postgres
cd web && npm run typecheck && npm run lint && npm test && npm run build
```

`npm run smoke` is the strongest single check — it drives the full POS lifecycle
(auth → catalog → inventory → order → payment → offline sync → refund) over HTTP
against a real database. Watch its stderr: workflow/orchestration errors in the log
are real defects even when the steps pass.

## Honest status labels (required in all docs and reports)

`Built and verified` · `Built but not verified` · `UI-only` · `Mocked` · `Partial` ·
`Planned` · `Not production-ready`. Never call something done without one of these.

## Hard rules

- Never write secrets (VERCEL_TOKEN, keys, tokens) into any file.
- Never reference competitor POS/ERP brand names anywhere.
- Conventional commits; typecheck + tests must pass before committing.
- Product specs live in `docs/` and `contracts/` — do not duplicate them into WORK/.
- Clean up after yourself: no stray files at repo root, no leftover worktrees/branches.
