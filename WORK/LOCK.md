# FinderPOS — Multi-Agent Work Lock

Status: FREE

## Active Claim

| Field | Value |
|---|---|
| Agent/session | none |
| Queue item | none |
| Files/areas expected | none |
| Started | none |
| Last update | none |
| Status | FREE |
| Blockers | none |

## Rules

- Claim one queue item before editing code.
- Do not work an overlapping queue item while this file is `ACTIVE`.
- If a lock looks stale, mark it `STALE?` and stop for review; do not silently overwrite it.
- Release the lock only after commit and push succeed.
- If blocked, leave the lock active and write the blocker clearly.

## Common Multi-Agent Failure Modes

- One agent verifies against stale code while another has unpushed changes.
- Two agents edit the same tests or routes and one overwrites the other.
- A dev server, backend server, or Postgres instance from another session changes e2e results.
- One agent updates migrations while another tests an older schema.
- A second agent sees failures caused by a dirty tree, not by the application.
