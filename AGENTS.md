# FinderPOS — Agent Instructions

This is the ONE agent instruction file. It applies to EVERY agent, workflow, and AI
session working in this repo (Claude Code, subagents, background agents, any other tool).
`CLAUDE.md` is only a short pointer to it.

The **Operating Contract** below (authored by Sri, 2026-07-06) is authoritative. The
**Operational Reference** after it provides the concrete mechanics the contract refers to
(lock protocol, git modes, local runbook, handoff). Where the reference conflicts with the
contract, the contract wins.

---

# Finder Agent Operating Prompt

You are working on Finder, a retail-first POS and business operating platform.

## Source Of Truth

Before making changes, read these files in order:

1. `AGENTS.md`
2. `WORK/FORWARD_PLAN.md`
3. `WORK/LOCK.md`
4. Latest relevant file in `WORK/audits/`

There is only one active agent instruction file:

- `AGENTS.md`

There is only one active project plan:

- `WORK/FORWARD_PLAN.md`

Do not create or revive duplicate planning files such as:

- `CLAUDE.md`
- `ROADMAP.md`
- `RULES.md`
- `WORK_STATE.md`
- `PROJECT_PLAN.md`
- `* 2.*` duplicate copies

If duplicate or obsolete files appear, remove them only when they are clearly redundant and not user-created work.

## Product Direction

Finder is retail-first.

Priority order:

1. Retail proof
2. Wholesale / B2B expansion
3. Vertical packs
4. Broader business operating platform

Do not add broad vertical depth before the retail flow is complete and verified.

The first production-ready Finder release must prove this flow with real backend data:

```text
Create business
-> Add/import products
-> Set stock and cost prices
-> Record sales
-> Record expenses
-> View dashboard
-> Review recommendations
-> Complete tasks with evidence
```

Finder must help a retailer answer:

- What products do I sell?
- What is in stock?
- What sold?
- What did I make?
- What is low, slow, profitable, or risky?
- What should I do next?

## Required Status Labels

Use honest status labels:

- `built_verified`
- `built_unverified`
- `partial`
- `mocked`
- `planned`
- `missing`

Never mark a feature complete just because a page exists.

A feature is complete only when it has:

- Backend endpoint
- Database persistence
- Tenant isolation
- Permission checks
- Audit logging where appropriate
- Frontend wired to real backend in production mode
- Loading, empty, error, and success states
- Tests for important behavior
- No production dependency on MSW or fake auth

## Mock And Partial Rules

Mocks are allowed only for:

- Local development
- Tests
- Clearly labeled demo/preview mode

Production behavior must use real backend routes.

Known mock-backed / partial frontend API prefixes:

- `/api/v1/promotions`
- `/api/v1/documents`
- `/api/v1/golf`
- `/api/v1/pricing`
- `/api/v1/warehouse`

Do not advertise these as production-ready until real backend modules or rewired backend routes exist.

`/api/v1/product-locations` is connected through `src/modules/store_locations` and is not a gap.

Partial pages should stay hidden from normal navigation unless explicitly enabled with:

```text
NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true
```

## Backend Rules

Every backend change must follow these rules:

- Business tables must be tenant-scoped.
- Business queries must filter by tenant.
- Mutating routes must validate request bodies.
- Sensitive routes must enforce role or permission checks.
- Money must use integer cents.
- Inventory quantity must change through immutable movement records.
- Orders, payments, refunds, voids, register sessions, permission changes, and business profile changes must be auditable where appropriate.
- Return clear errors.
- Add focused tests for critical paths.

## Frontend Rules

Every frontend change must follow these rules:

- Do not build UI without a backend contract or explicit mock-only label.
- Frontend production calls must hit real backend routes.
- Add loading, empty, error, and success states.
- Sensitive actions must be hidden or disabled when the user lacks access.
- Keep the UI practical, dense, and operational. Finder is not a marketing site.
- Do not add decorative complexity that distracts from POS, inventory, reporting, and workflow tasks.

## AI / Recommendations Rules

- Do not make AI the source of truth.
- The first recommendation system must be rule-based.
- Recommendations should inspect real data such as:
  - Missing setup data
  - Products with no cost
  - Low stock
  - Products with no recent sales
  - High sales with low margin
  - Uncategorized expenses
  - Weak revenue trend
  - Inventory movement issues
  - Evidence gaps in validation tasks
- AI may explain deterministic recommendations later, but it must not invent business facts.

## Progress Intelligence Rules

Use this model:

```text
Hypothesis -> Plan -> Task -> Evidence -> Verified Result -> Decision
```

Allowed task states:

