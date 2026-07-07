# Work Package 10: Reports, Analytics, Dashboards, And Data Views

## Goal

Separate retail, wholesale, ecommerce, and shared reporting while allowing a
combined executive view. Reports are permission- and business-unit-aware.

## Required filters

Every report filters by:

```txt
tenant_id  business_unit_id  channel  location_id  date range  user role/permissions
```

## Report families

Retail: POS sales summary · register closeout · cashier performance · payment
method summary · returns · discounts · low stock · age-verification logs.

Wholesale: sales-order summary · quotes conversion · AR aging · customer sales ·
sales-rep performance · warehouse fulfillment · margin report · invoice status.

Shared: inventory valuation · tax report · product performance · vendor
performance · purchase report · accounting summary · audit logs.

## Database changes

```txt
daily_sales_summary      daily_inventory_summary   report_jobs
scheduled_reports        dashboard_widgets
```

Use aggregated summary tables for performance-sensitive reports.

## Current repo files affected

- `src/modules/reports`, `src/modules/insights`, `src/modules/monitoring`.
- `web/app/(protected)/retail/reports`, `.../wholesale/reports`, `.../admin/reports`.

## Backend endpoints

```txt
GET  /api/v1/reports/retail/summary
GET  /api/v1/reports/retail/register-closeout
GET  /api/v1/reports/wholesale/summary
GET  /api/v1/reports/wholesale/ar-aging
GET  /api/v1/reports/inventory/valuation
POST /api/v1/reports/scheduled
GET  /api/v1/dashboard
```

## Frontend screens

- Retail dashboard; wholesale dashboard; owner combined dashboard.
- Filters by business unit / channel / location / date.
- Export CSV/PDF; scheduled email reports.
- Permission-based widgets.

## Tests required

- A retail manager cannot view wholesale AR unless granted.
- A wholesale manager cannot view register closeout unless granted.
- An owner can view the combined company dashboard.
- Reports use aggregated tables where needed for performance.

## Acceptance criteria

- Report data never crosses unauthorized business-unit boundaries.
- Owner sees combined; retail/wholesale managers see only their granted scope.
- Aggregated tables back heavy reports.

## Implementation checklist

- [ ] Summary tables (`daily_sales_summary`, `daily_inventory_summary`) + jobs.
- [ ] Retail/wholesale/shared report endpoints with the required filters.
- [ ] Permission checks per report family (WP 02).
- [ ] Scheduled reports + export CSV/PDF.
- [ ] Retail/wholesale/owner dashboards with permission-based widgets.
