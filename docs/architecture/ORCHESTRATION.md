# Ascend — Orchestration: Workflows, Plans, Agents, Skills

Single source of truth for how work actually gets done on this repo — who
does what, in what order, with what authority. Consolidates the former
`orchestration/AGENT_BACKEND_CYCLE.md` + `AGENT_FRONTEND_CYCLE.md` +
`ENGINEERING_ORG.md`'s role-routing + the standing session directives into
one file. Those are archived under `_archive/`.

**Live state stays live** — this file is the static protocol/reference.
`WORK/LOOP_STATE.md` (heartbeat, backlog, iteration log) and `WORK/LOCK.md`
(active claims) are the dynamic, currently-updated trackers; always re-read
those directly for current status, never assume this file reflects "right
now."

## Final authority

**Sri approves. Merge to `master` = approval = production deploy. No agent
merges to `master` without Sri's explicit word, every time — a green CI run
is necessary, never sufficient, and prior approval does not carry forward to
a later merge.**

Standing rules, reconfirmed repeatedly and never bypassed:
- No direct merge to `master` without Sri's explicit command, structurally
  enforced via branch protection (`enforce_admins: true` on `master`).
- Branch **from `develop`**, not `master`, for new work. Promotion is
  forward-only: `feature/* → develop → staging → master`.
- Delete merged branches other than `master`/`staging`/`develop` once
  they're merged and pushed — keep the branch list to live work only.
- Never force-push, never disable a check to reach green, never guess-patch
  a red run.

## The 3-tier pipeline (as actually implemented)

```
feature/*  ──PR──▶  develop   → deploy to DEV (own DB where configured)
develop    ──PR──▶  staging   → deploy to TESTING (own DB, Supabase B)
staging    ──PR──▶  master    → deploy to PROD (Sri's explicit go-ahead only)
```

