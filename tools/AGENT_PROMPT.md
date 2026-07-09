# Ascend — Coordination Prompt for AI Agents

Paste this to any AI agent/session (Claude, Codex, etc.) joining **finder-pos**. Multiple
sessions work this repo at once; duplicate files and duplicate *work* (two sessions building
the same thing) have wasted real effort. The board below prevents it. Follow exactly.

## The board = GitHub Issues (free, git-native)
The queue and coordination live in **GitHub Issues** on `Sricharangellu/Ascend`, not in a
file. Lanes are labels: `lane:ready` → `lane:in-progress` → `lane:in-review` → (closed = done),
plus `lane:blocked`. Kinds: `kind:retail-core`, `kind:security`, `kind:infra`, `sri-only`.
"Update the board" and "check the git commits" are the same system: issues ↔ branches ↔ PRs ↔
commits. (A visual Projects v2 kanban can layer on top once the owner grants the `project`
scope — the process below works with plain Issues today.)

## 1. Orient (check the board + git before doing anything)
```bash
git pull --ff-only origin master                 # never force-push, never rebase master
gh issue list --repo Sricharangellu/Ascend --label lane:ready         # what's pickable
gh issue list --repo Sricharangellu/Ascend --label lane:in-progress   # what's already claimed
gh pr list  --repo Sricharangellu/Ascend                              # what's mid-review
```
Read `AGENTS.md` (operating prompt) and `WORK/FORWARD_PLAN.md` for the deeper rules/spec.

## 2. Pick + CLAIM a card (atomic — this replaces WORK/LOCK.md)
Choose the top `lane:ready` issue with **no assignee**, then claim it in one step:
```bash
gh issue edit <n> --repo Sricharangellu/Ascend \
  --add-assignee @me --remove-label lane:ready --add-label lane:in-progress
gh issue comment <n> --body "Claimed. Files/area: <list>. Starting now."
```
If it already has an assignee or is `lane:in-progress`, pick a different card — never work a
claimed one in parallel.

## 3. Prove it doesn't already exist (before building)
```bash
gh issue list --repo Sricharangellu/Ascend --search "<keywords>" --state all
git grep -ni "<feature-or-route-name>" origin/master ; ls src/modules/
```
If it exists, EXTEND it — never build a parallel version. (e.g. `retail-proof` already lives
in `src/modules/reports/`.)

## 4. Work in isolation
- `tools/new-worktree.sh issue-<n>` → work in `../finder-wt-issue-<n>` on branch `wt/issue-<n>`.
  Never make a second `git clone`.

## 5. Gates — all pass before you move to review
- Backend: `npm run typecheck && npm test && npm run smoke`
- Frontend: `cd web && npm run typecheck && npm run lint && npm test && npm run build`
- Hygiene: `node tools/hygiene-check.mjs`
- `npm run dev` ALWAYS mocks — never cite it as proof of real-backend wiring.

## 6. Land via PR (master is PR-protected once enabled — no direct pushes)
```bash
git commit -m "feat(<scope>): …" -m "Closes #<n>"       # 'Closes #<n>' auto-closes the card
git push -u origin wt/issue-<n>
gh pr create --fill                                       # links the issue
gh issue edit <n> --remove-label lane:in-progress --add-label lane:in-review
# CI green:
gh pr merge --auto --squash --delete-branch              # merge closes #<n> -> card done
git worktree remove ../finder-wt-issue-<n>
```

## 7. Honest status labels (in code/docs/PRs)
`built_verified` · `built_unverified` · `partial` · `mocked` · `planned` · `missing`. A feature
is `built_verified` only with: real backend endpoint, DB persistence, tenant isolation, RBAC,
audit where appropriate, frontend wired to the real backend in production mode,
loading/empty/error/success states, tests, no production dependency on mocks/fake auth.

## 8. Non-negotiable rules
- Money in integer **cents**; tenant-scope every business query; RBAC on sensitive routes;
  inventory changes only via immutable movement records.
- One `AGENTS.md`, one `WORK/FORWARD_PLAN.md`. Never create `CLAUDE.md`/`ROADMAP.md`/`RULES.md`/
  `WORK_STATE.md`/`PROJECT_PLAN.md` duplicates or `* 2.*` copies.
- Never write secrets into any file. Never reference competitor POS/ERP brand names.
- Retail-first: harden the core retail flow first. Mock-backed prefixes (`/documents`, `/golf`,
  `/pricing`, `/warehouse`, `/promotions` subresources) are not production-ready yet (see the
  in-progress board card).

## 9. If blocked or done
- Blocked: `gh issue edit <n> --remove-label lane:in-progress --add-label lane:blocked` +
  comment why. Don't leave a silent claim.
- Handoff report: what changed · files · what was verified · what remains/risky.
