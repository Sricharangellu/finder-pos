# ADR-003: Transactional outbox v1 — dual dispatch, durable-consumer redelivery

Date: 2026-07-14 · Status: Accepted (M1.2 evolution planned)

**Context:** In-process bus loses events on crash; the ledger depends on
purchase_order.received / bill.created / bill.paid / payment.captured. A
dormant event_outbox table (identity DB-8) existed with a relay that would
republish rows to ALL subscribers — unsafe for non-idempotent consumers.
**Decision:** Reuse (extend) the existing table with a status state machine.
EventBus persists durable-typed events before dispatch, marks delivered after;
reconciler (boot + 60s) redelivers pending rows ONLY to registered idempotent
durable consumers (ledger postings, auto-bill). Rows are written
dispatched=TRUE so the legacy relay can never claim them.
**Consequences:** Happy path unchanged; crash gap between commit and enqueue
remains until M1.2 moves enqueue inside the business tx and a worker owns
dispatch (legacy relay removed then). Pending/failed rows = queue-health metric.