- Hosting: frontend on Vercel; production backend on Render (persistent process, real background
  workers, no cold starts) as of this session — `develop`/`staging` backend
  hosting is a live open item, not yet reconciled to match. **Unconfirmed as of 2026-07-23** (see
  `PIPELINE.md`'s "Re-verification" note) — `scripts/deploy.sh` itself documents these Vercel
  projects as NOT git-connected (manual CLI deploy only, which is what `ci.yml` actually runs), and
  no Render deploy path exists in code for either frontend or backend. Confirm the real hosting
  origin before relying on this line.
- Database: Supabase Postgres. Production and testing tiers use separate
  projects; each tier's `DATABASE_URL`/`PG_CA_CERT_B64` are environment
  secrets, never hardcoded.
- CI (`.github/workflows/ci.yml`): guard → backend typecheck+test → frontend
  typecheck+lint+build → E2E (signal only, not a hard gate — known
  auth-rotation timing flake) → deploy job per tier, gated by an `if` check
  on the relevant repo variable being set (fails inert, not broken, when
  unconfigured).
- Full gates before any merge: `npx tsc --noEmit` clean, isolated real-PG
  tests for every touched module (single-file runs are authoritative — the
  full parallel suite has known flakiness, see `DESIGN_PRINCIPLES.md`),
  `npm run smoke` 20/20, frontend typecheck/lint/build when touched.

## Role → tool routing

| Role | How it's actually performed |
|---|---|
| CTO Architect | `ascend-cto` skill (doctrine, tradeoffs, never-lists) |
| Principal Architect | module boundaries in `src/modules/*` + design docs; reject circular deps/hidden coupling in review |
| Engineering Manager | task shaping with acceptance criteria; `WORK/FORWARD_PLAN.md` is the queue |
| Domain agents (sales, inventory, accounting…) | the module owning the data — change lands in that module's service/routes/tests; accounting has veto on financial correctness |
| Database agent | migrations hash-tracked in-code + canonical SQL in `db/migrations` (+ down scripts); tenant-leading indexes; review every schema change for both paths |
| Security agent | security review pass + standing checklist (secrets, rotation, rate limits, TLS, audit); `requireCapability`/`requireRole` on every new route — verify the auth middleware is actually mounted, not just referenced in a comment |
| Infrastructure agent | Vercel (frontend) + Render (prod backend) + Supabase; changes via `scripts/deploy.sh` / dashboard, never ad hoc |
| Frontend/UX | design-system consistency; capability-gated rendering (four-layer model: tenant module → tenant route → user feature → partial/preview) |
| QA agent | every mutation route needs a test; suite must stay green on real PG |
| Observability agent | pino structured logs + redaction, `/metrics`, trace ids; alerting is an open critical (C-4, see `GAPS.md`) |

## Decision protocol (proposal → review → approval)

Major change = new dependency, schema change, cross-module contract,
security posture, anything touching money. For these:

1. **Proposal** — Problem / Solution / Alternatives / Impact / Risk.
2. **Review lenses** — pass the change through: *Architect* (coupling?
   boundary violation?), *Security* (authz? tenant scope? secrets?),
   *Database* (migration safety? index? both migration paths?), *QA* (what
   test proves it?). A solo session running all four lenses beats skipping
   them.
3. **Approval** — Sri merges (to `master`). CI green is necessary, never
   sufficient.

Conflicts between agents/sessions resolve in charter order: business impact
→ reliability → simplicity → cost → future flexibility. The session with the
LOCK claim or the committed work owns the area; later arrivals adapt.

## Concurrency protocol (multiple sessions, one shared repo)

- Never `git add -A` — stage only files you authored.
- Build anything you'll commit in an isolated `git worktree` off the target
  base branch; cherry-pick/PR from there.
- Claim work in `WORK/LOCK.md` before starting (session + exact files +
  explicit NOT-list); release with gates evidence when done.
- Treat files another session is touching as owned — coordinate, don't
  collide. If a file you need enters another session's claim mid-flight,
  back off and pick a different task.
- Before trusting an old PR/branch as still relevant: check whether its
  content already landed independently. This session found real duplicate
  work three separate times (stale PRs proposing already-shipped features,
  and one PR reintroducing infrastructure that had been deliberately
  retired) — always cherry-pick and re-verify against current `staging`,
  never assume a PR is still accurate just because it's open.

## Autonomous loop protocol (pointer)

The full iteration algorithm lives in `WORK/LOOP_PROTOCOL.md` — re-read it
directly before resuming any loop, never work from memory (conversation
context gets summarized; that file does not). Short version: read state →
health-check → select one verified task (never NEEDS-SRI items, never files
in another session's active claim) → claim in `LOCK.md` → implement →
gates → audit note → release claim → commit (files you authored only) →
update `LOOP_STATE.md` → schedule next wake. A stopped/idle loop is success,
not failure — it means the verified backlog is empty pending a human
decision.

Cloud watchdog: notify-only by default (a stale heartbeat gets one push
notification, not an autonomous commit) — unwatched commits to
financial-software code violate the correctness-over-velocity doctrine.
DO-WORK mode exists but requires Sri's explicit opt-in.

## Skills available in this environment

- `ascend-cto` — architecture doctrine, engineering-economics framing for
  any recommendation.
- `ascend-org` — this file's live counterpart; role routing in conversation
  form.
- `debug` — reproduce → trace evidence → fix smallest responsible part →
  verify → explain. Load before any bug fix; don't guess-patch.
- `ci-loop` — check GitHub Actions + Gmail, diagnose via `debug` discipline,
  fix/verify/retry. Never merges to `master`, never force-pushes, never
  disables a check.

## Delivery standard (every implementation reports)

Architecture impact · database impact (both migration paths) · testing
evidence (actual results, not claims) · security impact · rollback note ·
monitoring/alerting needs. If any is "none," say "none" explicitly.
**Built ≠ verified ≠ deployed** — label honestly.
