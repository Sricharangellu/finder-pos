# Ascend — Gaps (current, code-verified)

Single source of truth for "what's actually still missing." Replaces the
2026-06-15 `orchestration/gaps/*.md` assessment files, which described a
snapshot over a month stale — every specific item they proposed as "worth
building" (BE-9 reservations, BE-11/12 partial receiving + bill variance,
BE-13 credit limits, BE-15 tracking/carrier, BE-16 age verification, BE-17
register sessions, BE-18 edition presets, purchase requisitions, PO approval
routing, cycle counts, location transfers, MFA, SSO, API keys, custom-roles
permissions, job scheduling) was independently verified **already built**
during this consolidation pass (grep + live API checks against running
staging, 2026-07-20). Those old files are archived under `_archive/` —
historical record only, not a task list.

**Rule going forward:** don't propose a gap without checking the code first.
`grep`/read the relevant module before writing "worth building" — this file
existed for a month claiming things were missing that had already shipped.

## Real, current gaps (verified still open)

These are the actual open items, cross-checked against `WORK/FORWARD_PLAN.md`'s
NEEDS-SRI list (the authoritative day-to-day backlog) as of this pass:

| Item | Status | What's actually missing |
|---|---|---|
| Catalog `/catalog/:id/credits` | Open | No backing concept anywhere in the schema (not customer_invoices, not store credit). Needs a design decision on what a product-level "credit" even means before building — not a wiring gap. |
| Inventory pipeline: Receiving tab | Open | Implies a stateful "receiving session" (start receiving, scan qty progressively, batch_id) that doesn't exist — POs today go create → receive() in one atomic call. Needs a decision on whether the workflow is worth building. |
| Inventory pipeline: Issues + Errors tabs | Open | FE has GET+PATCH only (no POST) implying an unbuilt *detection* engine (sku_mapping, price_mismatch, duplicate_doc, edi_parse categories) — nothing currently computes these. Needs a decision on what should populate them. |
| Inventory pipeline: Overview/Summary funnel | Open | FE's 9-stage funnel doesn't map onto the real 4-value `POStatus` enum; several KPIs depend on the two items above. |
| Real EDI parsing (`purchasing/edi-imports`) | Open | Frontend upload form never sends file bytes (no FormData/base64) — `/process` is an honest state-machine transition, not real parsing, because there's nothing to parse yet. Needs (a) frontend file-upload fix and (b) a parser library or defined subset format decision. |
| Approval chains / run-history: trigger wiring | Open | `approval_chains` and `workflow_run_history` are real, persisted, tested — but nothing invokes them. Needs a decision on which real action (price override? refund threshold? new vendor? discount threshold?) should check a chain and log a run. |
| Custom-roles / permissions-page contract | Open | Frontend permissions matrix (`{name,color,features}`) vs backend `custom_roles` (`{name,permissions}` fixed vocab, no color) — a genuine contract mismatch, not a missing feature. Needs a decision on which model wins. |
| E2 procurement: GRN / GRNI | Partial | Requisitions ✅ and 3-way match ✅ both shipped (this session). Goods-Received-Not-Invoiced tracking may already be partially covered by the 3-way match's `not_invoiced` variance flag — needs a specific check before calling this done or open. |
| Ecommerce storefront auth | Decided, gated | `NEXT_PUBLIC_STORE_AUTH_ENABLED=1` re-enables; real customer-auth backend deferred until the storefront is prioritized. Not an oversight — a deliberate Preview gate. |
| Product/inventory pages: dead routes, broken transfers redirect, duplicate batch/expiry models | Open — full review in [PRODUCT_MODULE_REVIEW.md](PRODUCT_MODULE_REVIEW.md) | 8 pure re-export/dead-redirect routes found (zero-risk to remove); `/inventory/transfers` redirects to a page with no transfers tab (broken); `product_batches` and `inventory_lots` are two independent, non-reconciling expiry data models. No shared enterprise data-table component exists — catalog/inventory list pages have no pagination UI despite backend support. |

## Known open criticals (operational floor, outrank feature work)

From `docs/architecture/CTO_CHARTER.md` / `PLATFORM_ROADMAP.md`, still true as of this pass:
- **C-1** — backup restore drill never run against real infra.
- **C-2** — background workers still `setInterval`-based in the general orchestration layer outside the M1.2 job-tick path; runtime move to a long-lived process (Level 5/E3 step 6) not done.
- **C-3** — DB TLS: production connects with `PG_SSL_NO_VERIFY`-style trust in some paths; the *code* supports proper `PG_CA_CERT`/`PG_CA_CERT_B64` verification (used correctly for the new Supabase project this session) but isn't universally enforced yet.
- **C-4** — no alerting between deploys beyond the `uptime.yml` heartbeat.

## How to keep this file honest

- Before adding an item: `grep` the relevant module/route, don't just recall an old assessment.
- Before removing an item: confirm via a real request/test, not a code skim (a route existing doesn't mean it's wired end-to-end — verify the actual call path, the way BE-9's `committed` field looked stale in a comment but was actually live in the query below it).
- This file shrinks over time. If it's not shrinking, something's wrong with how work is being tracked, not with the codebase.
