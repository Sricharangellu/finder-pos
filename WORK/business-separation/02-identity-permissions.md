# Work Package 02: Identity, Roles, Permissions, And User Access

## Goal

Extend Finder identity so access is separated not only by tenant, but also by
business unit, channel, location, and module capability. Tenants, users, JWT
auth, custom roles, and permissions already exist — build on them.

## User types

Base `Role` enum is `owner | manager | cashier` (see `src/identity/types.ts`);
the richer user types below are expressed as **custom roles + permission sets**,
not new base roles:

Owner · Admin · Retail manager · Retail cashier · Wholesale manager · Sales rep ·
Warehouse picker · Billing/AR user · Ecommerce manager · Accountant · Read-only analyst.

## Fine-grained permissions

```txt
retail.pos.open              retail.pos.checkout        retail.register.close
retail.refunds.create        wholesale.quotes.create    wholesale.sales_orders.approve
wholesale.credit.override    warehouse.pick_lists.assign billing.invoices.create
billing.ar.view              catalog.products.manage    pricing.price_books.manage
reports.retail.view          reports.wholesale.view     settings.manage
```

## Database changes

Create or extend:

```txt
users                       -- existing
custom_roles                -- existing
role_permissions            -- role → permission strings
user_business_unit_access   -- existing (WP 01); which BUs a user reaches
user_location_access        -- which stores/warehouses a user reaches
permission_requests         -- existing module; temporary approval workflow
audit_log                   -- existing; role/permission/login/sensitive actions
security_events             -- existing; auth + security anomalies
```

## Current repo files affected

- `src/gateway/auth.ts` — add the guards below.
- `src/identity/*` — JWT claims + role/permission plumbing.
- `src/modules/team`, `src/modules/custom_roles`, `src/modules/permission_requests`.
- `web/contexts/PermissionsContext.tsx` — already fail-closed (#26); extend with BU/permission awareness.

## Backend endpoints / work

JWT (and `/me/context`) must expose: `tenantId`, `userId`, `role`,
`businessUnitIds`, `storeIds`, `permissions`, and scopes.

Add middleware guards:

```txt
requirePermission(permission)
requireCapability(moduleKey, featureKey)
requireBusinessUnitAccess(businessUnitId)
requireLocationAccess(locationId)
```

- Support **temporary permission requests** (cashier asks a manager to approve a
  discount/return) via the existing `permission_requests` module.
- Write audit logs for role changes, permission changes, login events, and
  sensitive actions.

## Frontend screens

- User management page.
- Role editor.
- Permission matrix by module.
- Business unit assignment UI.
- Store/warehouse assignment UI.
- Permission request modal for restricted actions.

## Tests required

- A retail cashier cannot open wholesale invoice APIs.
- A sales rep cannot close a cash register.
- A warehouse picker can only view assigned pick lists.
- An owner can grant a temporary override.
- Permission changes are audited.

## Acceptance criteria

- Backend authorization holds even when frontend routes are called directly.
- A retail cashier cannot open wholesale invoices; a sales rep cannot close a register.
- A warehouse picker sees only assigned pick lists.
- Owner can grant temporary overrides; permission requests support manager approval.
- Permission and role changes are audited.

## Implementation checklist

- [ ] `role_permissions` + `user_location_access` tables (extend existing schema).
- [ ] JWT claims: `businessUnitIds`, `storeIds`, `permissions`.
- [ ] Guards `requirePermission` / `requireCapability` / `requireBusinessUnitAccess` / `requireLocationAccess` in `src/gateway/auth.ts` + unit tests.
- [ ] Wire guards into retail (WP 05) and wholesale (WP 06) routes.
- [ ] Temporary permission-request approval flow end-to-end.
- [ ] Audit entries for role/permission/login/sensitive actions.
- [ ] Frontend: user mgmt, role editor, permission matrix, BU/location assignment, request modal.
