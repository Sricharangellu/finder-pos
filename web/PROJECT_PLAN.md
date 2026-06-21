# Project Plan — FinderPOS
Last updated: 2026-06-20

## What we built so far

FinderPOS is a full-stack enterprise POS platform competing directly with Lightspeed POS across three verticals: **Retail** (tobacco, vape, CBD, liquor, apparel, electronics, pet, sporting goods, jewelry, gift), **Restaurant** (bar, brewery, cafe, fine dining, quick service, hotel), and **Golf** (tee sheet, pro shop, driving range, resort). The frontend has 33 protected pages covering every area of a retail business — from a real-time POS terminal to MSA compliance reporting and loyalty program management. Phase 1 targets tobacco/vape/liquor retail where FinderPOS has a compliance edge Lightspeed lacks.

---

## Done ✅

- **POS Terminal** — touch-friendly register with barcode scanner, split tender, age verification, offline sync, receipt printing/emailing; barcode scan toast; thermal receipt print template
- **Dashboard** — KPI tiles with trend indicators, Recharts revenue trend + hourly bar charts, sales-by-category breakdown, top products/customers; New Quote quick-action
- **Catalog** — product browse, filter, bulk-select, CSV import/export, barcode generation, master/variant product management
- **Inventory** — stock levels, lot/expiry tracking (FEFO), cycle counts, reorder alerts, SSE low-stock notifications; Stock Locations tab (per-outlet) with View Stock modal
- **Orders** — order list, detail drawer, status management, cursor pagination
- **Customers** — CRM list, detail page with loyalty tier card (tier badge, points, progress bar), financial summary, collapsible Addresses, Contacts, Notes sub-panels
- **Quotations (/quotes)** — create quotes with line items, send, convert to order, full status lifecycle
- **Sales / Sales Orders** — sales order create/approve/invoice workflow, credit limit enforcement
- **Purchasing** — PO create/receive (partial receive), supplier management, vendor quotes tab (feature-flagged)
- **Discounts** — rule builder (simple/volume/BXGY), coupon codes, per-customer limits
- **Gift Cards** — issue, check balance, void
- **Loyalty Program (/loyalty)** — tier configuration, points rules, member lookup, tier assignment, points adjustment with audit trail
- **Workflows** — visual workflow builder with per-outlet step configuration, step type badges, inline enable/disable
- **Insights** — velocity-based reorder recommendations, scheduled report emails, "Create Draft POs" button
- **Reports** — 8 report types (sales, P&L with BarChart, AR/AP aging, inventory, expiry, sales-by-rep, sales-by-vendor); Recharts AreaChart on sales report
- **Accounting** — chart of accounts, journal entries, batch deposits (approve flow)
- **Finance** — AR/AP aging surface with payment actions
- **Settings** — 12 sections: store profile, shipping, payment terms/modes, tax rates, feature flags, security (MFA setup), COA, deposits, loyalty tiers, API keys, currencies
- **Tax & Compliance** — tax rate management, MSA reporting table (tobacco/vapor UPC data), state tax reference, customer exemptions placeholder
- **Operations** — fulfillment locations, pick lists, outlets/registers, stock locations tab with View Stock modal
- **Notifications Center (/notifications)** — notification feed with category filters, mark-read, dismiss, SSE real-time indicator
- **Audit Log (/audit-log)** — security and change audit log with actor/action/entity filters, cursor pagination, CSV export
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

- **Compliance product flags + state enforcement** — Catalog product detail needs flavored/menthol/tobacco_type/msa_reportable/restricted_states fields. Terminal add-to-cart must block restricted products when the active outlet's state is in the product's banned-states list. Critical for smoke shop go-live.

- **Reorder auto-draft POs** — Insights page "Create Draft POs" button does nothing. Wire it to `POST /api/v1/purchasing/orders/auto-draft` which creates draft POs for all items below reorder point and redirects to Purchasing.

- **Stripe Terminal card reader simulation** — After Charge, show a polished "Tap / Swipe / Insert card" animation screen with a 2-second simulated processing state before completing payment. Required for demo credibility.

- **Terminal numpad quantity modal** — Tapping a cart line's quantity opens a numpad modal (not a text field). UX researcher requirement for high-volume cashier accuracy.

### Coming up (next wave of work)

- **Deploy to Vercel** — Run `bash deploy.sh` from repo root when ready.

- **EBT/SNAP split tender** — Phase 2 grocery feature: auto-split cart into EBT-eligible and non-eligible totals when EBT tender selected.

- **Random-weight barcode parsing** — EAN-13 starting with `2` encodes the price; parse embedded price instead of catalog price.

### Phase 2 — General Retail expansion (after Phase 1 live store)

- **Service Orders module** — repair ticket management for bike shops, electronics, jewelry repair; ticket status, assigned tech, parts used, customer pickup notification
- **Serialized inventory** — track individual units by serial number (electronics, jewelry, bikes)
- **Workforce & Payroll** — employee scheduling, clock in/out, timesheet export, tip pooling
- **Capital module** — business financing application flow (partner API integration)
- **Matrix variants UI** — size × color grid for apparel, instead of flat variant list
- **Layaway / payment plans** — deposit + installment schedule for high-ticket items

### Phase 3 — Restaurant vertical

- **Table management** — floor plan editor, seat assignment, table status (available/occupied/reserved/dirty)
- **Kitchen Display System** — tablet view for kitchen; incoming orders by course, bump when ready
- **Tableside ordering** — handheld POS; QR code "Order Anywhere" for self-serve
- **Open bar tabs** — tab stays open across multiple rounds, closed at end of night
- **Split check** — divide bill N ways or by item
- **Reservations** — reservation book with time slots, waitlist, guest notes
- **Course-based ordering** — send appetizers, hold mains, fire on signal
- **Benchmarks & Trends** — compare key metrics against industry averages by sub-type

### Phase 4 — Golf vertical

- **Tee Sheet** — daily time-slot grid, group booking, cart assignment, player names
- **Membership management** — season passes, tier pricing, handicap tracking
- **Course configuration** — multi-course, hole count, pricing by time/season
- **Pro shop integration** — retail POS attached to golf context (same catalog/inventory)

### Cross-vertical (add to all phases)

- **Public API + webhooks** — documented REST API for third-party integrations
- **Redis rate limiting** — Replace in-memory token bucket for multi-instance deployments
- **Customer portal** — B2B customers log in, view invoices, reorder
- **Lightspeed AI equivalent** — demand forecasting, smart reorder suggestions, AI-written product descriptions
- **Multi-company** — Per-tenant schemas for franchise/multi-brand operators
- **Data warehouse ETL** — Nightly aggregation for fast dashboard queries

---

## Blocked or waiting ⏸

- **Vendor quotations backend** — vendor quotes tab in Purchasing is mock-only.
- **MFA email/SMS fallback** — TOTP built but no backup codes or email OTP path.
- **Redis** — Requires infra decision before adding.

---

## What to build next

Compliance product flags are the Phase 1 smoke-shop go-live blocker with the highest priority score (V5/E2). Without them, a cashier can sell a CA-banned flavor in California and the store gets a violation. Pairing compliance enforcement with the Stripe Terminal simulation and numpad UX brings the terminal to demo-ready state for the first live store visit.

---

## Files to clean up 🗑

- `web/components/ModuleBlueprint.tsx` — stub component from original placeholder pages; check if still imported before deleting.
- `web/lib/useDesignProcess.ts` — not imported anywhere; safe to remove if confirmed.
