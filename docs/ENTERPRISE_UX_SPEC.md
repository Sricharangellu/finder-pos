# Ascend — Enterprise UI/UX, Page Connections, Tabs, RBAC & User Controls

> Authoritative design spec for Ascend enterprise UI. Every new page, component, and
> RBAC implementation must conform to these standards.

---

## 1. Global UI/UX Principles

Ascend UI must be:
- Modern enterprise-grade
- Fast, responsive, accessible
- Role-aware and permission-aware
- Mobile/tablet/desktop ready
- Offline-aware for POS terminal
- Consistent across all modules

### Reusable primitives (always use these, never reinvent)

| Primitive | When to use |
|---|---|
| `Card` | Any content container |
| Data table | All list views — with search, sort, filters, bulk actions |
| Form layout | Sectioned with required indicators + inline validation |
| Status badge | All status/state indicators |
| Modal | Create, edit, confirmations |
| Confirmation dialog | Any destructive or sensitive action |
| Empty state | Zero results / first-use |
| Loading skeleton | Any async content |
| Permission guard | All action buttons and sensitive fields |

### Spacing
- 8px base spacing system (Tailwind: `gap-2 = 8px`, `gap-4 = 16px`, etc.)

### Strict enforcement (hard rules, not preferences)

These are mandatory for every new or edited page/component. `AGENTS.md` → "Design System Rules"
restates them for agents; treat a violation like a failing gate.

- **Colors:** use the design tokens in `web/tailwind.config.ts` only — `brand`, `erp`, and semantic
  (`success`/`warning`/`danger`). No hard-coded hex (`#0137FC`, `bg-[#1890FF]`) and no raw
  default-palette classes (`text-slate-500`, `bg-red-50`, `border-gray-200`) in pages/components;
  map them to `erp`/semantic tokens. New colors become named tokens first.
- **Primitives:** always use the components above (`Button`, `Input`, `Select`, `Card`, `Table`,
  `Modal`, `Badge`, `EmptyState`, `Skeleton`, `KpiCard`…). No raw `<button>`, `<input>`, `<select>`
  in feature pages — extend the primitive if a variant is missing.
- **Accessibility:** WCAG 2.1 AA — visible `focus-visible` state, accessible name/label, ≥44px touch
  target, keyboard operable, AA contrast.
- **Branding:** never bake an old/other product name (`SalesGent`, `Finder`) into tokens, styles, or
  copy. The product is Ascend.

---

## 2. Main App Layout

```
App Shell
 ├── Left Sidebar Navigation
 ├── Top Header Bar
 ├── Breadcrumbs
 ├── Page Header
 ├── Page Tabs
 ├── Main Content Area
 ├── Right Context Panel
 └── Notification Center
```

### Sidebar sections

```
Dashboard
POS
Orders
Products
Inventory
Customers
Purchasing
Vendors
Payments
Gift Cards
Reports
Team
Settings
Audit Logs
Integrations
```

Sidebar items **must hide or disable** based on RBAC permissions. Never show a nav item if the user lacks `[module].view`.

---

## 3. Page Header Properties

Every major page must have:

| Element | Always | Permission-gated |
|---|---|---|
| Page title | ✓ | — |
| Page description | ✓ | — |
| Breadcrumb | ✓ | — |
| Search | ✓ | — |
| Filters | ✓ | — |
| Last updated timestamp | ✓ | — |
| Help tooltip | ✓ | — |
| Import button | — | `[module].import` |
| Export button | — | `[module].export` or `reports.export` |
| Primary action (Create) | — | `[module].create` |
| Secondary action | — | varies |

Example:
```
Products
Manage products, variants, pricing, barcodes, and inventory tracking.
[Import] [Export] [Create Product]
```

---

## 4. Global Page Tabs Pattern

Every enterprise detail page uses connected tabs.

### Product Detail Page
```
Product Detail
 ├── Overview
 ├── Variants
 ├── Pricing
 ├── Inventory
 ├── Vendors
 ├── Sales History
 ├── Audit Log
 └── Settings
```

### Customer Detail Page
```
Customer Detail
 ├── Overview
 ├── Orders
 ├── Payments
 ├── Store Credit
 ├── Loyalty
 ├── Addresses
 ├── Notes
 ├── Audit Log
 └── Settings
```

### Outlet Detail Page
```
Outlet Detail
 ├── Overview
 ├── Registers
 ├── Inventory
 ├── Employees
 ├── Taxes
 ├── Cash Drawers
 ├── Reports
 ├── Devices
 └── Settings
```

### Team User Detail Page
```
User Detail
 ├── Profile
 ├── Roles
 ├── Permissions
 ├── Outlet Access
 ├── Activity
 ├── Sessions
 ├── Security
 └── Audit Log
```

### Role Detail Page
```
Role Detail
 ├── Overview
 ├── Permissions
 ├── Assigned Users
 ├── Outlet Restrictions
 ├── Approval Rules
 └── Audit Log
```

---

## 5. Page Connection Architecture

