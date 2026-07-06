# Audit — Backend↔Frontend Wiring Matrix (2026-07-06T01:03:52Z)

Foundation Hardening §3. Runtime-probed every distinct `/api/v1/<prefix>` the frontend
calls, against the REAL Express backend on Postgres (not mocks), with a real owner token.
First collision-proof-named audit (timestamp, not letter).

## Method & headline

- 54 distinct `/api/v1/<prefix>` prefixes are called across `web/app|components|hooks|lib|contexts|api-client`.
- A bare `GET /api/v1/<prefix>` returns 404 when a module has no *root* route — that is
  NOT "missing" (e.g. `reports` 404s at `/reports` but 200s at `/reports/summary`).
  Verified this by spot-checking sub-paths: reports/summary, accounting/accounts,
  sales/orders, purchasing/suppliers, settings/capabilities, sync/status → all 200.
- **46 of 54 prefixes map to a registered backend module (wired).** 8 prefixes had no
  backend module at all; classified below.

## Truly unwired prefixes (8) — classified

| Prefix | Called from | Verdict |
|---|---|---|
| `things` | `web/api-client/client.ts:234` | **FALSE POSITIVE** — a JSDoc example (`apiGet<Items>("/api/v1/things")`), not a real call. Ignore. |
| `auth/*` | `settings/_components/SecuritySection.tsx`, `login/page.tsx` | **REAL DRIFT** — calls `/api/v1/auth/backup-codes` + `/api/v1/auth/login`; auth is served under `/api/identity/*`, so these 404 on the real backend (MFA/security settings work only via mock). Fix at the fetch boundary (point to the real auth path) or add the alias. Retail-adjacent (account security). |
| `promotions` | `catalog/promotions/page.tsx` | **REAL GAP** — full promotions UI (coupons, bundles, flash-sales, stackability, analytics) with no backend; backend has a separate `discounts` module. Promotion Engine domain. Needs a backend build. |
| `permission-requests` | `settings/permissions/page.tsx`, `team/[id]/page.tsx` | **REAL GAP** — RBAC permission-request/approval flow is UI+mock only (404). Needs a backend. |
| `documents` | `documents/_components/*` | Expected — Document Center (domain 9, Not started). UI-only by design. |
| `pricing` | `pricing/page.tsx` | Expected — Pricing Engine (domain 5, embedded in products). UI-only preview. |
| `warehouse` | `warehouse/page.tsx` | Expected — WMS (domain 4, Not started). UI-only preview. |
| `golf` | `golf/*` | Expected — golf VERTICAL, Preview per RULES.md (non-retail packs are Preview until retail is complete). |

## Already fixed this initiative-adjacent

- `product-locations` / `store-locations` mount mismatch — FIXED (`ae79907`): store_locations
  module now mounts at `/api/v1` so the inventory/locations page resolves against the real
  backend. Was the same class of bug (retail-core page working only on mocks).

## Status summary (honest labels)

- **Wired & working (real backend):** the retail core + all domain modules — catalog,
  inventory, orders, payments, outlets/registers, reports, accounting, purchasing, sales,
  settings/capabilities, sync, ecommerce, loyalty, billing, fulfillment, insights,
  monitoring, customer-invoices, product-batches, service-orders, and the vertical modules.
- **Real drift to fix (small):** `auth/*` (MFA/security settings path).
- **Real gaps needing a backend build (features, not cleanup):** `promotions`,
  `permission-requests`.
- **Expected UI-only / Preview (NOT bugs — per RULES.md):** `documents`, `pricing`,
  `warehouse`, `golf`.

## Recommended follow-up (queue items — NOT done here; features are out of cleanup scope)

1. Fix the `auth/*` fetch-path drift (MFA backup codes / security settings) — small.
2. Build the `promotions` backend (Promotion Engine) OR clearly mark the promotions page
   Preview until built.
3. Build the `permission-requests` backend OR mark that flow Preview.
4. Leave documents/pricing/warehouse/golf as Preview until their phase.

Field-level shape drift (mock camelCase vs backend snake_case) was NOT exhaustively
diffed here — endpoint-existence was the scope. A follow-up could probe each wired
endpoint in mock vs real mode and diff response shapes.
