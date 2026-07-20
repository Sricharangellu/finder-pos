# Ascend — Architecture (as-built, single source of truth)

One file, kept truthful. Update when reality changes. Consolidates the
former `ARCHITECTURE.md` + `ACPA_ROADMAP.md` + `DOMAIN_MODEL.md` +
`PLATFORM_ROADMAP.md` + `orchestration/SYSTEM_DESIGN.md` into one place —
those are archived under `_archive/`.

## Shape

Domain-driven **modular monolith**: Node/TypeScript/Express backend
(`src/modules/*`, 52 modules), Next.js 14 frontend (`web/`), one PostgreSQL
(Supabase-hosted).

```
Next.js web (Vercel) ── proxies /api/* ──▶ Express backend (Render — long-lived process)
  EnterpriseShell nav, package gating         gateway: JWT/API-key auth, tenant
  /store public storefront                    resolver, role/plan/rate limits
                                              modules: { migrations, register }
                                              EventBus (+outbox, ADR-003)
                                                    │
                                              PostgreSQL (tenant_id + RLS)
```

Production backend moved from Vercel serverless to Render (a persistent
process) in this session — the old "runtime move off serverless" roadmap
item (Level 5/E3 step 6, below) is **done for production**; `develop`/
`staging` tiers still need their own real backend host to match (tracked as
a live gap, not yet actioned).

## Load-bearing invariants

- Money is integer cents everywhere (`src/shared/money.ts`).
- Every table is tenant-scoped; indexes lead with `tenant_id`; RLS backstop.
- Migrations: per-module idempotent SQL, hash-tracked, advisory-locked at boot.
- Events: in-process bus, sequential dispatch; financially-critical types are
  outbox-persisted with idempotent durable redelivery (ADR-003).
- Append-only records: `journal_entries`, `po_approvals`,
  `product_price_history`, audit logs — corrections are new rows, never edits.
- Race-free numbering: `document_counters` (`src/shared/docnumber.ts`).
- Keyset pagination primitive: `src/shared/pagination.ts`.
- Package isolation: vertical modules and wholesale features are gated by
  module/feature flags (`accountMode`); retail UI must never render
  wholesale-only fields (verified — see `GAPS.md`'s note on the retail
  isolation fix landed this session).

## Team → module ownership

Shared entities (Product, Customer, Supplier, Order, Invoice, Payment,
Ledger Entry, Tenant, Location) each have exactly ONE owning module —
creating a duplicate concept is a constitution violation (see
`DESIGN_PRINCIPLES.md`).

| Team | Modules |
|---|---|
| **Commerce** | orders (POS), sales (quotes/SOs), returns, discounts, promotions (in catalog), customers, loyalty, giftcards, quotes, service_orders |
| **Supply Chain** | inventory, purchasing (POs/suppliers/receiving/bills/3-way match), product_batches, serial_numbers, store_locations, outlets, fulfillment, shipping, warehouse pages |
| **Finance** | accounting (COA/ledger/deposits), billing (AP bills/AR invoices), payments, expenses, customer_invoices, tax (settings tax rates) |
| **Platform** | identity (src/identity), gateway (src/gateway), custom_roles, permission_requests, sso, sync, webhooks, sequences (+outbox infra), monitoring, notifications, audit_log, rls, workflows, search, settings |
| **Experience** | web/ (EnterpriseShell, components, pages), reports UI, storefront (/store) |
| **Verticals** (gated) | restaurant, healthcare, automotive, hospitality, manufacturing, rental, entertainment, education, golf pages |

Cross-team seams are event contracts (bus) and documented read-joins
(ADR-002) — never imports of another module's service.

## Platform roadmap (Levels 1–10, real status)

Status is code-verified, not aspirational.

| Level | Platform | Status |
|---|---|---|
| 1 | Foundation: identity, tenant, permissions, audit | ✅ Built (JWT/API keys, roles+custom roles, RLS, audit_log, MFA) |
| 2 | Enterprise data model | ✅ Built; guarded by "one owner per entity" reviews |
| 3 | Workflow engine | 🌱 Seeds (workflows module, PO approvals ✅, SO transitions ✅, requisitions ✅). Generalize (E4) after a second approval domain exists to generalize from. |
| 4 | Rules engine | 🌱 Proto-rules (approval tiers, margin rules, promotions, tax). Extract shared evaluator at the 3rd family. |
| 5 | Event platform: outbox + workers | ✅ Outbox v1–v1.4 shipped (ADR-003, dual dispatch + durable redelivery + stable event identity + staged publish). Job-tick runtime (`/jobs/tick`, ACPA M1.2) replaces the old relay. Long-lived process now true for production (Render); `develop`/`staging` still pending. |
| 6 | Reporting platform: read models | ⬜ Reports still query OLTP (acceptable at current volume; trigger = first slow dashboard). |
| 7 | Search platform | 🔶 pg_trgm indexes shipped; dedicated engine only on measured bottleneck. |
| 8 | Integration platform | 🔶 Webhooks + API keys + scopes exist; connector registry queued (E5). |
| 9 | Extension platform | ⬜ After 8. |
| 10 | AI platform | ⬜ Permissioned action layer; after 3/5. |

### Operational floor (parallel track, not a level)

Verified backups + restore drill · staging environment · CI gate · secrets
manager · runtime move off serverless + pooled connections (✅ prod, ⬜ dev/staging)
· alerting. These outrank feature levels for enterprise trust. See
`GAPS.md`'s "known open criticals" (C-1..C-4) for current status.

## Transformation epics (E1–E6, in order)

1. **E1 Durable events** — M1 ✅ → M1.2 ✅ (tick runtime + relay removal) →
   M1.3 ✅ (stable event identity + all-financial-consumer migration) →
   M1.4 ✅ (staged publish: payments; retention sweep) → M1.5 purchasing.receive
   staging + claim-inside-consumer-tx (true exactly-once) + operational
   stock-flow events — not yet started.
2. **E2 Procurement completion** — requisitions ✅, 3-way match ✅ (both
   shipped this session). GRN/GRNI status needs a specific check (see
   `GAPS.md`).
3. **E3 Scale mechanics** — batch bulk ops, pooling + runtime (✅ prod via
   Render, ⬜ dev/staging), reporting read models.
4. **E4 Workflow/rules generalization** — unify PO+requisition approvals;
   extract rule evaluation. Not started.
5. **E5 Extension platform** — connector registry over webhooks. Not started.
6. **E6 AI foundation** — permissioned action layer over modules; only after
   E1/E4. Not started.

**Standing rejections (re-affirmed, do not re-litigate):** microservices,
Kafka, K8s, multi-DB, schema-per-domain rename, low-code engine v1.

## Verification harness

`scripts/test.ts` boots embedded Postgres, per-test schemas, `PG_POOL_MAX=1`
(known parallel flakiness — single-file runs are authoritative; confirmed
repeatedly this session via isolated re-runs). `npm run verify` aggregates
all gates.