Pages connect logically — use `href` links, not dead ends.

```
Dashboard
 ├── Sales Summary → /orders
 ├── Low Stock → /inventory
 ├── Top Products → /catalog/[id]
 ├── New Customers → /customers/[id]
 └── Cash Drawer Alerts → Register Detail

Products
 ├── Product Detail → Inventory tab
 ├── Product Detail → Vendors tab
 ├── Product Detail → Sales History tab
 └── Product Detail → Pricing tab

Orders
 ├── Order Detail → /customers/[id]
 ├── Order Detail → Payment Detail
 ├── Order Detail → Return Flow
 └── Order Detail → Receipt

Inventory
 ├── Inventory Item → Product Variant
 ├── Movement → Reference Order/PO/Transfer
 ├── Low Stock → Purchase Order creation
 └── Transfer → Outlet Detail

Purchasing
 ├── Purchase Order → /vendors/[id]
 ├── Purchase Order → Receive Inventory
 └── Received Items → Inventory Movements

Team
 ├── User → Role
 ├── Role → Permissions matrix
 ├── User → Sessions
 └── User → Audit Log
```

---

## 6. RBAC UI Rules

### Permission → UI behaviour mapping

| Permission level | UI behaviour |
|---|---|
| No permission | Hide page from nav entirely |
| `[module].view` only | Show page read-only; hide all create/edit/delete/approve buttons |
| `[module].create` | Show create button |
| `[module].update` | Show edit buttons |
| `[module].delete` | Show delete/archive buttons |
| `[module].approve` | Show approval actions |
| `[module].refund` | Show refund controls |
| `[module].export` | Show export button |

### Permission codes (full list)

```
products.view / products.create / products.update / products.delete
inventory.view / inventory.adjust / inventory.transfer
orders.view / orders.create / orders.update / orders.delete / orders.refund / orders.void / orders.approve
payments.view / payments.create / payments.approve
reports.view / reports.export
team.view / team.create / team.update
settings.view / settings.update
```

---

## 7. RBAC Components (to build/wire)

### Component API

```tsx
<Can permission="products.create">
  <Button>Create Product</Button>
</Can>

<CanAny permissions={["orders.refund", "orders.void"]}>
  <OrderActions />
</CanAny>

<CanRole role="admin">
  <AdminSettings />
</CanRole>

<PermissionGuard permission="inventory.adjust">
  <AdjustmentForm />
</PermissionGuard>

<ReadOnlyWrapper readonly={!hasPermission("products.update")}>
  <ProductForm />
</ReadOnlyWrapper>
```

### Guards to build
- `PermissionGuard` — single permission check, renders null if denied
- `RoleGuard` — role-level check (owner/admin/manager/cashier/etc.)
- `OutletAccessGuard` — restricts to user's allowed outlets
- `ReadOnlyWrapper` — renders children with all inputs disabled when `readonly` is true
- `ActionVisibilityGuard` — shows/hides action buttons based on permission
- `CanAny` — renders if user has at least one of the listed permissions
- `CanAll` — renders only if user has all listed permissions

---

## 8. User Control Features (Team Management)

### Team Management Page tabs

```
Team
 ├── Users
 ├── Roles
 ├── Permissions
 ├── Invitations
 ├── Outlet Access
 ├── Sessions
 └── Activity Logs
```

### Per-user actions (all permission-gated)

| Action | Permission required |
|---|---|
| Create user | `team.create` |
| Edit user | `team.update` |
| Deactivate user | `team.update` |
| Assign role | `team.update` |
| Assign permissions | `team.update` |
| Assign outlet access | `team.update` |
| Force password reset | `team.update` (owner/admin only) |
| Enable/disable MFA | `team.update` (owner/admin only) |
| Revoke sessions | `team.update` |
| View activity | `team.view` |
| View audit log | `team.view` |
| Set cashier PIN | `team.update` |
| Set commission rules | `team.update` |
| Restrict refund/discount/register access | `team.update` |

---

## 9. Default Roles

```
Owner
Admin
Store Manager
Cashier
Inventory Manager
Purchasing Manager
Accountant
Support Agent
Read Only
Custom Role
```

---

## 10. Permission Matrix UI

Display as a grid with toggle checkboxes. Each row = module, each column = action.

```
Module       View   Create   Update   Delete   Approve   Export
Products      ✓       ✓        ✓        ✓         -         ✓
Inventory     ✓       -        ✓        -         ✓         ✓
Orders        ✓       ✓        ✓        ✓         ✓         ✓
Payments      ✓       ✓        -        -         ✓         ✓
Reports       ✓       -        -        -         -         ✓
Team          ✓       ✓        ✓        ✓         -         -
Settings      ✓       -        ✓        -         -         -
```

### Matrix UX features
- "Select all" per module row
- Preset buttons: Read-only / Manager / Cashier / Admin
- Dangerous permission warning (delete, approve, refund)
- Unsaved changes indicator + Save/Cancel

---

## 11. Outlet Access Control