- `not_started`
- `planned`
- `in_progress`
- `self_reported_done`
- `evidence_attached`
- `system_verified`
- `validated`
- `invalidated`
- `blocked`
- `skipped`

Use `system_verified` only when Finder can prove completion from internal data, such as:

- Sales records
- Inventory movements
- Expenses
- Payment records
- Audit events
- Connected integration data

## Command Gates

Run the smallest relevant gate while developing.
Before claiming work complete, run the relevant full gate.

Backend/root:

```bash
npm run typecheck
npm test
npm run smoke
```

Frontend:

```bash
cd web
npm run typecheck
npm run lint
npm test
npm run build
```

Full production confidence:

```bash
cd web
NEXT_PUBLIC_MOCK=false npm run build
npx playwright test
```

Do not use `npm run dev` as proof of production backend wiring.

## Work Queue Rules

Use `WORK/FORWARD_PLAN.md` as the active queue.
Pick the first unchecked item in the correct lane unless the user gives a newer instruction.

Current priority:

1. Resolve frontend/backend route alignment.
2. Build retail proof audit endpoint.
3. Complete expenses MVP.
4. Add profit visibility metrics.
5. Add progress intelligence model.
6. Add deterministic recommendation engine.
7. Add segmented business health scores.

## File Hygiene

Keep the project organized.

- Do not create duplicate instruction or plan files.
- Do not leave untracked duplicate files.
- Do not delete user work.

If the tree is dirty:

- Preserve unrelated changes.
- Work only in files needed for the task.
- Do not revert changes you did not make.
- Ask only if existing changes make the task impossible.

## Final Response Rules

When finished, report:

- What changed
- What files changed
- What was verified
- What remains incomplete or risky

Be honest. Do not overstate readiness.

---

# Operational Reference (mechanics the contract refers to)

> The Operating Contract above is authoritative. This section fills in the concrete
> details it points to and does not restate them. Where they conflict, the contract wins.

## Transitional note — governance consolidation in progress

The contract mandates ONE agent file (`AGENTS.md`) and ONE plan (`WORK/FORWARD_PLAN.md`),
and lists `RULES.md` / `WORK_STATE.md` among files that should not exist. Those two files
**still exist on `master` and are still read by in-flight sessions** (`WORK/WORK_STATE.md`
currently holds live state incl. the "Open Production Actions" block). Do NOT delete them
piecemeal — folding their remaining content into `AGENTS.md` + `WORK/FORWARD_PLAN.md` and
removing them is the pending **Foundation Hardening** restructure (`WORK/FOUNDATION_HARDENING.md`),
which must run as a single exclusive `WORK/LOCK.md` claim when the board is clear. Until
then, still check `WORK/WORK_STATE.md` for live state and open production actions.

## Multi-agent coordination lock

Before editing code, check `WORK/LOCK.md`.

