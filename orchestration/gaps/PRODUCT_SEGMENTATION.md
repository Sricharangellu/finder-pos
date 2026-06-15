# Product segmentation — hybrid retail / wholesale / enterprise

**Source:** 2026-06-15 direction from the product owner: Finder should be
sellable as a single hybrid codebase to three buyer profiles — small
**retail** shops (single till, walk-in customers), **wholesale/B2B**
distributors (quotes, sales orders, AR/AP, purchasing), and **enterprise**
multi-store operators. No feature is removed for any profile; instead,
modules are grouped and a per-tenant **edition** setting controls which
groups are surfaced in the UI and enforced by the API. Default edition is
`hybrid` (everything on) — today's behavior is preserved unless a tenant
explicitly narrows their edition.

Updated: 2026-06-15.

## Why feature flags, not a fork or separate codebases

`src/modules/settings` already has a per-tenant `feature_flags` key/value
store (`GET/PUT /api/v1/settings/feature-flags`, manager-gated,
`DEFAULT_FLAGS` in `src/modules/settings/service.ts`). This is the existing
mechanism for "is X visible/enforced for this tenant" — segmentation should
extend it, not introduce a parallel system. A fork or separate build per
buyer profile would multiply maintenance cost for zero benefit, since the
underlying data model (tenants, products, orders, customers) is identical
across profiles — only which screens/endpoints are *exposed* differs.

## Module classification

| Group | Modules / features | Buyer profiles that need it |
|---|---|---|
| **Core** (always on, every edition) | `catalog` (incl. categories/variants), `inventory` (stock, lots/expiry, reservations, cycle counts), `orders` (POS checkout), `customers`, `payments`, `settings`, `team`/identity+RBAC, `search`, `outlets` (stores), `webhooks`, `sync`, base `reports` (summary/top-products/hourly) | retail, wholesale, enterprise |
| **Retail POS** | `giftcards`, register sessions + cash variance (BE-17), age-verification checkout flow (BE-16/FE-12), simple/coupon discounts | retail, hybrid |
| **Wholesale/B2B** | `sales` (quotes → sales orders → invoices, tier pricing), `billing` (AP/AR bills & invoices), `purchasing` (POs, receiving, vendor credits/returns), `accounting` (COA, deposits, AR dunning BE-14), customer credit limits (BE-13), volume/BOGO/tier discounts | wholesale, hybrid, enterprise |
| **Enterprise** | multi-store filter (BE-4), advanced reports (P&L, sales-by-rep/vendor, BE-3), `fulfillment`/`shipping` pick-pack-ship pipeline, `ecommerce` channel tagging, RBAC depth (BE-1), refresh-token rotation (BE-2), Postgres RLS (DB-1), Redis rate limiting (DB-2), cursor pagination (PERF-1) | enterprise, hybrid |

Nothing here is new code to write for the *features themselves* — they
already exist or are already queued (BE-1..17, FE-1..12). This file is only
about **grouping + visibility**, layered on top.

## What this turns into on the roadmap

- **BE-18** — Edition presets: extend `DEFAULT_FLAGS` with one flag per
  group above (`groupRetailPOS`, `groupWholesale`, `groupEnterprise`), all
  defaulting to `true` (= today's `hybrid` behavior, nothing removed). Add
  `POST /api/v1/settings/edition` (manager-gated) accepting
  `"retail" | "wholesale" | "enterprise" | "hybrid"`, which sets the three
  group flags to a preset combination (e.g. `retail` →
  `{groupRetailPOS: true, groupWholesale: false, groupEnterprise: false}`)
  via the existing `setFlags`. Group flags remain individually overridable
  via the existing `PUT /feature-flags` for tenants who want a custom mix —
  presets are a convenience, not a hard partition. Gate the relevant routes
  (sales-orders/billing/purchasing/accounting for `groupWholesale`;
  giftcards/registers for `groupRetailPOS`) with a flag check that returns
  404 when the group is off, so disabled modules don't leak in API
  responses either.
- **FE-13** — Edition-aware navigation: read `/feature-flags` once at app
  load; hide nav sections/routes for disabled groups (e.g. a `retail`-edition
  tenant doesn't see "Sales Orders"/"Purchasing"/"Accounting" in the sidebar;
  a `wholesale`-edition tenant doesn't see "Gift Cards"/"Register
  Sessions"). Add a "Business type" picker to Settings
  (`/settings/business`) that calls `POST /settings/edition` and shows the
  three group toggles for custom mixes. Default view (no edition set) shows
  everything, identical to today.

Both items are additive and reversible: flipping a group flag back to `true`
restores full visibility with no data migration, because the underlying
tables/endpoints for every module already exist regardless of edition.