Users can be scoped to specific outlets/registers:

```
User Access
 ├── All outlets
 ├── Selected outlets
 ├── Register-specific access
 ├── Warehouse-only access
 └── Region/franchise access
```

Example:
```
Cashier can access:
Outlet: Dallas Store
Register: Register 1
Permissions: orders.create, payments.create
```

---

## 12. Settings Page Structure

```
Settings
 ├── Business Profile
 ├── Outlets
 ├── Registers
 ├── Taxes
 ├── Payments
 ├── Receipts
 ├── Users & Roles
 ├── Inventory Settings
 ├── Order Settings
 ├── Offline Sync
 ├── Integrations
 ├── Security
 ├── Billing
 └── Audit Logs
```

---

## 13. Dashboard UI — Role-based Widgets

### Owner Dashboard
- Gross sales / Net sales / Profit
- Top stores, top products
- Low stock alerts
- Cash drawer differences
- Refund alerts
- Sales trend chart
- Tax summary

### Cashier Dashboard
- Open register / Start sale
- Recent orders / Held carts
- Assigned register
- Today's sales total

### Inventory Manager Dashboard
- Low stock list
- Stock transfers pending
- Purchase orders pending receive
- Inventory adjustments
- Receiving queue
- Stock valuation

### Admin Dashboard
- Users / Roles counts
- Security alerts
- Failed login events
- Audit events
- Integration status

---

## 14. Data Table Properties

Every enterprise table must include:

| Feature | Notes |
|---|---|
| Search | Debounced, server-side when >500 rows |
| Column filters | Dropdown or date range per column |
| Saved views | Named filter presets, persisted |
| Bulk actions | Select all / deselect, action on checked rows |
| Column visibility | Toggle per column |
| Export CSV | Permission-gated |
| Pagination | limit/offset; show total count |
| Sorting | Click header to sort asc/desc |
| Status badges | Colour-coded per status |
| Row actions | View / Edit / Duplicate / Archive / Delete / Audit Log |
| Permission-based row actions | Hide actions user can't perform |
| Empty state | Icon + message + CTA |
| Loading skeleton | Animate-pulse rows, matching column count |
| Error state | Error message with retry button |

---

## 15. Form UI Properties

Every form must include:

| Feature | Notes |
|---|---|
| Sectioned layout | Group related fields with dividers/headers |
| Required field indicators | `*` on label |
| Inline validation | Show error below field on blur |
| Save button | Primary, always visible |
| Cancel button | Navigates back or closes modal |
| Unsaved changes warning | Prompt before navigate-away |
| Permission-aware fields | Disable if user lacks update permission |
| Audit note | Optional "reason" field on sensitive changes |

### Sensitive fields requiring confirmation dialog before save
- Price change
- Tax change
- Inventory adjustment
- Refund
- Permission update
- Role update
- Payment setting change

---

## 16. Audit Log UI

### Columns

| Column | Description |
|---|---|
| Who | Actor name + role |
| What | Action performed |
| Old value | Previous value (diff) |
| New value | New value |
| When | Timestamp (formatted with fmtDateTime) |
| IP address | Request origin |
| Device | Device ID / name |
| Entity | Affected record (with link) |
| Reason/note | Optional note field |

### Filters
- User
- Module
- Action type
- Date range
- Outlet
- Entity type
- Risk level

---

## 17. Enterprise UX Confirmation Rules

### Always show confirmation modal for:
- Refund order
- Void order
- Delete product
- Archive customer
- Close register
- Approve purchase order
- Receive inventory
- Change permissions
- Disable user
- Revoke sessions

### Always show warning banner/badge for:
- Low stock
- Negative inventory
- Unpaid order
- Failed payment
- Cash drawer mismatch
- Offline mode
- Sync conflict
- Permission denied

---

## 18. Offline POS UI

### Status elements always visible in terminal
- Online/Offline badge (green/amber/red)
- Last synced timestamp
- Pending sync count
- Sync error alert
- Device ID
- Register status

### Offline screens needed
- Conflict resolution screen
- Local receipt storage viewer
- Offline order queue manager

### Offline restrictions
- Allow cash sales
- Allow local card queue only if provider supports it
- Block gift card balance check (requires server)
- Warn before large refunds
- Block user permission changes

---

## Implementation checklist

When building any new page against this spec, verify:

- [ ] Page has correct header (title, description, breadcrumb, gated action buttons)
- [ ] Detail pages use tabs pattern from section 4
- [ ] All tables include: search, filters, pagination, bulk actions, export, empty/loading/error states
- [ ] All forms: sections, required indicators, inline validation, unsaved-changes guard
- [ ] All action buttons wrapped in `<Can permission="...">` or hidden conditionally
- [ ] Sidebar nav item hidden if `[module].view` not granted
- [ ] Destructive actions show confirmation dialog
- [ ] Sensitive changes show audit note field
- [ ] Offline-aware state displayed in terminal/POS pages
- [ ] All connected links wired (Dashboard → detail pages, etc.)
