# Work Package 12: Frontend Shell, Navigation, And UX Separation

## Goal

Make Finder’s frontend render different user experiences by active business unit, role, capabilities, and permissions.

## Route Groups

Retail:

```txt
/retail/pos
/retail/orders
/retail/register
/retail/customers
/retail/inventory
/retail/reports
```

Wholesale:

```txt
/wholesale/dashboard
/wholesale/quotes
/wholesale/orders
/wholesale/picking
/wholesale/invoices
/wholesale/customers
/wholesale/reports
```

Admin:

```txt
/admin/catalog
/admin/pricing
/admin/inventory
/admin/purchasing
/admin/users
/admin/settings
/admin/integrations
/admin/audit
```

## Existing Files To Touch

- `web/app/(protected)/layout.tsx`
- `web/components/EnterpriseShell.tsx`
- `web/contexts/CapabilitiesContext.tsx`
- `web/contexts/PermissionsContext.tsx`
- `web/mocks/handlers.ts`
- `web/tests/capabilities.test.tsx`

## Frontend Requirements

- Business unit switcher.
- Module-aware sidebar.
- Route protection.
- Forbidden page for blocked deep links.
- Retail cashier lands on POS.
- Sales rep lands on wholesale dashboard/orders.
- Owner lands on combined business dashboard.

## Tests

- Navigation changes when active business unit changes.
- Unauthorized modules are hidden.
- Direct route access is blocked by frontend and backend.

## Acceptance Criteria

- The frontend never relies on hardcoded retail/wholesale visibility.
- `/api/v1/me/context` is the navigation source of truth.

