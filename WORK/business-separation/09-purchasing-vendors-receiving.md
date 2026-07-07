# Work Package 09: Purchasing, Vendors, Receiving, And Landed Cost

## Goal

Support vendor purchasing, partial receiving, vendor bills, and landed costs across warehouse and retail replenishment workflows.

## Data Scheme

Tables:

```txt
vendors
vendor_contacts
vendor_products
purchase_orders
purchase_order_lines
receipts
receipt_lines
vendor_bills
landed_costs
purchase_recommendations
```

## Existing Files To Touch

- `src/modules/purchasing`
- `src/modules/inventory`
- `src/modules/accounting`
- `src/modules/insights`
- `web/app/(protected)/admin/purchasing`

## Backend Endpoints

```txt
GET  /api/v1/vendors
POST /api/v1/vendors
POST /api/v1/purchasing/purchase-orders
GET  /api/v1/purchasing/purchase-orders
POST /api/v1/purchasing/purchase-orders/:id/approve
POST /api/v1/purchasing/purchase-orders/:id/receive
POST /api/v1/purchasing/landed-costs
GET  /api/v1/purchasing/recommendations
```

## Tests

- Receiving increases inventory.
- Partial receiving is supported.
- Vendor bill variance is visible.
- Retail cashier cannot approve POs unless permitted.

## Acceptance Criteria

- Purchasing updates inventory and accounting through clear events.

