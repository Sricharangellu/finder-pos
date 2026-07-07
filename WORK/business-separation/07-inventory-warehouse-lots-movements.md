# Work Package 07: Inventory, Warehouse, Lots, And Movements

## Goal

Make inventory a shared service used by retail, wholesale, ecommerce, and warehouse workflows without mixing stock incorrectly.

## Data Scheme

Inventory dimensions:

```txt
tenant_id
business_unit_id optional
location_id
product_id
lot_id optional
unit_code
on_hand_qty
reserved_qty
available_qty
```

Tables:

```txt
inventory_balances
inventory_movements
inventory_reservations
inventory_lots
stock_adjustments
stock_transfers
cycle_counts
warehouse_bins
```

Movement types:

```txt
retail_sale
retail_return
wholesale_order_reserve
wholesale_ship
purchase_receive
stock_adjustment
transfer_out
transfer_in
cycle_count_adjustment
ecommerce_reserve
```

## Existing Files To Touch

- `src/modules/inventory`
- `src/modules/warehouse`
- `src/modules/product_batches`
- `src/orchestration/workflows/inventory-transfer.workflow.ts`

## Backend Endpoints

```txt
GET  /api/v1/inventory/balances
GET  /api/v1/inventory/availability
POST /api/v1/inventory/reservations
POST /api/v1/inventory/movements
POST /api/v1/inventory/transfers
POST /api/v1/inventory/cycle-counts
POST /api/v1/inventory/lots
```

## Tests

- Retail sale decrements configured store stock only.
- Wholesale reservation reduces available stock but not on-hand.
- Shipping decrements warehouse on-hand.
- Every movement is auditable.

## Acceptance Criteria

- Inventory reports can filter by tenant, business unit, channel, location, product, and lot.

