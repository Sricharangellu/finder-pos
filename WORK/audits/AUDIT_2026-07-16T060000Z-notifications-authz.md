# Audit — notifications create guard: completes the authz sweep (loop iter 8)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop iter 8)
Branch: `feat/delivery-pipeline` (PR #70)
Files: `src/modules/notifications/routes.ts` + NEW notifications-authz.test.ts + test-request.ts

## Finding

Final item in the module-wide authz sweep (iters 6–8). `POST /notifications`
was an unguarded mutation: any authenticated cashier could post a spoofed
notification ("System: ...") to the tenant feed — a minor internal
social-engineering vector. Verified the internal path is separate: the module
creates notifications via `service.create()` inside `inventory.adjusted` /
`invoice.overdue` event handlers (index.ts), which bypasses the HTTP route.
The web client never POSTs to this route. So guarding it is safe.

## What was done

- `POST /notifications` → `requireRole("manager")`. mark-read endpoints stay
  open (a user acting on their own tenant feed). Internal event-driven
  creation unaffected (uses the service, not the route).
- NEW notifications-authz.test.ts — first tests for the module: cashier 403 /
  manager 201 on create, cashier can read + mark-all-read, AND an
  inventory.adjusted(available:0) event still creates a low_stock notification
  (proves the guard does not block the internal path).

## Delivery standard

- **Architecture impact**: none.
- **Database impact**: none.
- **Testing evidence**: 2/2 isolated real-PG (first tests for notifications);
  typecheck CLEAN; smoke 20/20.
- **Security impact**: closes the last unguarded mutation found in the sweep.
- **Rollback**: revert commit (guard only).
- **Monitoring**: none new.

## Loop status — winding down

This completes the third and final systematic sweep (drift → pagination →
authz). All three high-value verification sweeps are now exhausted for the
retail-core modules. Remaining backlog is genuinely low-value (docs cleanup,
web error.details adoption) or belongs to sessions B/C / Preview verticals.
Per LOOP_PROTOCOL, the loop should now idle/stop rather than manufacture
make-work. idle_streak set to 1; if the next iterations surface nothing real,
the loop stops cleanly (an empty queue is success).
