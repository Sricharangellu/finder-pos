# Work Package 09: Purchasing, Vendors, Receiving, And Landed Cost

## Goal

Buy inventory from suppliers/vendors. Shared, but mainly supports wholesale and
warehouse operations. Retail stores may raise purchase requests; purchasing
users approve and receive.

## Database changes

```txt
vendors            vendor_contacts       vendor_products
purchase_orders    purchase_order_lines  receipts
receipt_lines      vendor_bills          landed_costs
purchase_recommendations
```

## Current repo files affected

- `src/modules/purchasing`, `src/modules/inventory` (receive → stock), `src/modules/accounting` (bills).
- `src/modules/insights` (reorder recommendations).
- `web/app/(protected)/admin/purchasing`.

## Backend endpoints

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

## Flow

1. Reorder recommendation generated from inventory levels (WP 07 + insights).
2. Buyer creates a PO.
3. Manager approves the PO (WP 02).
4. Warehouse receives partially or fully.
5. Inventory lots are created (WP 07 `purchase_receive`).
6. Vendor bill is matched.
7. Landed cost is allocated.
8. Product cost updates if configured (feeds WP 04 margin).

## Frontend screens

- Vendor list; PO builder.
- Receiving screen with partial receiving.
- Bill-variance view; landed-cost allocation.
- Reorder suggestions.

## Tests required

- Receiving increases inventory.
- Partial receiving is supported.
- Vendor-bill variance is visible.
- A retail cashier cannot approve purchase orders unless permitted (WP 02).

## Acceptance criteria

- Receiving increases inventory and creates lots.
- Partial receive is supported; bill variance is visible.
- Purchasing updates inventory and accounting via clear events (WP 13).
- PO approval is permission-gated.

## Implementation checklist

- [ ] Vendor + PO + receipt + bill + landed-cost tables.
- [ ] PO create/approve/receive (partial) → inventory receive + lots.
- [ ] Vendor-bill matching + variance; landed-cost allocation → product cost.
- [ ] Reorder recommendations from inventory levels.
- [ ] Permission gate on PO approval; frontend PO/receiving/variance/recommendations UI.
