# Ascend — ERP Feature & Architecture Gap Analysis

Date: 2026-07-13
Basis: full code inspection of this repo (52 backend modules, 143 web routes —
see AUDIT_2026-07-13T193958Z-retail-ux-architecture.md), benchmarked against the
reference ERP navigation supplied (finance-first ERP: persistent left nav,
document quick-create, org switcher). **Not a copy plan** — every item below is
adopt/redesign/ignore with a reason tied to Ascend's architecture.

Ascend's standing architecture (preserved throughout): modular monolith
(`src/modules/*`, event bus, per-module migrations), multi-tenant Postgres with
RLS defense-in-depth, business packages gated by module/feature flags
(`accountMode` RETAIL/WHOLESALE/ENTERPRISE + vertical `moduleGate`s), money in
integer cents, append-only audit patterns (e.g. `po_approvals`).

---

## 1. Dashboard

**Ascend has:** KPI section, quick actions, top lists, progress/tasks dashboard.
**Reference adds:** receivables/payables cards, cash-flow widget, approvals inbox.

- **ADOPT — Approvals inbox widget.** We just shipped tiered PO approvals
  (`po_approvals`); pending approvals are exactly the kind of "work waiting on
  you" a dashboard exists for. Cheap: one query on `approval_status='pending'`.
- **ADOPT (later) — Receivables/Payables cards.** Data already exists
  (`billing` bills + `customer_invoices` + vendor credits). Retail tenants see
  only AP (bills); AR cards appear only when wholesale/invoicing is enabled —
  package separation preserved by the existing feature-gate mechanism.
- **IGNORE — Business-health scores, generic compliance widgets.** No data
  model behind them today; a scoreless card is decoration.

## 2. Product Module

**Ascend has:** one product master (`/catalog/[id]`, 17 tabs) after this week's
consolidation; structured variant engine; categories M2M; images; barcodes;
compliance fields; per-channel variant sorting.

- **ADOPT — Brands/Manufacturers as first-class filters, not new pages.**
  `brand` and `manufacturer` columns already exist on products; surface them as
  catalog filters + a settings-managed value list. New *pages* would recreate
  the duplicate-surface problem we just removed.
- **REDESIGN LATER — Bundles/assemblies.** `composite_product` flag exists but
  has no BOM table. If manufacturing package matures, BOM belongs there, with
  retail "bundles" as a thin case of it. Don't build twice.
- **IGNORE — separate Attributes catalog.** Variant options are stored
  per-variant (`variant_options` JSON) by design; a global attribute dictionary
  adds sync burden without a proven need at current scale.

## 3. Sales Workflow (Quotation → … → Refund)

**Ascend has the whole spine:** quotes (+`/:id/convert`), sales orders,
pick→pack→ship→deliver (fulfillment/shipping, built this session), invoices
(AR via `customer_invoices`/billing), payments, returns, vendor/customer credits.

- **ADOPT — Document-chain header ("traceability ribbon").** Every doc already
  stores its parent id (quote→order, order→pick list→shipment, PO→bill). What's
  missing is UI: a small chain of linked chips (Quote #12 → SO-345 → SHP-9 →
  INV-77 → Payment) on each detail page. This is the reference ERP's single
  best idea and it's pure frontend over existing FKs.
- **ADOPT — Credit-memo → refund linkage check.** Returns exist; verify a
  return always emits a credit doc (it does for vendor returns via
  `vendor_credits`; customer-side store credit exists in POS). Gap is only
  *cross-linking on the detail pages*, not new tables.

## 4. Purchase Workflow

**Ascend has:** vendors/suppliers (profiles, contacts, addresses, balances,
vendor 360), vendor quotes (RFQ-lite), POs with partial line receiving, landed
costs, auto-bill-on-receive, bill variance, vendor returns/credits, payments —
plus tiered PO approvals with an append-only audit trail (shipped `7b8b95e`).

Remaining gaps are already the parked procurement plan, in priority order:
1. **Purchase requisitions** (draft→submit→approve→convert) — adopt; light table
   + reuse of the approval pattern.
