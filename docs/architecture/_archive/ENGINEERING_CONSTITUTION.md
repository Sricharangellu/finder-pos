# ASCEND ENGINEERING CONSTITUTION (AEOS)

**Mandatory. Every agent (human or AI) loads this document — and the files it
indexes — before beginning work, and updates them when making a significant
architectural or domain change.** This is the highest engineering authority
for the repo. Version-controlled; changes go through review like code.

## Mission
Ascend is a **Commerce Operating System** — not a POS, not an ERP. It powers
retail, wholesale, distribution, warehousing, manufacturing, B2B/B2C commerce,
financial operations, and AI business automation. Think: ServiceNow for
commerce, Shopify for enterprise, Stripe for finance, SAP B1 for operations.

## Document map (read in this order)
1. **This file** — authority, mission, execution loop.
2. [ARCHITECTURE.md](../ARCHITECTURE.md) — what the system is today.
3. [CTO_CHARTER.md](CTO_CHARTER.md) — decision rules, engineering economics.
4. [ENGINEERING_ORG.md](ENGINEERING_ORG.md) — roles, review protocol, delivery standard.
5. [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — team → module ownership.
6. [PLATFORM_ROADMAP.md](PLATFORM_ROADMAP.md) — levels 1–10 with real status.
7. [ACPA_ROADMAP.md](ACPA_ROADMAP.md) — transformation migrations + epic backlog.
8. [CODING_STANDARDS.md](CODING_STANDARDS.md) — repo idioms.
9. [ADR/](../ADR/) — architecture decision records. **Every significant decision
   gets an ADR.** Check existing ADRs before re-deciding anything.

## Execution loop (every work cycle)
Load constitution → analyze code → detect violations/debt/duplication/missing
tests/security/bottlenecks → prioritize → design → validate against charter →
**implement smallest safe change** → verify (gates below) → update docs →
record ADR if significant → update backlog (WORK/) → repeat.

## Non-negotiables (summary; detail in charters)
- Domain-driven **modular monolith**, extraction-ready; no premature
  microservices/Kafka/K8s/multi-DB (evidence required — CTO_CHARTER).
- **Financial correctness is sacred:** double-entry, immutable journals,
  idempotency, audit trail; no eventual consistency inside a financial
  transaction (the outbox handles durability *around* it — ADR-003).
- Module ownership: logic, tables, events, tests, docs. Writes never cross
  module boundaries; cross-domain SQL reads accepted (ADR-002).
- No business logic in UI or route handlers — services own it.
- Events: business tx → outbox → (worker: M1.2) → processing → read models.
- Scale order: indexes → queries → caching → workers → replicas → read models
  → search — before any architecture change.

## Quality gates (every change)
`npm run typecheck` · `npm test` · `npm run smoke` · `npm run hygiene` ·
web `typecheck/lint/build` — plus the org review protocol (architecture,
security, database, QA) and the Code Delivery Standard in commit messages.

## Known deviations from the generic AEOS template (ruled, do not re-litigate)
- **Raw SQL, not Prisma** (ADR-001).
- Backend is Express modules behind Next.js proxy, not Next API routes.
- Redis/object storage/workers are roadmap Level 5–7 items, not yet default.

## Final rule
Leave the codebase better than you found it. Never the fastest solution —
the solution that keeps Ascend maintainable for the next decade.
