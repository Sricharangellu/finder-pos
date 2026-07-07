# Work Package 02: Identity, Roles, Permissions, And User Access

## Goal

Extend Finder identity so access is separated by tenant, business unit, channel, location, role, and permission.

## User Feature Separation

- Retail cashier can checkout and process allowed returns.
- Retail manager can close registers and approve overrides.
- Wholesale sales rep can create quotes and sales orders.
- Warehouse picker can only view assigned picking work.
- Billing user can manage invoices and AR.
- Owner/admin can configure all business units.

## Data Scheme

Extend or add:

```sql
custom_roles
role_permissions
user_business_unit_access
user_location_access
permission_requests
audit_log
security_events
```

Permission examples:

```txt
retail.pos.checkout
retail.register.close
retail.refunds.create
wholesale.quotes.create
wholesale.sales_orders.approve
wholesale.credit.override
warehouse.pick_lists.assign
billing.invoices.create
billing.ar.view
catalog.products.manage
pricing.price_books.manage
reports.retail.view
reports.wholesale.view
settings.manage
```

## Existing Files To Touch

- `src/gateway/auth.ts`
- `src/identity`
- `src/modules/team`
- `src/modules/custom_roles`
- `src/modules/permission_requests`
- `web/contexts/PermissionsContext.tsx`

## Backend Work

Add guards:

```txt
requirePermission(permission)
requireCapability(moduleKey, featureKey)
requireBusinessUnitAccess(businessUnitId)
requireLocationAccess(locationId)
```

JWT/session context should expose `tenantId`, `userId`, `role`, `businessUnitIds`, `storeIds`, `permissions`, and scopes.

## Frontend Work

- Role editor.
- Permission matrix.
- Business unit assignment UI.
- Store/warehouse assignment UI.
- Permission request modal for restricted actions.

## Tests

- Retail cashier cannot open wholesale invoice APIs.
- Sales rep cannot close register.
- Warehouse picker cannot view unrelated pick lists.
- Permission changes are audited.

## Acceptance Criteria

- Backend authorization works even if frontend routes are manually called.
- Permission requests support manager override flows.