2. **GRN as a first-class document** with accepted/rejected/damaged splits —
   adopt; receiving is currently an action on the PO, which blocks quality-hold
   and over/short-receipt accounting.
3. **Three-way matching** (PO↔GRN↔Bill with mismatch approval) — adopt; billing
   variance is the seed of it.
4. **GRNI postings** — see §8.
- **IGNORE — Put-away step.** No bin-location model in retail scope; warehouse
  package can add it behind its own gate later.

## 5. Shipping

**Ascend has:** shipments from invoices *and* sales orders, delivery pipeline
UI, shipping methods in settings.
- **RECOMMENDATION: keep Shipping integrated, not a standalone module page
  tree.** Retail/ecommerce need dispatch + tracking, not fleet management.
  Driver/vehicle/route scheduling → **IGNORE** for retail; if a distribution
  package materializes, it gets its own gated module on the same shipments
  tables.
- **ADOPT — carrier abstraction.** One `carriers` interface (name, tracking-url
  template, webhook) instead of hardcoded carriers; fits the integrations
  framework (§12).

## 6. Customers

**Ascend has:** profiles, contacts, addresses, notes, merge, loyalty, store
credit, purchase history; wholesale accounts are separated by `accountMode`.
- **ADOPT — credit limits enforcement surface.** Wholesale-only; field exists
  conceptually in AR but needs a visible limit + block-at-order behavior.
  Must live behind the wholesale gate (never in Retail UI).
- **IGNORE — built-in support tickets.** Integration concern (§12), not core.

## 7. Vendors

**Ascend has:** vendor 360 (products, POs, invoices, credits, receiving tabs),
lead time, terms.
- **ADOPT — vendor performance snapshot** (on-time %, avg lead time realized vs
  promised) computed from existing receiving timestamps. No new tables.
- **IGNORE — formal contracts module** until blanket POs are asked for.

## 8. Accounting

**Ascend has:** chart of accounts (+tree/seed), batch deposits with
approve/reject, expenses, tax rates. **Missing: journal entries, general
ledger, bank reconciliation, statements.**

- **ADOPT (the one big build) — a minimal posting ledger.** One append-only
  `journal_entries` table (doc_type, doc_id, debit/credit account, cents) +
  automatic postings from events the bus already publishes
  (`purchase_order.received` → Dr Inventory / Cr GRNI; bill posted → Dr GRNI /
  Cr AP; payment → Dr AP / Cr Bank; sale → Dr Cash/AR / Cr Revenue+Tax).
  This is the keystone that turns the existing P&L report from
  query-over-documents into a real GL, and it slots into the event-driven
  architecture without touching module boundaries.
- **DEFER — bank reconciliation, fixed assets.** Real needs, but only after the
  ledger exists; reconciliation without a ledger is bookkeeping theater.

## 9. Reports

**Ascend has (post-consolidation):** 13 reports on one `/reports` tree with a
complete sub-nav; insights module; audit-log page.
- **ADOPT — saved report views + scheduled email.** Cheapest high-value step:
  persist filter sets (the shareable-URL groundwork exists) and a cron that
  mails a saved view (notifications module already exists).
- **IGNORE (for now) — custom report builder / BI.** Enormous surface, low
  differentiation; revisit when saved views prove insufficient.

## 10. Ecommerce

**Ascend has:** storefront (`/store`), product online settings, online orders →
sales-order pipeline, coupons/promotion engine, per-channel variant sort.
- **ADOPT — sync-status panel.** Product/price/inventory "synced/pending" badges
  for the storefront channel; data exists, trust-building UI doesn't.
- **IGNORE — CMS/landing pages/SEO tooling.** That's a website builder, not an
  ERP module; integrations can point at a real CMS.

## 11. Settings

**Ascend has:** business profile, flags, editions, taxes, currencies, payment
modes/terms, shipping methods, numbering (document_counters), users/roles
(+custom roles), permissions, modes.
- **ADOPT — approval-workflow settings page.** The PO approval config
  (`PUT /purchasing/approval-config`) shipped API-first; give it a card in
  Settings so tiers aren't curl-only. Pattern generalizes to future requisition
  approvals.
