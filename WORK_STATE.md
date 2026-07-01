# FinderPOS — Work State
> Last updated: 2026-06-30  |  Last commit: `fc6aa85`

---

## Launch-readiness status

| Area | Status | Notes |
|---|---|---|
| **Authentication** | ✅ Built | Login (368 ln), Signup (174 ln), protected layout, route guard |
| **Terminal / Register** | ✅ Built | Full checkout: barcode scan, cart, tender, receipt, offline queue, card reader screen |
| **Product Catalog** | ✅ Built | List + filters + sort + bulk update + CSV import/export + duplicate + image + detail page + variants + price book |
| **Inventory** | ✅ Built | Overview, receive stock, counts, serials, expiry, reorder suggestions, locations, transfers (via operations) |
| **Purchasing / POs** | ✅ Built | PO list + tabbed detail (lines, receive, billing, credits), reorder suggestions → PO creation |
| **Orders** | ✅ Built | Order list + status filter |
| **Customers** | ✅ Built | List + customer detail + purchase history + loyalty points |
| **Sales Analytics** | ✅ Built | Sales page, insights, reports suite (8 sub-reports) |
| **Reports** | ✅ Built | Sales, AR aging, P&L, inventory, expiry, sales-by-rep, sales-by-vendor, end-of-day, register closures, time cards |
| **Vendors** | ✅ Built | Vendor list + vendor detail |
| **Purchasing** | ✅ Built | PO list + detail tabs |
| **Loyalty** | ✅ Built | Tiers, member list, rewards management |
| **Gift Cards** | ✅ Built | Issue, balance check, transaction history |
| **Discounts / Promotions** | ✅ Built | Discounts page + catalog promotions page (full CRUD) |
| **Returns** | ✅ Built | Returns page at /returns |
| **Payments** | ✅ Built | Payment list + reconciliation |
| **Quotes** | ✅ Built | Quote builder + convert to order |
| **Service Orders** | ✅ Built | Work order list + status pipeline |
| **Invoicing** | ✅ Built | Customer invoices, line items, status workflow |
| **Workforce** | ✅ Built | Employee list, shift scheduler, time-off requests |
| **Ecommerce** | ✅ Built | Store settings, sync status, channel management |
| **Finance** | ✅ Built | P&L overview, accounts, COA |
| **Accounting** | ✅ Built | Journal entries, reconciliation |
| **Operations** | ✅ Built | Outlet management, register sessions, transfer orders |
| **Shipping** | ✅ Built | Shipment tracking, carrier config |
| **Tax Compliance** | ✅ Built | MSA/PACT reporting, state flavor ban tracking |
| **Team / Roles** | ✅ Built | Staff list, custom roles, permissions |
| **Workflows** | ✅ Built | Automation rules, condition/action builder, step editor |
| **Settings** | ✅ Built | Mega-page: store profile, tax rates, payment modes, loyalty tiers, shipping, security, COA, receipt templates, API keys, currencies |
| **Setup** | ✅ Built | Business profile, modules toggle — sub-pages route to correct Settings section |
| **Integrations** | ✅ Built | App marketplace, connected integrations |
| **Notifications** | ✅ Built | Notification inbox + channel preferences |
| **Audit Log** | ✅ Built | System event log with actor + resource |
| **Imports / Exports** | ✅ Built | CSV/bulk import jobs, export scheduler |
| **Onboarding** | ✅ Built | First-run setup wizard |
| **Tax Compliance** | ✅ Built | PACT Act, MSA reporting, state restrictions |
| **Display** | ✅ Built | Customer-facing display screen |
| **Appointments** | ✅ Built | Appointment scheduler |

### Vertical modules

| Vertical | Status | Pages |
|---|---|---|
| **Restaurant** | ✅ Built | Floor plan, kitchen display, tabs |
| **Automotive** | ✅ Built | Vehicles, work orders |
| **Healthcare** | ✅ Built | Patients, prescriptions, dispense |
| **Hospitality** | ✅ Built | Rooms, charges, settle |
| **Education** | ✅ Built | Students, fees, collect |
| **Entertainment** | ✅ Built | Events, tickets, QR redeem |
| **Manufacturing** | ✅ Built | Production orders, BOM, status |
| **Rental** | ✅ Built | Asset register, contracts, return |
| **Golf** | ✅ Built | Tee sheet, bookings, members, pro-shop — 4 pages + nav wired |

---

## Mock handler coverage

All API routes for built modules have MSW handlers in `web/mocks/mockHandlers.ts`.

Key patterns:
- `V1 = "*/api/v1"` wildcard prefix
- `await lat()` first line in every handler
- IIFE spread pattern: `...(() => { let state; return [...handlers]; })(),`
- Sub-paths registered BEFORE `/:id` to avoid wrong matching

---

## Known bad redirects (quick fixes)

| Route | Currently redirects to | Should redirect to |
|---|---|---|
| `/inventory/returns` | `/vendors` | `/returns` |
| `/setup/loyalty` | `/settings` | `/loyalty` |

---

## Context cliff notes

- Pages: `web/app/(protected)/[module]/page.tsx`
- Mock handlers: `web/mocks/mockHandlers.ts` (NOT lightspeedHandlers.ts)
- Types: `web/api-client/types.ts`
- API client: `web/api-client/client.ts` → `apiGet / apiPost / apiPatch / apiDelete`
- Nav shell: `web/components/EnterpriseShell.tsx` — 3 places to update per new nav item
- Money: `formatMoney(cents)` from `@/lib/money`
- Catalog products in mock: `prod_1`–`prod_8`
- Settings page covers: taxes, payment modes, loyalty tiers, shipping, security, COA, receipts, API keys

