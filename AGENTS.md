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

## Multi-agent coordination lock

Before editing code, check `WORK/LOCK.md`.

- If it is marked `FREE`, claim exactly one queue item by editing `WORK/LOCK.md` with:
  agent/session name, queue item, files/areas expected, start time, and status `ACTIVE`.
- If it is `ACTIVE` and the item overlaps your intended work, **stop**. Do not build the
  same fix in parallel. Pull latest, read the active claim, and either wait or pick a
  non-overlapping queue item only if `WORK/WORK_STATE.md` allows it.
- If it is `ACTIVE` but clearly stale, do not delete it silently. Mark it `STALE?` in
  `WORK/LOCK.md`, add a note to `WORK/WORK_STATE.md`, and stop for human/lead review.
- At handoff, update `WORK/LOCK.md` back to `FREE` only after commit + push succeeds and
  `WORK/WORK_STATE.md` records what changed. If blocked, leave the lock `ACTIVE` with
  blocker details so another agent does not duplicate the same broken path.

Parallel AI sessions can create false errors: stale builds, port conflicts, dirty-tree
overwrites, duplicate fixes, migration mismatches, and e2e failures caused by another
server/process. Treat unexplained failures as possible coordination conflicts until
`git status`, `git pull --ff-only`, ports, and `WORK/LOCK.md` are checked.

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

## Git: where and how

- **Remote:** `origin` = https://github.com/Sricharangellu/finder-pos.git · **branch:** `master`.
- **Session start:** `git pull --ff-only origin master`. If it refuses, stop and reconcile —
  never rebase/force-push master.
- **Session end:** commit (conventional commits, small and scoped) and `git push origin master`
  ONLY after gates pass: `npm run typecheck && npm test` (root) and
  `cd web && npm run typecheck && npm run lint && npm run build`. Backend changes also
  need `npm run smoke` green. Never leave unpushed work on one machine at handoff.
- **Salvage branches:** 12 `worktree-agent-*` branches are parked pre-pause work — do NOT
  delete or bulk-merge them; harvest selectively per the inventory in
  `WORK/AUDIT_2026-07-03B.md`, and only through the RULES.md definition of done.
- If you create a branch or worktree, remove it before ending the session.

## Local runbook (macOS dev machine)

- **Fast proof (no setup):** `npm run smoke` — boots the real app on embedded Postgres and
  drives the full POS lifecycle. Local Postgres 15 also available:
  `export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"`.
- **Real-stack e2e** (mocks OFF requires a PRODUCTION build — `npm run dev` ALWAYS mocks,
  never use the dev server to verify real-backend behavior):
  1. `pg_ctl -D /opt/homebrew/var/postgresql@15 start && createdb finder_e2e`
  2. Backend: `DATABASE_URL=postgresql://$USER@localhost:5432/finder_e2e JWT_SECRET=<any> PORT=3001 npx tsx src/server.ts` (migrations run at boot)
  3. Seed: same `DATABASE_URL` + `npx tsx scripts/seed-e2e.ts` → login `owner@finder-pos.dev` / `FinderDemo!2026`
  4. Frontend: `cd web && NEXT_PUBLIC_MOCK=false npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && PORT=3000 BACKEND_URL=http://localhost:3001 node .next/standalone/server.js`
  5. `cd web && npx playwright test` (baseline 2026-07-03: 25 passed / 22 failed)
  6. Afterwards stop servers and `pg_ctl -D /opt/homebrew/var/postgresql@15 stop`.

## Handoff protocol (every session, no exceptions)

1. Update `WORK/WORK_STATE.md`: what was done, next 3 actions, blockers.
2. New verification results → new dated `WORK/AUDIT_*.md`; never edit old audits.
3. Working tree clean, no stray root files, no leftover worktrees/branches, servers stopped.
4. Commit and push. Report honestly what passed AND what failed, with RULES.md labels.

## Hard rules

- Never write secrets (VERCEL_TOKEN, keys, tokens) into any file.
- Never reference competitor POS/ERP brand names anywhere.
- Conventional commits; typecheck + tests must pass before committing.
- Product specs live in `docs/` and `contracts/` — do not duplicate them into WORK/.
- Clean up after yourself: no stray files at repo root, no leftover worktrees/branches.
