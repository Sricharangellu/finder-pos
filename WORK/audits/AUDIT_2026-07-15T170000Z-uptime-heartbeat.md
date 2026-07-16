# Audit — C-4 first slice: scheduled production heartbeat (session D)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode)
Branch: `feat/delivery-pipeline`
Files: NEW `.github/workflows/uptime.yml`

## Origin

Standing critical C-4: no alerting between deploys — ci.yml's smoke runs only
ON deploy, so an outage at any other time is invisible until someone looks.

## What was done

New scheduled workflow (every 15 min + manual dispatch) probing production,
mirroring ci.yml's post-deploy smoke checks:
- `/healthz` (backend liveness)
- `/readyz` (backend readiness incl. DB connectivity)
- `/api/v1/flags` unauthenticated must return 401 (auth boundary — also
  catches accidental auth-gate removal)
- frontend root 200

Failure → red workflow run → GitHub notifies repo watchers. `permissions:
contents: none`, 5-min timeout, concurrency-capped. Zero new accounts or
secrets.

## Delivery standard

- **Architecture impact**: none (CI-only).
- **Database impact**: none.
- **Testing evidence**: YAML validated (js-yaml). All four probes executed
  live against production from this session and passed (healthz ok
  version=44d07ec, readyz db:connected, flags 401, frontend 200).
  The scheduled run itself activates only once this lands on the default
  branch (GitHub runs cron workflows from the default branch only) —
  labelled built_verified for the probes, pending-activation for the cron.
- **Security impact**: none negative; heartbeat asserts the auth boundary.
- **Rollback**: delete the workflow file.
- **Monitoring/alerting needs**: this IS the first monitoring slice. C-4 is
  NOT fully closed: notification fan-out (Slack/PagerDuty/Sentry cron
  monitors) and latency/error-rate alerting remain a Sri decision.
  GitHub notification settings determine who actually gets pinged —
  Sri should confirm watch settings on the repo.