---

## Next targets (priority order for launch)

1. **Golf vertical** ✅ DONE — 4 pages + nav wired; `module: "golf"` → `module: "tee_sheet"` fixed
2. **FE-R4: Restaurant Dashboard** ✅ DONE — `/restaurant/dashboard` with KPIs, hourly chart, top items, active sessions (2026-07-01)
3. **UX-2: Module marketplace** ✅ DONE — `/setup/modules` page already complete
4. **UX-3: Vertical dashboard widgets** ✅ DONE — `VerticalWidgets.tsx` already complete
5. **Split oversized pages** — reports/page.tsx ✅ DONE (866→246 ln); next: customers/page.tsx (810 ln), dashboard (803 ln), discounts (765 ln)
6. **Settings page split** ✅ DONE — CoaSection, DepositsSection, LoyaltyTiersSection extracted (2026-07-01)

---

## Enterprise Guardian — Last Audit

> Run: 2026-06-30 (post customers/[id] split)  |  Score: 94/100  |  Status: ✅ LAUNCH-READY (≥88, zero CRITICAL)
> Prior score: 93/100 → +1 pt (customers/[id] split 1705→441 ln, 9 extracted _components files, zero TS errors)

### Domain Scores

| Domain | Score | Grade | Top Finding |
|---|---|---|---|
| TypeScript strictness | 100/100 | ✅ | Zero `error TS`, zero unguarded `any` in production code |
| Security | 98/100 | ✅ | Zero secrets, no XSS, no dangerouslySetInnerHTML |
| API contract | 92/100 | ✅ | All FE-51/FE-52 handlers correct; `await lat()` on all |
| Component quality | 88/100 | ✅ | customers/[id] split (1705→441 ln); catalog (1498) next |
| Accessibility | 95/100 | ✅ | `role="alert"` on all errors; icon buttons labeled |
| Performance | 89/100 | ✅ | 2 page splits done; catalog (1498), inventory (1229), purchasing still >800 ln |
| Design system | 86/100 | ✅ | `web/lib/date.ts` created; 5 import sites fixed; formatMoney + border-slate-200 done |
| Nav/routing | 97/100 | ✅ | All stubs verified valid; no bad redirects remaining |

### CRITICAL (blocks launch — fix first)

_None. TypeScript clean, security clean, all stubs point to real files._

### HIGH (degrading enterprise readiness)

_None._

### MEDIUM (tech debt — fix before v2)

- [x] **Design system — local date helpers** — ✅ DONE: `web/lib/date.ts` created with `fmtDate`, `fmtDateShort`, `fmtDateTime`, `fmtTime`; 5 import sites fixed (payments, appointments, imports-exports, inventory/counts, inventory/serials). Remaining pages (insights, ecommerce, purchasing, quotes, workforce) still have local definitions — audit these next.

- [ ] **Design system — money in form inputs** — `(cents / 100).toFixed(2)` used to seed edit-form inputs in `catalog/page.tsx` (ln 94, 98, 99, 843–845), `customers/[id]/page.tsx` (ln 680, 699), `accounting/page.tsx` (ln 336). Correct for edit inputs (need dollar string), but comment-document why to avoid false audit flags.

- [ ] **Page size — split required** — pages exceeding 800-line threshold:
  - `settings/page.tsx` — ✅ DONE: 1818→644 ln (CoaSection, DepositsSection, LoyaltyTiersSection extracted)
  - `customers/[id]/page.tsx` — ✅ DONE: 1705→441 ln, 9 files in `customers/[id]/_components/`
  - `reports/page.tsx` — ✅ DONE: 866→246 ln (4 section files + reportHelpers.tsx)
  - `customers/page.tsx` — 810 ln — next split candidate
  - `dashboard/page.tsx` — 803 ln — next split candidate

### LOW (polish — backlog)

- [ ] `web/lib/offlineOutbox.ts` — IDB typing `(req.result as T[]).sort((a: any, b: any)...)` — use `IDBRequest<T[]>`.
- [ ] `web/lib/offlineOutbox.ts:176` — `(registration as any).sync.register(...)` — add ambient `BackgroundSyncManager` type.
- [ ] 9 stub pages report "no loading state" — these are pure re-exports with zero async work; false positive for that check. No action needed.

### Next session must-do (Claude's priority queue)

Score: 94/100 — launch-ready, zero CRITICAL. Fix remaining MEDIUM before v2:

1. **Split customers/page.tsx (810 ln)** — extract filter bar, table, customer detail drawer to `_components/`
2. **Split dashboard/page.tsx (803 ln)** — extract KPI section, top products, payment breakdown
3. **Split discounts/page.tsx (765 ln)** — extract discount form, promotions section
4. **Finish date.ts migration** — replace `new Date(x).toLocaleDateString()` with `fmtDate(x)` across: hospitality, golf/members, reporting/purchases, restaurant/tabs, gift-cards, rental, sales, catalog/[id], entertainment, education, operations

**Done this session (2026-07-01):**
- Settings page split: CoaSection + DepositsSection + LoyaltyTiersSection → `_components/` (1003→644 ln)
- FE-R4 Restaurant Dashboard: `/restaurant/dashboard` — covers, avg ticket, table turns, peak hour, hourly revenue chart, top items, active sessions
- reports/page.tsx split: 4 sections → `_components/` (866→246 ln); shared helpers in reportHelpers.tsx
