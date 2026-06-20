# Project Plan — FinderPOS
Last updated: 2026-06-19

## What we built so far

FinderPOS is a full-stack enterprise POS platform targeting retail, wholesale, and distribution businesses (tobacco, vapor, hemp specialty retail). The frontend has 29 protected pages covering every area of the business — from a real-time POS terminal to MSA compliance reporting. The backend is a modular monolith with 27 domain modules, 304 integration tests, CI/CD via GitHub Actions, Docker support, and deployed live on Vercel.

---

## Done ✅

- **POS Terminal** — touch-friendly register with barcode scanner, split tender, age verification, offline sync, and receipt printing/emailing
- **Dashboard** — KPI tiles with trend indicators, Recharts revenue trend + hourly bar charts, sales-by-category breakdown, top products/customers; New Quote quick-action
- **Catalog** — product browse, filter, bulk-select, CSV import/export, barcode generation, master/variant product management
- **Inventory** — stock levels, lot/expiry tracking (FEFO), cycle counts, reorder alerts, SSE low-stock notifications; Stock Locations tab (per-outlet)
- **Orders** — order list, detail drawer, status management, cursor pagination
- **Customers** — CRM list, detail page with loyalty tier card (tier badge, points, progress bar), financial summary, collapsible Addresses, Contacts, Notes sub-panels
- **Quotations (/quotes)** — create quotes with line items, send, convert to order, full status lifecycle
- **Sales / Sales Orders** — sales order create/approve/invoice workflow, credit limit enforcement
- **Purchasing** — PO create/receive (partial receive), supplier management, vendor quotes tab (feature-flagged)
- **Discounts** — rule builder (simple/volume/BXGY), coupon codes, per-customer limits
- **Gift Cards** — issue, check balance, void
- **Workflows** — visual workflow builder with per-outlet step configuration, step type badges, inline enable/disable
- **Insights** — velocity-based reorder recommendations, scheduled report emails, "Create Draft POs" button
- **Reports** — 8 report types (sales, P&L with Recharts BarChart, AR/AP aging, inventory, expiry, sales-by-rep, sales-by-vendor); Recharts AreaChart on sales report
- **Accounting** — chart of accounts, journal entries, batch deposits (approve flow)
- **Finance** — AR/AP aging surface with payment actions
- **Settings** — 12 sections: store profile, shipping, payment terms/modes, tax rates, feature flags, security (MFA setup), COA, deposits, loyalty tiers, API keys, currencies
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

- **Inventory stock-by-location modal** — The stock locations table in Operations has no way to view what's actually stocked at each location. Add a "View Stock" button on each row that opens a modal showing all products and their quantity at that location. Backend `GET /api/v1/inventory/locations/:id/stock` exists — just needs the UI.

- **Barcode scanner feedback toast** — When a cashier scans a product at the terminal, it silently adds to the cart. Add a brief toast that says "Scanned: [product name]" so cashiers have visual confirmation the scan registered. Low complexity, high cashier UX impact.

- **Print-ready receipt template** — The current receipt uses minimal CSS. Create a proper 80mm thermal receipt layout using CSS that formats correctly for kitchen/counter printers — order total, line items, tax breakdown, and store name.

### Coming up (next wave of work)

- **Deploy Sprints 10–11 to Vercel** — Run `bash deploy.sh` from `web/` to push the Recharts charts, MFA settings, quotations page, API keys, loyalty card, P&L chart, and currencies settings live to https://finder-pos-frontend.vercel.app

- **Vendor quotations backend** — The vendor quotes tab in Purchasing is mock-only. Build real backend endpoints (`POST /purchasing/vendor-quotes`, etc.) so vendor quote requests can be saved and tracked.

- **MFA backup codes** — TOTP MFA is built but users who lose their authenticator are locked out. Add a backup-codes endpoint and a recovery flow in Settings → Security.

- **Per-outlet inventory deduction** — The terminal deducts from the flat `inventory` table but `inventory_stock` is per-location. Wire the terminal checkout to deduct from the correct location's `inventory_stock` row.

### Future ideas

- **Redis rate limiting** — Replace the in-memory token bucket with a Redis-backed rate limiter for production multi-instance deployments.
- **Customer portal** — A separate Next.js app where B2B wholesale customers can log in, view invoices, and reorder.
- **Stripe Terminal integration** — Wire a real card reader (BBPOS WisePOS E) to replace the simulated card tender.
- **Multi-company** — Allow a single deployment to serve multiple independent tenant companies (separate schemas per tenant).
- **Data warehouse ETL** — Nightly aggregation job populating `daily_sales_summary` for fast dashboard queries.

---

## Blocked or waiting ⏸

- **Vendor quotations backend** — The vendor quotes tab in Purchasing is mock-only. Backend endpoints not built yet.
- **MFA email/SMS fallback** — TOTP MFA is built but no backup codes or email OTP path.
- **Redis** — Requires adding Redis infrastructure to the deployment. Not blocked by code — blocked by infra decision.

---

## What to build next

The most valuable next step is the inventory stock-by-location modal in Operations — the Stock Locations tab already shows the locations but there's no way to see what's actually stocked there, which makes the feature feel incomplete. After that, the barcode scanner toast is a tiny change with immediate cashier UX impact. The print-ready receipt template is the third priority — it's needed before any real-world pilot since thermal receipts are the main customer artifact of a POS transaction. None of these are blocked.

---

## Files to clean up 🗑

- `web/components/ModuleBlueprint.tsx` — stub component used by original placeholder pages before they were replaced with real implementations. Check if any page still imports it before deleting.
- `web/lib/useDesignProcess.ts` — not imported by any FinderPOS page. Safe to remove if confirmed unused.

---

## Archive

Older completed work (Sprints 1–7) is documented in `orchestration/ROADMAP.md` and the memory file `sprint_backlog.md`. Everything from the Lightspeed feature parity matrix (NuORDER catalog and mobile scanner app aside) is implemented.
