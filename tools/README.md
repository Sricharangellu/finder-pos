# tools/ — repo-hygiene & collision-prevention

Small, dependency-free tools that make the "no duplicate files / no colliding
sessions" rules *structural* instead of relying on vigilance. Background: multiple
AI sessions sharing one working tree and pushing directly to `master` have
repeatedly produced duplicate files and duplicate *work* (two sessions building the
same endpoint). These tools address the mechanical causes.

## `hygiene-check.mjs` — fail-fast on duplicate/junk files

```bash
node tools/hygiene-check.mjs
```

Exits non-zero if the tree contains a numeric copy file (`AGENTS 2.md`), a
`*.collision-backup.md`, a merge leftover (`*.orig` / `*.rej`), or more than one
`AGENTS.md`. Run it locally before committing.

**Wire into CI** (owner of `.github/workflows/ci.yml`, add one step to the guard job):

```yaml
      - name: Repo hygiene
        run: node tools/hygiene-check.mjs
```

**Optional pre-commit hook** (`.git/hooks/pre-commit`, `chmod +x`):

```bash
#!/usr/bin/env bash
node tools/hygiene-check.mjs || exit 1
```

## `prevention-agent.mjs` — fail-fast on dirty drift

```bash
npm run prevent:drift
```

This stricter guard blocks the local patterns that create unrelated dirty code:

- tracked edits/deletions left in the working tree;
- generated design-sync folders such as `.design-sync/`, `.ds-sync/`, `ds-bundle/`;
- untracked source modules under `src/modules/`;
- obsolete duplicate planning/instruction files such as `CLAUDE.md`, `WORK/RULES.md`,
  `WORK/WORK_STATE.md`, `web/PROJECT_PLAN.md`, and `web/WORK_STATE.md`;
- numeric copy files such as `Report 2.md`.

Run this before opening a PR or handing off a session. CI also runs it in the guard job.

## `new-worktree.sh` — one isolated checkout per session

```bash
tools/new-worktree.sh expenses-mvp
```

Creates `../finder-wt-expenses-mvp` on a fresh branch off `origin/master`. Use this
(or run sessions one at a time) so parallel work does not share the primary tree —
the single biggest source of the collisions. **Never make a second clone**; a
worktree shares one object store, a clone diverges.

## Sri-only: turn on PR protection (ends direct-to-master racing)

The deepest fix is that no session pushes to `master` directly — every change goes
through a short-lived branch + PR, so conflicts surface *before* landing. Enable it
once (GitHub Settings → Branches → `master`), or via API:

```bash
gh api -X PUT repos/Sricharangellu/Ascend/branches/master/protection \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F 'required_status_checks.contexts[]=Backend' \
  -F 'required_status_checks.contexts[]=Frontend' \
  -F 'required_status_checks.contexts[]=Production guard' \
  -F 'required_status_checks.contexts[]=E2E' \
  -F required_status_checks.strict=true \
  -F enforce_admins=false -F restrictions=
```

Also enable Settings → General → "Allow squash merging" only + "Automatically
delete head branches". After that, every session follows: branch → PR →
`gh pr merge --auto --squash --delete-branch` (see `AGENTS.md` "Git: where and how").
