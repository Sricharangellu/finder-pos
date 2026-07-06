# Finder — Coordination Prompt for AI Agents

Paste this to any AI agent/session (Claude, Codex, etc.) joining **finder-pos**. Multiple
sessions work this repo at once; these steps exist because duplicate files and duplicate
*work* (two sessions building the same thing) have repeatedly wasted effort. Follow exactly.

## 1. Orient before touching anything
- Read, in order: `AGENTS.md` (the operating prompt) → `WORK/FORWARD_PLAN.md` (the queue) →
  `WORK/LOCK.md` (active claims) → newest `WORK/audits/` if you need verified history.
- `git pull --ff-only origin master`. If it refuses, STOP and reconcile — never force-push,
  never rebase `master`.

## 2. Work in isolation — do not share the primary checkout
- Create your own worktree: `tools/new-worktree.sh <task-slug>` → work in
  `../finder-wt-<slug>` on your own branch. Never make a second `git clone`.
- If you must use the shared checkout, run ONE session at a time.

## 3. Claim before editing (WORK/LOCK.md)
- If the board is `FREE` (or your files don't overlap an ACTIVE claim), add an ACTIVE claim:
  session name, queue item, **exact files/areas**, start time. Release (set `FREE`) only
  after commit + push succeed.
- If your intended files overlap an ACTIVE claim, STOP. Pick a non-overlapping item or wait.
  Editing a file another session is on is what causes the collisions.

## 4. Before building ANYTHING, prove it doesn't already exist
- `git grep -ni "<feature-or-route-name>" origin/master` and scan `src/modules/`.
- If it exists, EXTEND it — never build a parallel version. (Real example: `retail-proof`
  already lives in `src/modules/reports/`; don't rebuild it in another module.)

## 5. Gates — all must pass before you claim "done"
- Backend: `npm run typecheck && npm test && npm run smoke`
- Frontend: `cd web && npm run typecheck && npm run lint && npm test && npm run build`
- Hygiene: `node tools/hygiene-check.mjs`
- Real-backend proof needs a PRODUCTION build (`NEXT_PUBLIC_MOCK=false`); `npm run dev`
  ALWAYS mocks — never cite it as proof.

## 6. Land via Pull Request (master is PR-protected — no direct pushes)
1. `git switch -c <type>/<scope>-<slug>` (conventional: feat/fix/chore/docs/ci/test).
2. Commit small, scoped, explicit file paths (never `git add -A`).
3. `git push -u origin <branch>` → `gh pr create --fill`.
4. CI green → `gh pr merge --auto --squash --delete-branch`.
5. Clean up your worktree/branch: `git worktree remove …` / branch auto-deletes.

## 7. Honest status labels (required)
`built_verified` · `built_unverified` · `partial` · `mocked` · `planned` · `missing`.
Never call something done without one. A feature is `built_verified` only with: real backend
endpoint, DB persistence, tenant isolation, permission checks, audit where appropriate,
frontend wired to the real backend in production mode, loading/empty/error/success states,
tests, and no production dependency on mocks/fake auth.

## 8. Non-negotiable rules
- Money in integer **cents**. Tenant-scope every business query. RBAC on sensitive routes.
  Inventory changes only via immutable movement records.
- One `AGENTS.md`, one `WORK/FORWARD_PLAN.md`. Never create `CLAUDE.md`/`ROADMAP.md`/
  `RULES.md`/`WORK_STATE.md`/`PROJECT_PLAN.md` duplicates or `* 2.*` copies.
- Never write secrets into any file. Never reference competitor POS/ERP brand names.
- Product is **retail-first**: harden the core retail flow before adding vertical depth.
  Mock-backed prefixes (`/promotions` subresources, `/documents`, `/golf`, `/pricing`,
  `/warehouse`) are not production-ready until real backends exist.

## 9. Open handoffs (do these when you own the area)
- **CI owner of `.github/workflows/ci.yml`:** add a guard step `run: node tools/hygiene-check.mjs`.
- Report honestly at handoff: what changed, files, what was verified, what remains/risky.
