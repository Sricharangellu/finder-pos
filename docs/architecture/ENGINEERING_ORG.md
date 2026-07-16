# Ascend — Engineering Organization Charter

Companion to CTO_CHARTER.md (adopted 2026-07-13). Ascend is built by a
coordinated set of specialized engineering roles. Every major change moves
through proposal → review → approval, and ships with the Code Delivery
Standard. Roles may be played by one coordinated AI or parallel agents; the
discipline is identical either way.

## Roles & ownership
- **CTO / Architect** — vision, tradeoffs, approves changes (rules in CTO_CHARTER.md)
- **Principal Architect** — domain boundaries, events, API contracts; rejects circular deps and hidden coupling
- **Engineering Manager** — epics/tasks/dependencies (WORK/ plan + LOCK discipline)
- **Domain owners** — Sales(POS/orders/returns) · Customer(CRM) · Pricing(promotions/engine) · Inventory(stock/availability) · Purchasing(POs/receiving) · Warehouse(transfers/fulfillment) · **Accounting (highest authority on financial correctness)** · Payments · Tax
- **Platform** — Backend(APIs/shared libs) · Database(schema/indexes/migration safety) · Infrastructure(deploy/scale) · Security(auth/secrets/compliance)
- **Experience** — Frontend(UI arch) · UX(workflows/a11y)
- **Quality** — QA(test strategy) · Performance(load) · Observability(logs/metrics/alerts)

## Protocol
Major change = Proposal (problem/solution/alternatives/impact/risk) →
Review (Architect + Security + Database + QA) → CTO approval → implement →
gates (typecheck/tests/smoke/hygiene + web gates) → audit note → commit.

## Engineering rules
1. Every module owns its data. **Writes never cross module boundaries.**
   *Amendment (CTO ruling 2026-07-13): cross-domain SQL **reads** are accepted
   monolith pragmatism (e.g. vendor 360, availability). They are the exact
   seams replaced by read models/APIs if a domain is ever extracted.*
2. Critical workflows are transactional (existing `tx()` discipline).
3. **Financial events must never be lost** → transactional outbox (scale step 5,
   in flight). Ledger/journal stays append-only, idempotent, double-entry.
4. Long-running work → workers (Phase 2; no sync email/PDF/import/recalc).
5. Reporting moves to read models before OLTP volume makes it a hazard.
6. Conflicts resolve by: business impact → reliability → simplicity → cost →
   future flexibility. Simplest solution preserving future options wins.

## Code Delivery Standard (every implementation states)
Architecture impact · Database impact · Testing strategy · Security impact ·
Rollback plan · Monitoring requirements.

## Standing engineering economics
Target 10k+ tenants on the current architecture. Exhaust indexes/pooling/
caching/workers/replicas before architectural change. No Kubernetes/Kafka/
microservices without measured evidence. Build systems that survive decades.
