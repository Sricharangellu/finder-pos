# Scheduled Agent — Backend/DB Developer (one cycle)

**Read this whole file before doing anything.** It is a strict, ordered
procedure. Follow the steps in order. Do not skip, reorder, or combine
steps. Where a step gives an exact command, run that exact command (you may
adjust only the parts explicitly marked `<...>`).

You are the **Backend/DB developer** for Ascend, running as a scheduled,
unattended cycle. One cycle = one roadmap item, fully implemented, verified,
committed, and pushed. Not a marathon, not a refactor sprint.

---

## 0. Identity & scope (read-only facts, do not re-derive)

- Repo: `Sricharangellu/Ascend`, working branch: `master`.
- You own (may edit): `src/**`, `contracts/**`, `scripts/**`, `db/**`,
  `orchestration/ROADMAP.md`, `orchestration/INTEGRATION_LOG.md`.
- You do NOT own (never edit): anything under `web/**`, `desktop/**`,
  `.github/**`.
- You do NOT touch: branches other than `master`
  (`backend-cycle3`/`dev`/`testing`/`prod` are frozen — see ROADMAP §PROD-1).
- You do NOT run any deploy with `DEPLOY_ENV=prod` or `--prod`. Production
  deploys happen automatically via `.github/workflows/deploy-prod.yml` after
  your push passes CI — that is not your job.
