# Ascend Autonomous Loop — Protocol (v1)

The executable program for the autonomous work loop. Any Claude session (local
or cloud) that runs an iteration MUST re-read this file first — never work from
remembered rules; conversation context gets summarized, this file does not.

Durable state lives in `WORK/LOOP_STATE.md` (heartbeat, backlog, counters).
Sri's authority is absolute: merge to master = approval; anything on the
NEEDS-SRI list is out of scope for the loop.

## Iteration algorithm

1. **Read state**: this file, `WORK/LOOP_STATE.md`, `WORK/LOCK.md` (full —
   other sessions' claims are law), `git log --oneline -10`, `git status`.
2. **Health checks** (any failure → fix that first or stop with notification):
   - Working tree: no unexplained changes to files you didn't author.
   - Review-debt cap: count LOOP-AUTHORED commits since the run began
     (`loop_commits` in LOOP_STATE.md — NOT total branch divergence; this is
     a long-lived integration branch that predates the loop). If
     `loop_commits` ≥ 15 with no intervening Sri merge, STOP and notify —
     unreviewed loop output outranks new work.
3. **Select ONE task**, priority order:
   1. Verified production bugs (evidence: file:line or a failing runtime call).
   2. Security findings (verified, not report-claimed).
   3. Code-addressable standing criticals (C-1..C-4 or successors).
   4. `LOOP_STATE.md` backlog items marked CANDIDATE (verify before building).
   5. FORWARD_PLAN retail-first queue items not claimed by another session.
   NEVER select: NEEDS-SRI items, files inside another session's ACTIVE claim,
   prestige refactors, or anything whose only evidence is an unverified
   external report. Verification before implementation, always — this loop's
   own history includes a "verified gap" that turned out to be already built.
4. **Claim** in `WORK/LOCK.md` (session letter + exact files + explicit
   NOT-list covering other active claims).
5. **Implement** per `docs/architecture/DESIGN_PRINCIPLES.md`. No new
   dependencies without recording the justification in the audit.
6. **Gates** — all must pass before commit: `npx tsc --noEmit` clean; isolated
   real-PG tests for every touched module (single-file runs are authoritative;
   the full parallel suite belongs to CI); `npm run smoke` 20/20. Red gate →
   fix or revert; NEVER commit red.
7. **Audit note** in `WORK/audits/AUDIT_<UTC>Z-<slug>.md` (Delivery Standard:
   architecture/database/testing/security/rollback/monitoring — "none" is a
   valid entry, silence is not).
8. **Release** the LOCK claim (status → RELEASED with gates evidence).
9. **Commit** (stage ONLY files you authored — never `git add -A`; LOCK.md and
   the state file ride along) and **push** to the PR branch.
10. **Update `WORK/LOOP_STATE.md`**: heartbeat timestamp, iteration log line,
    backlog changes, counters. Include it in the iteration's commit.
11. **Schedule next wake** (local runner only — pacing below). The cloud
    watchdog never schedules; it runs at its fixed cadence.

## Pacing (local runner)

- Task shipped → 1200 s.
- Task attempted but blocked → 1800 s; record the blocker in the backlog.
- Nothing selectable (idle) → 3600 s and increment `idle_streak`.
- `idle_streak` ≥ 3 → STOP the loop (ScheduleWakeup stop:true) + notify:
  an empty queue is success, not failure. Reset the streak whenever a task
  ships.

## Failure handling

- **Gate failure**: fix within the iteration or revert; the tree must be
  clean at iteration end either way.
- **Collision** (a file you need enters another session's claim mid-flight):
  back off, release your claim with a note, pick a different task.
- **Usage-limit stall**: nothing to do in-band — the heartbeat goes stale and
  the watchdog covers it. Do not busy-retry.
- **Anything requiring Sri**: add to the NEEDS-SRI list in LOOP_STATE.md,
  notify once (see below), continue with other work.

## Notifications

On STOP, on PR-cap pause, and on discovering a new NEEDS-SRI item, send a
push notification (PushNotification tool) with one sentence: what happened,
where the details are. Never notify per-iteration — signal, not noise.

## Cloud watchdog contract

A scheduled cloud routine is the safety net for local-runner death (laptop
sleep, session close, usage-limit stall). Default mode is **NOTIFY-ONLY** —
deliberately NOT autonomous-commit, because unwatched commits to
financial-software code violate the correctness-over-velocity doctrine.

Each firing:
1. Read `WORK/LOOP_STATE.md` → `loop_status` + `last_iteration_utc`.
2. `loop_status: STOPPED` → exit silently (a stopped loop is deliberate).
3. Heartbeat < 3 h old → local loop alive → exit silently.
4. Heartbeat stale (≥ 3 h) → the local loop is down → send ONE push
   notification ("Ascend loop stalled since <ts> — restart with /loop, or the
   backlog is in WORK/LOOP_STATE.md") and exit. Do not spam: if the last
   firing already notified for this same stall, stay silent.

**Optional upgrade (Sri decision, on NEEDS-SRI):** switch the watchdog to
DO-WORK mode — on a stale heartbeat, run EXACTLY ONE protocol iteration in
the cloud (own session letter, same PR branch, one iteration per firing to
avoid stampede). Gives true unattended continuity at the cost of unreviewed
cloud commits. Not enabled without Sri's explicit go.

## Amending this protocol

The loop may amend this file only to record learned failure modes (append to
the list below), never to weaken gates or expand scope. Scope changes are
Sri's.

Learned failure modes:
- (2026-07-15) External review reports fabricate quotes and miscount — every
  finding needs in-repo verification before it becomes a task.
- (2026-07-15) grep one file ≠ verified absence — the lockout "gap" existed
  only because service.ts wasn't searched.