**Agent teams** (experimental, enabled in Sri's user settings): a session may spawn
in-session teammates with a shared task list. The whole team is ONE lock unit — the
lead claims one queue item in `WORK/LOCK.md` listing the union of files its teammates
will touch, splits the work so no two teammates edit the same file, and releases the
claim after the combined result is verified, committed, and pushed. Teammates never
claim lock entries themselves, and inter-team coordination with other app sessions
(desktop Claude, Codex, etc.) still happens only through this lock file.

- If it is marked `FREE`, claim exactly one queue item by editing `WORK/LOCK.md` with:
  agent/session name, queue item, files/areas expected, start time, and status `ACTIVE`.
- If it is `ACTIVE` and the item overlaps your intended work, **stop**. Do not build the
  same fix in parallel. Pull latest, read the active claim, and either wait or pick a
  non-overlapping queue item.
- If it is `ACTIVE` but clearly stale, do not delete it silently. Mark it `STALE?`, add a
  note, and stop for human/lead review.
- At handoff, set your claim to `RELEASED`/`FREE` only after commit + push succeed and the
  live-state record is updated. If blocked, leave the lock `ACTIVE` with blocker details so
  another agent does not duplicate the same broken path.

Parallel AI sessions can create false errors: stale builds, port conflicts, dirty-tree
overwrites, duplicate fixes, migration mismatches, and e2e failures caused by another
server/process. Treat unexplained failures as possible coordination conflicts until
`git status`, `git pull --ff-only`, ports, and `WORK/LOCK.md` are checked.

## Git: where and how (trunk-based, staged toward PR gating)

- **Remote:** `origin` = https://github.com/Sricharangellu/finder-pos.git · **trunk:** `master`
  (protected: force-pushes and deletion are blocked). `staging` exists for preview deploys.
- **Session start:** `git pull --ff-only origin master`. If it refuses, stop and reconcile —
  never rebase/force-push master.
- **Commits:** conventional commits (`feat:`/`fix:`/`chore:`/`docs:`/`ci:`/`test:`), small
  and scoped, one logical change each. Never commit secrets or generated artifacts.
- **Current mode (Phase 1): direct-to-master.** Solo owner + coordinated AI sessions push
  directly to `master` after the command gates and the `WORK/LOCK.md` claim protocol. CI
  runs on every push and is the regression net.
- **Target mode (switch when Sri enables PR protection):** short-lived `<type>/<scope>-<slug>`
  branches → `gh pr create --fill` → green CI → `gh pr merge --auto --squash --delete-branch`.

### Sri-only actions (agents cannot do these)

- Flip master to PR-required (Settings → Branches → master rule → require PR + status checks:
  Backend, Frontend, Production guard, E2E).
- Repo Settings → General: enable "Allow squash merging" only + "Automatically delete head branches".
- Fix Actions secrets: `VERCEL_TOKEN`, `STAGING_BACKEND_URL`, staging DB secrets.
- **Live production actions** tracked in `WORK/WORK_STATE.md` "Open Production Actions" (e.g. the
  orphaned `finder-pos.vercel.app` 500, `NODE_ENV=production` / `METRICS_TOKEN` confirmation).

### Branch hygiene

- **Salvage branches:** 12 `worktree-agent-*` branches on origin are parked pre-pause work —
  do NOT delete or bulk-merge; harvest selectively per `WORK/audits/` through the definition of done.
- Stale merged branches (`dev`, `prod`, `testing`, `backend-cycle3`) are deletion candidates
  pending Sri's confirmation.
- If you create a branch or worktree, delete it when merged / before ending the session.

## Repo hygiene & single source of truth (enforced — do not defeat)

Duplicate files and second checkouts caused real damage (blocked rebases, diverged trees,
lost-then-recovered work). These rules exist so it cannot recur:

- **One agent file:** this `AGENTS.md`. `CLAUDE.md` is only a short pointer. CI fails if more
  than one `AGENTS.md` is tracked.
- **Never create ` 2.<ext>` copies or `*.collision-backup.md`.** They are `.gitignore`d and a
  CI guard fails if one is force-committed. Dated audits use a collision-proof
  UTC-ISO-timestamp name, never the next-free letter.
- **One canonical checkout.** Work only in the primary clone. Do NOT make a second clone
  (e.g. `finder-pos-github`) — two clones of the same remote diverge and collide on push. For
  parallel sessions use `git worktree add ../wt-<task>`, never independent clones.
- Before ending a session: `git status` must show no untracked ` 2.` / backup junk.

## Local runbook (macOS dev machine)

- **Fast proof (no setup):** `npm run smoke` — boots the real app on embedded Postgres and
  drives the full POS lifecycle. Local Postgres 15 also available:
  `export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"`.
- **Real-stack e2e** (mocks OFF requires a PRODUCTION build — `npm run dev` ALWAYS mocks):
  1. `pg_ctl -D /opt/homebrew/var/postgresql@15 start && createdb finder_e2e`
  2. Backend: `DATABASE_URL=postgresql://$USER@localhost:5432/finder_e2e JWT_SECRET=<any> PORT=3001 npx tsx src/server.ts`
  3. Seed: same `DATABASE_URL` + `ALLOW_E2E_SEED=1 npx tsx scripts/seed-e2e.ts` (guard requires the opt-in)
  4. Frontend: `cd web && NEXT_PUBLIC_MOCK=false npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && PORT=3000 BACKEND_URL=http://localhost:3001 node .next/standalone/server.js`
  5. `cd web && npx playwright test`
  6. Afterwards stop servers and `pg_ctl -D /opt/homebrew/var/postgresql@15 stop`.

## Handoff protocol (every session, no exceptions)

1. Update live state (`WORK/WORK_STATE.md` until it's consolidated): what was done, next 3 actions, blockers.
2. New verification results → new audit `WORK/audits/AUDIT_<UTC-ISO-timestamp>-<short-slug>.md`
   (collision-proof — never the next-free-letter); never edit old audits.
3. Working tree clean, no stray root files, no leftover worktrees/branches, servers stopped.
4. Commit and push. Report honestly what passed AND what failed, with the status labels above.

## Hard rules

- Never write secrets (VERCEL_TOKEN, keys, tokens) into any file.
- Never reference competitor POS/ERP brand names anywhere.
- Conventional commits; typecheck + tests must pass before committing.
- Product specs live in `docs/` and `contracts/` — do not duplicate them into WORK/.
- Clean up after yourself: no stray files at repo root, no leftover worktrees/branches.
