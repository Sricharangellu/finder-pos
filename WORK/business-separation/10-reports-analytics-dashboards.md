# Work Package 10: Reports, Analytics, Dashboards, And Data Views

## Goal

Separate retail, wholesale, ecommerce, and owner reporting while allowing combined executive views.

## Required Filters

Every report must filter by:

```txt
tenant_id
business_unit_id
channel
location_id
date range
user role and permissions
```

## Report Families

Retail:

```txt
POS sales summary
register closeout
cashier performance
payment method summary
returns
discounts
low stock
age verification logs
```

Wholesale:

```txt
sales order summary
quotes conversion
AR aging
customer sales
sales rep performance
warehouse fulfillment
margin report
invoice status
```

Shared:

```txt
inventory valuation
tax report
product performance
vendor performance
purchase report
accounting summary
audit logs
```

## Existing Files To Touch

- `src/modules/reports`
- `src/modules/insights`
- `web/app/(protected)/retail/reports`
- `web/app/(protected)/wholesale/reports`
- `web/app/(protected)/admin/reports`

## Backend Endpoints

```txt
GET  /api/v1/reports/retail/summary
GET  /api/v1/reports/retail/register-closeout
GET  /api/v1/reports/wholesale/summary
GET  /api/v1/reports/wholesale/ar-aging
GET  /api/v1/reports/inventory/valuation
POST /api/v1/reports/scheduled
GET  /api/v1/dashboard
```

## Tests

- Retail manager cannot view wholesale AR unless granted.
- Wholesale manager cannot view register closeout unless granted.
- Owner can view combined company dashboard.

## Acceptance Criteria

- Report data never crosses unauthorized business-unit boundaries.

