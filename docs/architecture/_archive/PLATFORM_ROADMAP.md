# Ascend — Platform Roadmap (Levels 1–10, real status)

Status is code-verified, not aspirational. Detail + epics: ACPA_ROADMAP.md.

| Level | Platform | Status |
|---|---|---|
| 1 | Foundation: identity, tenant, permissions, audit | ✅ Built (JWT/API keys, roles+custom roles, RLS, audit_log) |
| 2 | Enterprise data model | ✅ Built; guarded by "one owner per entity" reviews |
| 3 | Workflow engine | 🌱 Seeds (workflows module, PO approvals, SO transitions). Generalize after requisitions land (E2). |
| 4 | Rules engine | 🌱 Proto-rules (approval tiers, margin rules, promotions, tax). Extract shared evaluator at the 3rd family. |
| 5 | Event platform: outbox + workers | 🔶 Outbox v1 shipped (ADR-003, dual dispatch + durable redelivery). M1.2: worker-driven dispatch + legacy relay removal — pairs with runtime move. |
| 6 | Reporting platform: read models | ⬜ Reports still query OLTP (acceptable at current volume; trigger = first slow dashboard). Rollup tables fed from outbox stream. |
| 7 | Search platform | 🔶 pg_trgm indexes shipped; dedicated engine only on measured bottleneck. |
| 8 | Integration platform | 🔶 Webhooks + API keys + scopes exist; connector registry queued (E5). |
| 9 | Extension platform | ⬜ After 8. |
| 10 | AI platform | ⬜ Permissioned action layer; after 3/5. |

## Operational floor (parallel track, not a level)
Verified backups + restore drill · staging environment · CI gate · secrets
manager · runtime move off serverless + pooled connections · alerting.
These outrank feature levels for enterprise trust (CTO assessment 2026-07-13).
