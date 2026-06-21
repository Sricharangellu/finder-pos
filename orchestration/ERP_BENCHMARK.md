# Finder ERP — Benchmark & Parity Matrix

**Benchmark source:** `ERP-Prompt-Guide.html` (analysis of erp.fairtradetx.com) — an 18-prompt
spec for a **wholesale / distribution ERP**. This supersedes the earlier POS-only
benchmark: the target is now a full order-to-cash + procure-to-pay ERP with multi-store, tiered
B2B pricing, accounting, 60+ reports, and a tablet fulfillment surface.

Updated: 2026-06-13. Owner: backend agent. Frontend (Codex) owns `web/*`.

---

## How our build maps to the benchmark

Legend: ✅ built & live · 🟡 partial (foundation exists, gaps noted) · ⬜ not started

| # | Benchmark prompt | Status | What we have / what's missing |
|---|------------------|--------|-------------------------------|
| 1 | Architecture & tech stack | 🟡 | Modular monolith Node+TS+Express+Postgres, JWT access+refresh, tenant-scoped, in-process EventBus. Benchmark names NestJS/Prisma/Redis/S3/BullMQ — we meet the *capabilities* (auth, RBAC, pagination, search) on a lighter stack; Redis/S3/BullMQ deferred until needed. |
| 2 | Reusable DataTable | 🟡 | Backend supplies paginated/filtered list endpoints (`/inventory/levels`, orders, invoices) in the shape the grid needs. The component itself is frontend (Codex). |
| 3 | Products (master/child, 10 tabs) | 🟡 | catalog: products + multi-UPC barcodes, bulkImport, categories. **Missing:** master/child variants, per-product price tiers, accounting accounts, MSA fields, images, history tab. |
| 4 | Sales (Quote→SO→Invoice→Payment) | 🟡→✅ | orders + billing(invoices/AR) + payments live. **Wave A (this cycle):** quotations + sales orders with approval workflow, sales-rep/picker assignment, SO→invoice + SO→pick list. |
| 5 | Purchase (PO→Bill→Payment) | ✅ | purchasing: suppliers/vendors, POs (expiry/lot lines), receive, product_costs, vendor_credits (chargeback/credit_memo), vendor_returns. billing: bills (AP) auto-created from PO receive, payment_made flows. |
| 6 | Customers | 🟡 | customers + loyalty points. **Adding now:** tier (1-5). **Missing:** company/DBA/tax-id/license, billing/shipping address, per-customer price overrides, financial summary (due/excess/store-credit), tabs. |
| 7 | Vendors | ✅ | purchasing covers vendors: list with spend + open credits, returns, bills, payments. **Missing:** payment terms, bank/ACH details, store-credit ledger. |
| 8 | Shipping | 🟡 | fulfillment covers pick/pack + locations. **Missing:** shipping orders generated from invoices, carrier/tracking, mark shipped/delivered, packing slip. |
| 9 | Accounting (COA, batch deposit) | ⬜ | **Missing entirely:** Chart of Accounts, batch deposits with approval, deposit slips. High value — referenced by products, shipping, bills. |
| 10 | Reports (60+) | 🟡 | reports: summary, top-products, hourly, customer-summary. **Missing:** AR/AP aging, sales-by-(category/customer/rep/vendor), inventory valuation/aging, tax/MSA, P&L. |
| 11 | Discounts & Promotions | ⬜ | **Missing:** discount rules (simple/BXGY/volume/coupon), auto-apply, tier restriction, usage limits. |
| 12 | Employee & RBAC | 🟡 | team directory + roles exist; JWT carries role. **Missing:** Super Admin/Sales Rep/Picker permission matrix enforcement, commission config, store assignments. |
| 13 | Settings | 🟡 | outlets (stores/registers) live. **Missing:** shipping config, payment terms, payment modes, tax/excise rules, COA mgmt, feature flags, business profile. |
| 14 | E-commerce | ⬜ | **Missing:** online catalog flag→storefront, ecommerce-channel SO flow, customer portal. (Ecommerce store already exists as an outlet/channel concept.) |
| 15 | Global search & notifications | 🟡 | per-entity search exists on list endpoints. **Missing:** unified `/search` across entities; webhooks module can back notifications (low-stock/overdue/PO-received). |
| 16 | Tablet fulfillment | 🟡 | fulfillment pick lists + pick/pack API are the backend for this. **Missing:** picker-scoped pick queue, barcode validate-against-expected, "complete pick" → ship handoff. |
| 17 | Performance | 🟡 | tenant+status+created indexes throughout, keyset-capable list queries, rate limiting per tenant. **Missing:** Redis cache, cursor pagination on the largest tables, background jobs. |
| 18 | Auth & multi-store | 🟡 | JWT access(15m)+refresh, tenant isolation, role in token. outlets = stores. **Missing:** `storeIds[]` in token + global `?storeIds=` filter across every list, store-tagging on every transactional row. |

---

## Wave roadmap (backend, benchmark-ordered)

**Wave A — Sales workflow (in progress):** Quotations + Sales Orders module. Status flows, sales-rep
+ picker assignment, quote→SO, SO approve, SO→invoice (billing), SO→pick list (fulfillment). Add
customer `tier`. — *closes most of #4, advances #16.*

**Wave B — Customer/Vendor depth + tier pricing:** company/DBA/tax-id/license/addresses on customers,
financial summary (due/excess/store-credit), per-customer price overrides, tier price resolution feeding
SO/invoice unit price. Vendor payment terms + bank details. — *#6, #7.*

**Wave C — Accounting:** Chart of Accounts (assets/liabilities/income/expenses tree), batch deposits with
approval workflow, deposit slip. Wire product accounting accounts + shipping COA. — *#9.*

**Wave D — Shipping:** shipping orders auto-generated from invoices, carrier/tracking, mark
shipped/delivered, packing slip / label. Ties to fulfillment packing. — *#8.*

**Wave E — Reports build-out:** AR/AP aging, sales-by-(category/customer/rep/vendor/product), inventory
valuation/aging, P&L, tax/MSA. Reuse existing event-sourced data. — *#10.*

**Wave F — Discounts engine + multi-store filter:** discount rules + auto-apply + coupon + tier
restriction; `storeIds[]` in JWT and global store filter on all list endpoints. — *#11, #18.*

**Wave G — Settings + RBAC enforcement + global search:** settings CRUD (shipping/terms/modes/tax/COA/
flags), permission-matrix middleware, unified `/search`. — *#12, #13, #15.*

**Wave H — Ecommerce + performance hardening:** storefront catalog flag, ecommerce SO channel, customer
portal; Redis/cursor-pagination/background-jobs where load warrants. — *#14, #17.*

---

## Conventions (unchanged)
Modular monolith; each module = `index.ts`(migrations+register) + `service.ts` + `routes.ts` +
`test-request.ts`. Tenant-scoped (`tenant_id`). Money = integer cents (BIGINT). Timestamps = epoch ms.
IDs = prefixed uuidv7. Cross-module coupling via EventBus only. Routes under `/api/v1/<module>` behind
auth + tenant middleware. Migrations idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