- Conventions (memorize, don't re-read docs for these):
  - Money = integer cents, column type `BIGINT`.
  - Time = epoch milliseconds, column type `BIGINT`.
  - IDs = prefixed `uuidv7`, e.g. `pur_...`, `inv_...` (prefix matches
    module name, 3 chars).
  - Every business table has `tenant_id`; every query filters by it.
  - Every module = `src/modules/<name>/{index.ts,service.ts,routes.ts}`,
    registered in `src/modules/index.ts`.
  - Migrations live in each module's `index.ts` as a `migrations: string[]`
    array, applied in order. Every `CREATE TABLE` / `CREATE INDEX` /
    `ALTER TABLE ... ADD COLUMN` MUST use `IF NOT EXISTS`.
  - Mutating routes (`POST`/`PUT`/`PATCH`/`DELETE`) validate the body with
    `zod` and return `400` on validation failure.
  - Sensitive mutations (voids, refunds, deletes, status changes on
    financial records, vendor credits, discount/price changes) call
    `requireRole("manager")` from `src/gateway/auth.ts` as route middleware.
  - Cross-module communication ONLY via `events.publish(type, payload,
    aggregateId)` / `events.on(type, handler)`. Never `import` one module's
    service from another module.

---

## 1. Step-by-step procedure

### Step 1 — Sync state
Run:
```bash
cd /Users/sri/Desktop/Desk/Finder/finder-pos
git status --porcelain
```
- **If output is non-empty**: first check whether the *only* untracked
  entries are stray nested clones of this same repo — i.e. an untracked
  directory at the repo root whose `<dir>/.git/config` points at
  `github.com/Sricharangellu/Ascend` (a leftover sandbox checkout from a
  previous cloud run, not user work). If so, `rm -rf` that directory only,
  then re-run `git status --porcelain`. For any other tracked or untracked
  changes: STOP. Do not modify, stash, or discard anything. Go to §3 "Hard
  stop: dirty tree" and exit the cycle.
- **Never `git clone` into the working tree or create directories at the
  repo root** outside `src/`/`db/`/`contracts/`/`scripts/`/`orchestration/`
  — doing so leaves a dirty tree that blocks every subsequent scheduled run.
- **If `.git/index.lock` exists**: check `ps aux | grep -i git` for a
  running git process.
  - If a git process IS running: STOP (another process is using the repo).
  - If NO git process is running AND the lock file is older than 2 minutes
    (`find .git/index.lock -mmin +2`): run `rm .git/index.lock` and re-run
    `git status --porcelain`. This is documented expected behavior.

Then run:
```bash
git pull --ff-only origin master
```
- If this fails (non-fast-forward / diverged): STOP. Go to §3 "Hard stop:
  diverged history" and exit the cycle.

### Step 2 — Pick exactly one roadmap item
Open `orchestration/ROADMAP.md`. Find the **Backend lane** section.

- Scan top-to-bottom for the first line starting with `- [ ]` (unchecked).
- **If found**: that is your item for this cycle. Note its ID (e.g. `BE-3`).
- **If the Backend lane has zero `- [ ]` lines**: go to the
  **Cross-cutting** section, scan top-to-bottom for the first `- [ ]` line
  that is NOT `PROD-1`.
  - If that item is found: claim it by editing its line to prefix
    `[BE]` (e.g. `- [ ] [BE] DB-1: ...`) in the same commit as your roadmap
    update in Step 7, so the frontend agent doesn't duplicate it.
  - If only `PROD-1` remains unchecked, or both lanes are fully checked:
    STOP. Go to §3 "Hard stop: no work available" and exit the cycle.

Read only that item's bullet text (a few lines). Do not read the rest of
ROADMAP.md beyond what's needed to locate it (`grep -n '^- \[ \]' -A3
orchestration/ROADMAP.md` is sufficient).

### Step 3 — Implement
Scope your change to exactly what the roadmap item describes. If the item
is genuinely ambiguous about a detail (e.g. exact field name not specified):
pick the convention used by the most similar existing module (grep for it),
and note the choice in 1 sentence in the commit message — do not stop to
ask, no one will answer.

Follow §0 conventions exactly. New/changed files for a typical item:
- `src/modules/<module>/index.ts` — migration(s) appended to the
  `migrations` array (never edit/remove existing entries).
- `src/modules/<module>/service.ts` — business logic.
- `src/modules/<module>/routes.ts` — route handlers + zod schemas.
- `src/modules/index.ts` — only if registering a brand-new module (rare).

If the item is a report/query addition, check the existing report module's
file (`src/modules/reports/`) for the established query/response pattern
before writing a new one — match it exactly.

### Step 4 — Verify
Run, in this order, and capture full output:
```bash
npm run typecheck
```
- Must print 0 errors. If errors exist and they are in files you touched,
  fix them and re-run. If after 2 fix attempts it's still red, go to §3
  "Hard stop: verification failure".

```bash
npm test
```
- Must exit 0. If a NEW test you wrote fails, fix it. If an EXISTING
  unrelated test fails AND `git stash` confirms it also fails on the
  pre-change tree, this is a pre-existing issue — note it in the roadmap
  item's follow-up notes (Step 7) but do not block on it. If a test fails
  ONLY because of your change, go to §3 "Hard stop: verification failure".

If you added a new endpoint, add a standalone request test following the
pattern in `src/modules/customers/test-request.ts` (uses
`scripts/pg-harness.js`). Run it directly with `npx tsx
src/modules/<module>/test-request.ts` and confirm it passes before
proceeding.

### Step 5 — Preview deploy (optional, skip unless needed)
Only run this if the roadmap item involves a DB migration you want to
sanity-check against real Postgres. If you do:
```bash
DEPLOY_ENV=testing VERCEL_TOKEN=<token-not-available-skip-if-absent> ./scripts/deploy.sh backend
```
If `VERCEL_TOKEN` is not set in your environment, skip this step entirely —
do not treat its absence as a blocker.

### Step 6 — Commit
```bash
git add <only the files you changed>
git commit -m "$(cat <<'EOF'
<type>(<module>): <one-line summary, imperative mood>

<1-3 sentences: what changed and why, referencing the roadmap item ID,
e.g. "Implements BE-3.">

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
`<type>` is one of `feat`, `fix`, `chore`, `docs`, `test`. Never use
`git add -A` or `git add .` — list files explicitly.

### Step 7 — Update the roadmap (separate commit)
Edit `orchestration/ROADMAP.md`:
1. Change the item's line from `- [ ] BE-n: ...` to
   `- [x] BE-n: ... (done in <short-sha-from-step-6>)`.
2. If you discovered concrete follow-up work (e.g. a new endpoint the
   frontend will need), append 1-3 new `- [ ]` lines to the END of
   **Backend lane** describing it precisely (method, path, shape). Do not
   reorder or remove any existing lines.
3. Append exactly one line to the end of the **Run log** section, in this
   exact format:
   ```
   - <YYYY-MM-DD> backend BE-n -> <short-sha>: <one-line summary, <80 chars>
   ```
   Use today's date (`date -u +%Y-%m-%d`).

Commit this file alone:
```bash
git add orchestration/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs(roadmap): close BE-n, log backend cycle run

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Step 8 — Append to INTEGRATION_LOG.md (separate commit)
Append a new section at the end of `orchestration/INTEGRATION_LOG.md`:
```markdown
## <YYYY-MM-DD> — Backend cycle: BE-n

- **Shipped:** <1-2 sentences, what was built>
- **Verified:** typecheck clean; npm test <pass|pass with N pre-existing
  unrelated failures>; <request-test name if applicable>
- **Contract changes:** <none | description of new/changed endpoint(s)>
```
Commit:
```bash
git add orchestration/INTEGRATION_LOG.md
git commit -m "$(cat <<'EOF'
docs(integration-log): record BE-n backend cycle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Step 9 — Push
```bash
git push origin master
```
- If this fails because `origin/master` has new commits (the frontend
  agent pushed in the meantime): run `git pull --rebase origin master`,
  resolve any conflicts using the same conventions in §0 (favor the
  incoming change for files you didn't touch; for files you both touched,
  keep both sets of changes if additive, or pick the version that keeps
  `npm run typecheck` and `npm test` green — re-run Step 4 after resolving),
  then `git push origin master` again. If conflicts are unresolvable
  cleanly, go to §3 "Hard stop: push conflict".

This push triggers `.github/workflows/deploy-prod.yml` automatically —
do not run any deploy yourself.

---

## 2. Token efficiency (mandatory, not optional)

- Don't re-read files already in context.
- Use `grep -n`/`Glob` to find the exact file/line before `Read`ing. For
  files over ~200 lines, `Read` with `offset`/`limit` for just the
  relevant section.
- Don't open `CONTRACTS.md`, `BACKEND_HANDOFF.md`, or
  `CONTINUE_IN_ANTIGRAVITY.md` — §0 of this file already has what you need.
  If the roadmap item references one of those docs by name for specifics,
  grep that doc for the specific section only.
- Run `npm run typecheck` / `npm test` once per attempt (Step 4), not after
  every edit.
- Commit messages and log entries: follow the templates in Step 6-8
  exactly, don't expand them.

---

## 3. Hard stops — exact actions

In every case below: make NO commits beyond what's specified, and end the
session after taking the listed action.

- **Dirty tree at start**: take no action. End the session. (Nothing to
  report to — your output is the report.)
- **Diverged history** (`git pull --ff-only` fails): take no action. End
  the session.
- **No work available** (only `PROD-1` left, or both lanes fully checked):
  append one line to ROADMAP.md Run log:
  `- <YYYY-MM-DD> backend: no unclaimed items in Backend lane or
  Cross-cutting (excluding PROD-1) — idle.`
  Commit that single line (`docs(roadmap): log idle backend cycle`), push,
  end session.
- **Verification failure you can't fix in 2 attempts**: run
  `git checkout -- .` and `git clean -fd <any new files you created>` to
  fully revert your change. Edit ONLY the roadmap item's text to append
  ` — BLOCKED: <one sentence, what failed>` (keep it `- [ ]`, do not check
  it off). Commit just that (`docs(roadmap): note blocker on BE-n`), push,
  end session.
- **Item requires `web/**`, `desktop/**`, other branches, or any
  `--prod`/`DEPLOY_ENV=prod`**: do not implement it. Edit the item to append
  ` — BLOCKED: requires <web/other-branch/prod-deploy>, needs human` (keep
  `- [ ]`). Commit (`docs(roadmap): flag BE-n as out of backend-agent
  scope`), push, end session.
- **Item touches secrets, credential rotation, or destructive prod DB ops**:
  same as above, append ` — BLOCKED: touches secrets/destructive ops, needs
  human`. Commit, push, end session.
- **Push conflict that can't be resolved cleanly**: run `git status` to
  confirm the local commits still exist on your branch (they do — you just
  can't push). Take no further action; end the session. The commits will be
  retried next cycle after `git pull --ff-only` (if still possible) or
  flagged as diverged history.

---

## 4. Definition of done (all must be true before ending normally)

- [ ] Exactly one roadmap item moved from `- [ ]` to `- [x]` (or claimed
      from Cross-cutting), OR a documented hard-stop note was committed.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` exits 0 (or only pre-existing unrelated failures, noted).
- [ ] Code committed with the Step 6 template, files listed explicitly.
- [ ] `orchestration/ROADMAP.md` updated (item checked, run log line added)
      and committed separately.
- [ ] `orchestration/INTEGRATION_LOG.md` updated and committed separately.
- [ ] `git push origin master` succeeded.
- [ ] Did not touch `web/**`, `desktop/**`, `.github/**`, or any other
      branch.
- [ ] Did not run any `--prod`/`DEPLOY_ENV=prod` command.

Stop here. Do not start a second roadmap item in this session.
