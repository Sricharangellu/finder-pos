# Ascend — Current Architecture (as-built)

One page, kept truthful. Update when reality changes.

## Shape
Domain-driven **modular monolith**: Node/TypeScript/Express backend
(`src/modules/*`, 52 modules), Next.js 14 frontend (`web/`), one PostgreSQL.

```
Next.js web (Vercel) ── proxies /api/* ──▶ Express backend (Vercel serverless*)
  EnterpriseShell nav, package gating         gateway: JWT/API-key auth, tenant
  /store public storefront                    resolver, role/plan/rate limits
                                              modules: { migrations, register }
                                              EventBus (+outbox, ADR-003)
                                                    │
                                              PostgreSQL (tenant_id + RLS)
```
\* Runtime move to a long-lived process is roadmap item E3/step 6 — serverless
defeats pooling and forbids workers.

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
  wholesale-only fields.

## Verification harness
`scripts/test.ts` boots embedded Postgres, per-test schemas, PG_POOL_MAX=1
(known parallel flakiness — single-file runs are authoritative). `npm run
verify` aggregates all gates.
