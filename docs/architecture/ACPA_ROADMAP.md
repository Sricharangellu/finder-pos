# ACPA — Ascend Commerce Platform Architecture: Transformation Roadmap

Companion to CTO_CHARTER.md and ENGINEERING_ORG.md. Adopted 2026-07-14.
Goal: evolve Ascend toward a ServiceNow-of-Commerce platform **incrementally**,
never rewriting, never breaking business velocity.

## Reconciliation: ACPA phases vs. actual current state (code-verified)

| ACPA Phase | Status in the real codebase |
|---|---|
| 1a Tenant platform | **Exists.** tenant_id on every table, RLS backstop, business units, outlets, store_locations. Gap: none blocking. |
| 1b Identity platform | **Exists.** Users/roles/custom roles/permissions/teams/SSO/API-key scopes. ABAC = future story. |
| 1c Enterprise data model | **Mostly exists.** Product/Customer/Supplier/Order/Invoice/Payment/Ledger/Document(POs)/Workflow/Event are single-owner concepts. Guard: the "no duplicate entities" rule is what the retail-UX audits enforce (e.g. one product editor). |
| 2 Bounded contexts | **Exists** (52 modules, module-owned writes). Amendment: cross-domain SQL *reads* accepted (ENGINEERING_ORG.md ruling). Postgres *schema-per-domain* (identity.*, finance.*) — **REJECTED for now**: 100+ migrations assume one schema per tenant-DB layout; rename churn with zero behavior gain. Revisit only at service extraction. |
| 3 Workflow platform | **Seed exists** (workflows module: definitions/instances; PO approval workflow; SO fulfillment transitions). Next story: unify approval patterns behind one engine — *after* a second approval domain (requisitions) exists to generalize from. |
| 4 Rules engine | **Proto-rules exist** (approval tiers config, margin rules, promotion engine, tax resolution). Story: extract a shared `evaluateRules()` only when a third rule family needs it. |
| 5 Event platform | **The real gap.** In-process bus, sequential dispatch, no persistence → crash loses financial events (Rule 4 violation). **← Migration 1, implemented now.** |
| 6 Extensions | Partial (webhooks w/ signatures, API keys w/ scopes, integrations page). Connector registry is the queued story (ERP gap doc §12). |
| 7 AI foundation | Not started. Depends on 5 (event history) + 3 (actions). Deliberately last. |

## Migration 1 (this commit) — Durable financial events (transactional outbox v1)

**Objective:** financial events must never be lost (Rule 4 / FINANCIAL RULES).
**Current state:** `purchase_order.received`, `bill.created`, `bill.paid`,
`payment.captured` dispatch in-process only; a crash between the business
write and handler completion silently loses ledger postings / auto-bills.
**Proposed change:** an `event_outbox` table + dual dispatch: rows are written
alongside the business operation, the existing synchronous dispatch is
preserved (zero behavior change), rows are marked delivered on success, and a
reconciler (boot + interval) redelivers pending rows **only to registered
durable consumers** (accounting postings, billing auto-bill — both already
idempotent). Non-idempotent consumers (inventory stock increment) are *not*
redelivered — their at-most-once semantics are unchanged from today, no
regression.
**Why not full async now:** moving all consumers async breaks synchronous
consistency tests and needs the worker runtime (scale step 6). Dual dispatch
closes the durability hole first; latency offload follows with the worker.
**Impacted modules:** shared (outbox), accounting, billing, purchasing, app boot.
**Risks:** double-delivery → mitigated by consumer idempotency (hasPosting /
billFromPO existing-check) + delivery marking; reconciler runaway → capped
attempts with backoff.
**Rollback:** revert commit; outbox table is additive.
**Future evolution:** Phase-2 worker consumes the outbox asynchronously →
inventory gains idempotency keys (movements.ref) → all consumers move behind
the outbox → read models (reporting) feed from the same stream.

## Migration 1.2 (shipped) — Serverless job runtime + relay retirement

