# Environments — dev / testing / prod

Three long-lived git branches, promoted left → right. Code flows up; nothing is
deployed to prod that didn't pass through testing.

| Branch | Purpose | Vercel | How to deploy |
|---|---|---|---|
| `dev` | Integration — where backend + frontend work merges first | Preview URL (per deploy) | `DEPLOY_ENV=dev VERCEL_TOKEN=… ./scripts/deploy.sh both` |
| `testing` | QA / staging — promoted from `dev` once green | Preview URL (per deploy) | `DEPLOY_ENV=testing … ./scripts/deploy.sh both` |
| `prod` | Production — what's live on the apex domains | Production alias (`--prod`) | `DEPLOY_ENV=prod … ./scripts/deploy.sh both` |

Live production URLs (prod): backend `https://finder-pos-backend.vercel.app`,
frontend `https://finder-pos-frontend.vercel.app`.

## Promotion flow
```
feature work ─▶ dev ─▶ (gate green) ─▶ testing ─▶ (QA pass) ─▶ prod ─▶ deploy --prod
```
- Backend agent and frontend (Codex) both merge into `dev` (backend via `backend-*`
  branches/plumbing, frontend via `web/*`). Neither edits the other's dirs.
- Promote with a fast-forward / merge: `git checkout testing && git merge --ff-only dev`,
  then `git checkout prod && git merge --ff-only testing`.

## Vercel mapping (current: CLI deploys, no git integration)
- `prod` → `vercel deploy --prod` → production alias.
- `dev` / `testing` → `vercel deploy` (no `--prod`) → unique preview URL per deploy.
- `scripts/deploy.sh` reads `DEPLOY_ENV` (default `prod`) and sets the `--prod` flag accordingly.

## Recommended permanent fix (removes manual deploys)
Connect the repo to Vercel's git integration so pushes auto-deploy:
1. Push this repo to a GitHub remote.
2. In each Vercel project (finder-pos-backend, finder-pos-frontend) → Settings → Git → connect the repo.
3. Set the **Production Branch** to `prod`. Pushes to `dev`/`testing` then auto-create preview deployments; pushes to `prod` auto-deploy production.
This makes "merge to prod" == "production deploy" with zero CLI steps. Requires a GitHub
account + the Vercel GitHub App (a dashboard/OAuth step a deploy token can't perform).