- **ADOPT — numbering-sequences settings surface** over the existing
  `document_counters` (prefix/next-number per doc type). Backend primitive is
  already race-free.

## 12. Integrations

**Ascend has:** integrations page, webhooks module (with signatures), API keys
with scopes, SSO, sync module.
- **ADOPT — connector registry pattern.** One `integrations` table
  (type, provider, config JSON, status) + provider-agnostic dispatch through
  the existing webhook/event plumbing. No hardcoded vendors — exactly the
  constraint the prompt sets, and the webhooks module is 80% of it.
- **IGNORE — EDI, scales, label-printer drivers** until a customer demands one;
  the registry means adding them later is additive, not architectural.

## 13. Workflow Connections (page-to-page)

Largest UX gap identified. Fixed this session: duplicate product editor,
duplicate sales report, reports dead ends, wrong-target aliases, orphaned price
book. Remaining, in order:
1. **Traceability ribbon** (§3) — cross-document chain links on all detail pages.
2. **Breadcrumbs/back-nav standardization** across detail pages (audit finding 8).
3. **Related-record shortcuts** on vendor/customer 360s → filtered document lists.

## 14. Multi-Business Architecture

Verified in code: verticals are module-gated; `accountMode` drives
retail/wholesale/enterprise nav; storefront is separate. **The mechanism is
sound — the discipline is the risk.** Recommendation: a CI check (extend
`tools/hygiene-check.mjs`) that fails when a page under a retail-gated nav key
imports wholesale-only components; cheap guardrail, no new architecture.

## 15. Automation

**Ascend has:** event bus, workflows/orchestration module, background jobs,
dunning run, reorder suggestions → draft POs, auto-bill-on-receive.
- **ADOPT — approval routing notifications.** Pending PO approval → notification
  to approvers (notifications module exists; it's one event subscriber).
- **ADOPT — low-stock → draft-PO automation toggle.** The pieces exist
  (reorder suggestions, PO creation); a settings toggle to run it on schedule.
- **IGNORE — generic rule engine / AI suggestions** as products; keep shipping
  concrete automations on the bus until a third one demands generalization.

## 16. User Experience

**Ascend has:** command palette (⌘K global search), consistent shell, skeletons.
- **ADOPT — quick-create menu** in the top bar (New Product / Quote / Sales
  Order / PO / Bill — the reference ERP's best nav idea), each item gated by the
  same module flags as its page.
- **ADOPT — recent items** in the command palette (localStorage; zero backend).
- **DEFER — favorites/pinning, split views.** Nice-to-have; below the line
  until the above ship.

---

## 17. Consolidated Gap Analysis

**Adopt (ranked):**
1. Minimal posting ledger + automatic postings (§8) — the only structural gap.
2. Traceability ribbon across document chains (§3/§13) — frontend over existing FKs.
3. Procurement completion: requisitions → GRN → three-way match (§4, already planned).
4. Quick-create menu + approvals dashboard widget (§16/§1).
5. Approval-workflow + numbering settings surfaces (§11).
6. Connector registry on the webhooks plumbing (§12).
7. Saved/scheduled report views (§9).
8. Package-isolation CI guard (§14).

**Redesign:** bundles→BOM unification (when manufacturing matures); credit
limits as wholesale-gated AR feature.

**Ignore (with reason):** CMS/SEO (website-builder scope), fleet/route
management (distribution-package scope), custom report builder/BI (surface far
exceeds value today), global attribute dictionary (duplicates variant_options),
EDI/hardware drivers (registry makes them additive later), generic rule engine
(concrete automations first).

**Duplicates avoided:** no second product surface, no second reports tree, no
standalone "Payments Made/Received" pages (payments module + bill/invoice pay
actions already cover the flows the reference ERP splits into pages).

**Where Ascend is already ahead of the reference:** structured variant engine
with non-destructive regeneration; append-only approval audit; race-free
document numbering; event-driven module seams; per-channel variant ordering;
RLS-backed tenancy; package gating.