**Objective:** background work must actually run in prod (critical C-2 — the
in-process `setInterval` pollers freeze between serverless invocations), and
the double-dispatch hazard (DB-8 relay republishing to non-idempotent
consumers) must be gone, not just fenced off.
**Change:** `GET /jobs/tick` — an infra endpoint (CRON_SECRET bearer,
`/metrics`-style guard: 503 when unconfigured in production) that drains due
`job_queue` rows (bounded loop) and runs the outbox reconciler in one call.
Vercel Cron (`vercel.json` crons, `*/5 * * * *`) drives it; Vercel injects the
`Authorization: Bearer ${CRON_SECRET}` header automatically. Long-lived
deploys keep their intervals — overlapping ticks are safe (FOR UPDATE SKIP
LOCKED + idempotent durable consumers). The DB-8 outbox relay job is deleted
and stale self-re-enqueueing `outbox_relay` rows are purged at bootstrap.
**Ops note:** set `CRON_SECRET` in the Vercel project env — without it the
endpoint 503s and background jobs still do not run on serverless.

## Migration 1.3 (shipped) — Stable event identity + all financial consumers durable

**Objective:** every consumer of a financial event survives crash redelivery
without double-applying, and idempotency keys cannot drift between the
synchronous dispatch and a redelivery.
**Bug fixed en route:** the reconciler used to rebuild redelivered events with
`occurredAt` derived from the row's `created_at` — a *different* timestamp
than the original dispatch, which silently broke accounting's
`${docId}:${occurredAt}` idempotency keys in exactly the crash window the
outbox exists for (double-posting). Events now carry a stable `id`
(`evt_…`, uuidv7, assigned once in `EventBus.publish`) and the outbox row IS
the event — same id, same `occurredAt` — so redelivery is byte-identical.
**Consumer migration (all bus consumers of durable financial events):**
- accounting postings — already idempotent (`hasPosting`), keys now stable.
- billing auto-bill — already idempotent (existing-bill check).
- billing AR-invoice on `sales_order.invoiced` — NEW durable; idempotent by
  natural key (one invoice per sales order).
- orders `markCompleted` — NEW durable; naturally idempotent (open→completed).
- inventory receiving — NEW durable; claims the event id first via the new
  `event_consumptions` table (`claimEventOnce`, PK (consumer, event_id)).
- customers loyalty points — NEW durable; same claim-first pattern.
**Claim-first semantics:** at-most-once per (consumer, event) — a crash
between claim and apply loses that consumer's effect, exactly like the
pre-outbox behavior; nothing regresses, double-apply becomes impossible.
Exactly-once (claim inside the consumer's business transaction) is the M1.4
refinement.

## Migration 1.4 (shipped — payments; purchasing deferred) — Staged publish + retention

**Objective:** close the last durability hole — a crash after the business
transaction commits but before `events.publish()` runs loses the event
entirely (no outbox row exists yet).
**Change:** `EventBus.stage(tdb, …)` writes the outbox row INSIDE the
publisher's transaction (atomic with the business writes; rolls back with
them); `EventBus.dispatchStaged(event)` runs the normal synchronous path
after commit. `publish()` is now composed of the same primitives, so staged
and unstaged events behave identically after commit. A daily retention job
purges delivered outbox rows and consumption claims older than 30 days
(pending rows always kept; failed rows parked for review).
**Migrated:** payments.capture (revenue posting / order completion / loyalty
can no longer be lost). **Deferred:** purchasing.receive staging — the
purchasing module is under an active session-A claim (requisitions, E2);
queued as the first follow-up when that claim releases.

## Epic backlog (EM-owned, in order)
1. **E1 Durable events** — M1 ✅ (81dba0d) → M1.2 ✅ (tick runtime + relay removal) → M1.3 ✅ (stable event identity + all-financial-consumer migration + `event_consumptions` claims) → M1.4 ✅ (staged publish: payments; retention sweep) → M1.5 purchasing.receive staging (after E2 claim releases) + claim-inside-consumer-tx (true exactly-once) + operational stock-flow events (order.completed FEFO depletion, order.refunded restock, stock.written_off).
2. **E2 Procurement completion** — requisitions → GRN → 3-way match → GRNI (parked slices; also feeds workflow-engine generalization).
3. **E3 Scale mechanics** — batch bulk ops (step 4), pooling + runtime (step 6), reporting read models.
4. **E4 Workflow/rules generalization** — unify PO+requisition approvals; extract rule evaluation.
5. **E5 Extension platform** — connector registry over webhooks; extension points doc.
6. **E6 AI foundation** — permissioned action layer over modules; only after E1/E4.

**Standing rejections re-affirmed:** microservices, Kafka, K8s, multi-DB,
schema-per-domain rename, low-code engine v1.
