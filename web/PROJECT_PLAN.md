# Project Plan — FinderPOS
Last updated: 2026-06-19

## What we built so far

FinderPOS is a full-stack enterprise POS platform targeting retail, wholesale, and distribution businesses (tobacco, vapor, hemp specialty retail). The frontend has 29 protected pages covering every area of the business — from a real-time POS terminal to MSA compliance reporting. The backend is a modular monolith with 27 domain modules, 304 integration tests, CI/CD via GitHub Actions, Docker support, and deployed live on Vercel.

---

## Done ✅

- **POS Terminal** — touch-friendly register with barcode scanner, split tender, age verification, offline sync, and receipt printing/emailing
- **Dashboard** — KPI tiles with trend indicators, Recharts revenue trend + hourly bar charts, sales-by-category breakdown, top products/customers
- **Catalog** — product browse, filter, bulk-select, CSV import/export, barcode generation, master/variant product management
- **Inventory** — stock levels, lot/expiry tracking (FEFO), cycle counts, reorder alerts, SSE low-stock notifications; Stock Locations tab (per-outlet)
- **Orders** — order list, detail drawer, status management, cursor pagination
- **Customers** — CRM list, detail page with loyalty + financial summary; collapsible Addresses, Contacts, Notes sub-panels
- **Quotations (/quotes)** — create quotes with line items, send, convert to order, full status lifecycle
- **Sales / Sales Orders** — sales order create/approve/invoice workflow, credit limit enforcement
- **Purchasing** — PO create/receive (partial receive), supplier management, vendor quotes tab (feature-flagged)
- **Discounts** — rule builder (simple/volume/BXGY), coupon codes, per-customer limits
- **Gift Cards** — issue, check balance, void
- **Workflows** — visual workflow builder with per-outlet step configuration, step type badges, inline enable/disable
- **Insights** — velocity-based reorder recommendations, scheduled report emails, "Create Draft POs" button
- **Reports** — 8 report types (sales, P&L, AR/AP aging, inventory, expiry, sales-by-rep, sales-by-vendor); Recharts AreaChart on sales report
- **Accounting** — chart of accounts, journal entries, batch deposits (approve flow)
- **Finance** — AR/AP aging surface with payment actions
- **Settings** — 11 sections: store profile, shipping, payment terms/modes, tax rates, feature flags, security (MFA setup), COA, deposits, loyalty tiers, API keys
- **Tax & Compliance** — tax rate management, MSA reporting table (tobacco/vapor UPC data), state tax reference, customer exemptions placeholder
- **Operations** — fulfillment locations, pick lists, outlets/registers, stock locations tab
- **Team** — member list, role management, custom-role assignment
- **Custom Roles** — RBAC with granular permission management (/team/custom-roles)
- **Ecommerce** — storefront settings, online orders, catalog sync
- **Shipping** — shipping order list with carrier/tracking, ship action
- **Payments** — payment ledger page
- **Returns** — returns management from completed orders
- **Vendors** — vendor/supplier management page
- **Integrations** — integration provider grid (connect/disconnect), company integration management
- **Imports/Exports** — CSV import batch tracking + export buttons
- **Onboarding wizard** — post-signup 4-step setup (business type → store info → first product → done)
- **Auth** — login, signup, MFA setup (TOTP), password reset, SSO (OIDC), API keys, device registration
- **CI/CD** — GitHub Actions pipeline (typecheck → test → build → deploy), Docker, helmet.js security headers

---

## To Do 📋

### Right now (next 1–3 tasks)

- **Deploy Sprint 10 to Vercel** — Run `bash deploy.sh` from `web/` to get the Recharts charts, MFA settings, vendor quotes tab, quotations page, and API key management live on https://finder-pos-frontend.vercel.app

- **P&L report chart** — The P&L page at `/reports/p-l` has no chart. Add a Recharts BarChart showing revenue vs. COGS vs. expenses side by side. Same pattern as the sales report AreaChart that was just added — small, high-visual-impact change.

- **Dashboard link to /quotes** — The quick-actions section of the dashboard should have a "New Quote" link. Add it alongside the existing New Sale / Add Product / View Reports / Manage Inventory shortcuts.

### Coming up (next wave of work)

