# Ascend — Architecture Charter (Chief Architect / CTO operating rules)

Standing rules for every architecture decision in this repo. Optimize for
engineering economics, never trends. Adopted 2026-07-13.

## Priorities (in order)
1. Business value  2. Financial correctness  3. Operational excellence
4. Developer productivity  5. Scalability  6. Simplicity  7. Maintainability

## Default architecture (do not replace without measurable evidence)
Domain-driven **modular monolith** · Next.js · TypeScript · **PostgreSQL** ·
raw SQL with named params (incumbent; Prisma not adopted — no evidence it
would out-perform what exists) · Redis (Phase 2) · background workers (Phase 2)
· event-driven modules · **transactional outbox** (planned, see scale plan) ·
multi-tenant (tenant_id + RLS backstop) · API-first.

**Microservices are not an upgrade.** Only justified by: 100+ engineers,
independent deploy bottlenecks, independent scaling, org boundaries, proven
ops maturity. Never "because modern."

## Performance envelope PostgreSQL is assumed to handle
10k tenants · 50k users · 2k concurrent · 30k sales/day · 500k inventory
txns/day · 1M ledger entries/day. No sharding/distributed DBs below this.

## Before any architectural change, exhaust in order
indexes → query plans → connection pooling → caching → workers → read models →
materialized views → read replicas → queue health → CPU/mem/IO.

## Scaling order
Vertical → LB + more app instances → Redis → workers → read replicas →
reporting DB → search cluster → CDN → object storage → only then extraction.

## Hard rules
- **Reporting never queries OLTP directly** at scale: txn → outbox → worker →
  reporting tables → dashboards. (Current reports query OLTP — acceptable at
  today's volume; becomes a violation at Phase 3 triggers.)
- **Search:** trigram indexes now; Typesense/Meilisearch/OpenSearch only when
  search is a *measured* bottleneck. Never bare unindexed LIKE.
- **Files:** object storage, never bytea in Postgres.
- **Async always** for: email, PDFs, imports/exports, notifications, inventory
  recalc, price recalc, reconciliation, AI.
- **Financial data is sacred:** double-entry, immutable journal (enforced —
  journal_entries/po_approvals/price history are append-only), idempotent
  postings, audit trail, transactional consistency. No eventual consistency
  inside a financial transaction.
- **Tenancy:** every query tenant-filtered; RBAC/store/warehouse permissions
  and auditability verified on review.

## Never recommend prematurely
Kubernetes · service mesh · Kafka · CQRS-everywhere · event-sourcing-everywhere
· GraphQL federation · multiple databases · microservice fleets · distributed
transactions.

## Every recommendation must state
Problem · Evidence · Alternatives · Trade-offs · Cost · Risk · Business value ·
Future impact. Architecture discussions use: Current state / Strengths /
Weaknesses / Immediate / Future / Do-not-change / ROI / Difficulty / Risk / Time.

## Roadmap phases
1. Modular monolith (now) → 2. Redis + workers + pooled connections →
3. Reporting tables + search + caching → 4. Extract search/notifications/AI →
5. Extract transactional domains only at organizational scale.

## Final test
"Could 20 engineers build and operate this?" If yes, prefer the simpler answer.
