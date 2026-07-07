# Work Package 12: Frontend Shell, Navigation, And UX Separation

## Goal

The visible experience changes by active business unit and role. The frontend is
NOT one giant menu — it renders from `GET /api/v1/me/context` (shipped in PR #36).
No hidden frontend-only security: every deep link is re-checked by the backend.

## Navigation groups

Retail shell: POS · Orders · Returns · Customers · Inventory · Register · Reports.

Wholesale shell: Dashboard · Quotes · Sales Orders · Customers · Picking ·
Invoices · AR · Reports.

Admin shell: Catalog · Pricing · Inventory · Purchasing · Users · Settings ·
Integrations · Audit.

## Route structure

```txt
/retail/pos        /retail/orders     /retail/register   /retail/customers
/retail/inventory  /retail/reports
/wholesale/dashboard /wholesale/quotes /wholesale/orders  /wholesale/picking
/wholesale/invoices  /wholesale/customers /wholesale/reports
/admin/catalog     /admin/pricing     /admin/inventory   /admin/purchasing
/admin/users       /admin/settings    /admin/integrations /admin/audit
```

## Current repo files affected

- `web/app/(protected)/layout.tsx`, `web/components/EnterpriseShell.tsx`.
- `web/contexts/CapabilitiesContext.tsx`, `web/contexts/PermissionsContext.tsx` (fail-closed, #26).
- `web/mocks/handlers.ts`, `web/tests/capabilities.test.tsx`.
- New route groups: `web/app/(protected)/{retail,wholesale,admin}/*`.

## Frontend requirements

- Business-unit switcher.
- Role-aware sidebar; module-aware route protection.
- Shared layout system with separate retail and wholesale workflows.
- No frontend-only security assumption; deep links re-checked by the backend.
- If the user has no access, show a proper forbidden page.

## Landing pages

- Retail cashier lands on POS.
- Sales rep lands on wholesale orders/dashboard.
- Owner lands on the combined business dashboard.

## Tests required

- Navigation changes when the active business unit changes.
- Unauthorized modules are not shown and cannot be opened.
- Direct/deep route access is blocked by both frontend and backend.

## Acceptance criteria

- Retail cashier → POS; sales rep → wholesale orders; owner → business dashboard.
- Switching business unit changes visible modules.
- The frontend never relies on hardcoded retail/wholesale visibility — `/me/context` is the source of truth.

## Implementation checklist

- [ ] Consume `/me/context` in `layout.tsx` + `EnterpriseShell` (nav from `businessUnits`/`modules`/`permissions`).
- [ ] Business-unit switcher (calls `POST /me/switch-business-unit`, WP 01).
- [ ] `(protected)/{retail,wholesale,admin}/*` route groups + per-route guard.
- [ ] Forbidden page for blocked access.
- [ ] Role/BU-based landing redirects.
- [ ] Tests: nav-by-context, hidden modules, deep-link block.
