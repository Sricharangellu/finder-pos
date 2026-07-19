# Ascend — Delivery Status & Promotion Runbook (session G)

Last verified: 2026-07-19 evening. The authoritative pipeline definition is
`docs/architecture/PIPELINE.md` (on develop/staging — 3-tier promotion,
"no merge to master without Sri"). This file is the point-in-time status +
runbook for landing the Phase-0 work.

> **Correction (2026-07-19):** an earlier revision of this file said "merge
> PR #70 to master". That was stale — PR #70 was retargeted and merged into
> `staging` under the 3-tier model, carrying only an older 22-commit batch.
> Verified: none of the Phase-0 wave-2 fixes (895aedd, 187adb4, 8e34f41,
> af1f549…) are in staging or master.

## Branch topology (verified against origin)

```text
master   29a27d7  (PR #66, 2026-07-16)  → PROD (Supabase A)
staging  21c11ad  master+51 (incl. PR #70 batch, rebrand #76/#80) → TESTING preview
develop  5cccefd  fully contained in staging (stale by 33)
feat/delivery-pipeline  staging+33  ← ALL Phase-0 bug fixes live only here
```

Merge test: `feat/delivery-pipeline` → `staging` is **conflict-free**
(merge-tree: 0 conflict markers).

## Connectivity status

| Link | Status |
|---|---|
| FE↔BE code, tables, types, hygiene | ✅ all scans clean (gap:scan 444/373/21, table:scan 157/0, tsc 0) |
| Backend PROD → DB | ✅ readyz ok, db:connected |
| Phase-0 fixes → staging | ❌ not there — needs new PR (below) |
| staging → master/PROD | ❌ master last moved 2026-07-16; **prod still has the invoice-500 / dead-quotes / clockIn-orphan bugs** |
| Frontend PROD | ✅ **RESOLVED — was a phantom.** The rebrand (PRs #76/#80) renamed the Vercel projects: backend → `ascend-backend` (ascendhq-api.vercel.app), frontend → `ascend-frontend` (ascendhq-app.vercel.app); project IDs unchanged (see scripts/deploy.sh). ascendhq-app serves real HTML (redirects to /login); the dead finder-pos-frontend.vercel.app is just the old domain unbound by the rename. The git-connected `finder-pos` Vercel project is legacy cruft — candidate for deletion (NEEDS-SRI). |
| web build proof | ✅ CI "Frontend — typecheck + lint + build" PASSED on PR #81 (2026-07-19) — the long-outstanding sandbox limitation is closed |
| CI backend job | ❌→fix queued: PR #81 failed 177/706 tests from Postgres service-container /dev/shm exhaustion (Docker 64MB default; suite now 700+ tests). Fixed by `--shm-size=1g` in ci.yml (both jobs), this commit. NOT an application bug — first failure is a resource error, and the whole suite passes locally/pre-push. |

## Progress log

- 2026-07-19: PR #81 (`feat/delivery-pipeline` → `staging`) MERGED, all checks
  green after the ci.yml shm fix (e0d0035). Verified: staging contains all
  Phase-0 fixes; delivery branch has 0 unique commits left. Release **PR #82**
  (`staging` → `master`, 88 commits) opened — **awaiting Sri's merge** per the
  standing release policy. After merge: prod verify + browser smoke (runbook
  steps 4–5), then back-merge master → staging → develop (step 6).

## Runbook (in order)

1. **Sri, terminal:** `git push origin feat/delivery-pipeline` (picks up the
   queued docs commits).
2. **Browser:** open PR `feat/delivery-pipeline → staging` (NOT master, NOT
   #70 — a new PR). Wait for all CI checks green (that build check is the
   web-build proof). Merge → TESTING preview redeploys.
3. **Browser:** open release PR `staging → master`. **Only Sri merges this**
   (standing rule). Merge → `deploy-production` runs automatically.
4. **Verify PROD:** backend readyz ok/db:connected at the new SHA; frontend
   serves real HTML (the empty-body issue may need the Vercel dashboard:
   check latest production deployment status, env `NEXT_PUBLIC_MOCK=false`,
   `BACKEND_URL=https://finder-pos-backend.vercel.app`, and Deployment
   Protection settings on finder-pos-frontend).
5. **Browser smoke on PROD:** login → products list → create invoice WITH a
   line item (was 500) → create quotation (was dead) → workforce clock-in
   (was orphaning). Each must pass.
6. Back-merge per pipeline doc (`master → staging → develop`) and update
   `WORK/LOOP_STATE.md`.
