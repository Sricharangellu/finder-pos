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
2. **Split oversized pages** — customers/[id] (1705), catalog (1498), inventory (1229), purchasing (~1202)
3. **Fix `as any` in 4 production files** (TypeScript — HIGH)
4. **Add `role="alert"` to error messages** (Accessibility — widespread)
5. **Replace `(cents / 100).toFixed(2)` with `formatMoney()`** (Design system)

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

- [ ] **Page size — split required** — 5 pages still exceed 800-line threshold (settings: ✅ done 1818→1003):
  - `customers/[id]/page.tsx` — ✅ DONE: 1705→441 ln, 9 files in `customers/[id]/_components/`
  - `catalog/page.tsx` — 1498 ln
  - `inventory/page.tsx` — 1229 ln
  - `purchasing/page.tsx` — ~1202 ln
  - `purchasing/[id]/page.tsx` — ~982 ln

### LOW (polish — backlog)

- [ ] `web/lib/offlineOutbox.ts` — IDB typing `(req.result as T[]).sort((a: any, b: any)...)` — use `IDBRequest<T[]>`.
- [ ] `web/lib/offlineOutbox.ts:176` — `(registration as any).sync.register(...)` — add ambient `BackgroundSyncManager` type.
- [ ] 9 stub pages report "no loading state" — these are pure re-exports with zero async work; false positive for that check. No action needed.

### Next session must-do (Claude's priority queue)

Score: 93/100 — launch-ready, zero CRITICAL. Fix remaining MEDIUM before v2:

1. **Finish date.ts migration** — convert remaining local `fmtDate`/`fmtTime` in insights, ecommerce, purchasing, quotes, workforce to import from `@/lib/date`
2. **Split oversized pages** — customers/[id] (1705), catalog (1498), inventory (1229), purchasing (~1202) — extract tab content into `_components/` subdirs
3. **Golf vertical** — tee sheet, bookings, members, pro-shop pages (types + mock handlers complete; pages not yet wired)
4. **Backend connection** — replace MSW with live Postgres + Express; `db-schema` skill for migrations