- **Customer loyalty tier UI** — The `/customers/[id]` detail page should show the customer's current tier badge, points balance, points-to-next-tier progress bar, and a "Loyalty Summary" card. The backend `GET /customers/:id/loyalty` endpoint exists — just needs frontend.

- **Settings → Currencies** — The `GET /api/v1/settings/currencies` endpoint exists (seeded with USD/EUR/GBP/CAD) but there's no Settings section for it. Add a "Currencies" section where the owner can see exchange rates and mark a base currency.

- **Inventory stock-by-location view** — `GET /api/v1/inventory/locations/:id/stock` returns per-location stock but there's no UI to view it. Add a "View Stock" button on each Stock Location row in Operations that opens a modal with the product-level stock table for that location.

- **Quotations link in nav for Operate group** — `/quotes` was added to the Operate nav group but the `"quotes"` NavKey needs to be in the design-system NavKey reference too (already done in EnterpriseShell but not yet in the skill docs).

- **Print-ready receipt template** — The current `@media print` CSS is minimal. Create a proper 80mm thermal receipt layout using CSS grid that formats nicely for kitchen/counter printers.

- **Barcode scanner indicator in terminal** — When the user scans a barcode, show a brief flash/toast that says "Scanned: [product name]" rather than just silently adding it to the cart. Improves cashier feedback loop.

### Future ideas

- **Redis rate limiting** — Replace the in-memory token bucket with a Redis-backed rate limiter for production multi-instance deployments. Currently documented in the codebase as "Wave 2".
- **Per-outlet inventory** — The `inventory_stock` table is per-location, but the terminal still deducts from the flat `inventory` table. Wire the terminal checkout to deduct from the correct location's `inventory_stock` row.
- **Customer portal** — A separate Next.js app (or subdomain route) where B2B wholesale customers can log in, view their invoices, and reorder.
- **Stripe Terminal integration** — Wire a real card reader (Stripe Terminal / BBPOS WisePOS E) to replace the simulated card tender.
- **Multi-company** — Allow a single deployment to serve multiple independent tenant companies (separate schemas per tenant rather than shared schema with `tenant_id`).
- **Data warehouse ETL** — Nightly aggregation job that populates `daily_sales_summary` and `product_sales_summary` from OLTP data for fast dashboard queries.

---

## Blocked or waiting ⏸

- **Vendor quotations backend** — The vendor quotes tab in Purchasing is mock-only. Backend endpoints (`POST /purchasing/vendor-quotes`, etc.) not built yet. Blocked until a purchasing sprint prioritizes it.
- **MFA email/SMS fallback** — TOTP MFA is built but no backup codes or email OTP path. Users who lose their authenticator are locked out. Needs a backup-codes endpoint and a recovery flow.
- **Redis** — DB-2 in the original roadmap. Requires adding Redis infrastructure to the deployment. Not blocked by code — blocked by infra decision.

---

## What to build next

The most valuable next step is deploying Sprint 10 so the live demo reflects everything that was just built — recharts charts, MFA setup, quotations page, and API keys are all working locally but not yet on Vercel. After that, the P&L report chart is a quick win that makes the reports section feel complete. Then the customer loyalty tier UI on the detail page would close the loop on the loyalty tiers feature built in Sprint 4 — the backend and settings UI are done but the customer-facing display is missing. No tasks are currently blocked by dependencies, so these three can be tackled in any order once deployed.

---

## Files to clean up 🗑

- `web/components/ModuleBlueprint.tsx` — stub component used by the original placeholder pages (`integrations`, `tax-compliance`, `imports-exports`) before they were replaced with real implementations. Check if any page still imports it before deleting.
- `web/lib/useDesignProcess.ts` — a general-purpose design-process hook that was added incidentally; not imported by any FinderPOS page. Safe to remove if not needed.
- Worktree refs in `.gitignore` — the `.claude/worktrees/` submodule warnings in every commit suggest the worktree paths should be added to `.gitignore`.

---

## Archive

Older completed work (Sprints 1–7) is documented in `orchestration/ROADMAP.md` and the memory file `sprint_backlog.md`. Everything from the Lightspeed feature parity matrix (NuORDER catalog and mobile scanner app aside) is implemented.
