# Work Package 07: Inventory, Warehouse, Lots, And Movements

## Goal

Inventory is shared infrastructure for retail, wholesale, ecommerce, and
warehouse — tracked by tenant, business unit, location, lot/batch, unit, and
movement reason. It must not belong to products alone, and stock must not mix
incorrectly across business units/locations.

## Database changes

Balance dimensions:

```txt
tenant_id  business_unit_id?  location_id  product_id  lot_id?
unit_code  on_hand_qty  reserved_qty  available_qty
```

Tables:

```txt
inventory_balances   inventory_movements   inventory_reservations
inventory_lots       stock_adjustments     stock_transfers
cycle_counts         warehouse_bins
```

Movement types:

```txt
retail_sale  retail_return  wholesale_order_reserve  wholesale_ship
purchase_receive  stock_adjustment  transfer_out  transfer_in
cycle_count_adjustment  ecommerce_reserve
```

## Current repo files affected

- `src/modules/inventory`, `src/modules/product_batches` (lots), `src/modules/serial_numbers`.
- `src/orchestration/workflows/inventory-transfer.workflow.ts`.

## Backend endpoints

```txt
GET  /api/v1/inventory/balances
GET  /api/v1/inventory/availability
POST /api/v1/inventory/reservations
POST /api/v1/inventory/movements
POST /api/v1/inventory/transfers
POST /api/v1/inventory/cycle-counts
POST /api/v1/inventory/lots
```

## Retail behavior

- Store-level availability; immediate decrement on completed sale; returns
  restock by condition; low-stock alerts.

## Wholesale behavior

- Warehouse availability; reserve on approved sales order (reduces `available`
  not `on_hand`); pick/pack/ship decrements `on_hand`; supports bins, lots,
  expiry, and FEFO.

## Frontend screens

- Inventory dashboard; store stock view; warehouse stock view.
- Transfer screen; cycle-count workflow.
- Lot/batch management; adjustment approval.

## Tests required

- A retail sale does not decrement wholesale warehouse stock unless configured.
- A wholesale reservation reduces available qty but not on-hand.
- Shipping decrements on-hand.
- Every movement is auditable.
- Reports can filter by business unit, channel, and location.

## Acceptance criteria

- Reservation reduces `available` not `on_hand`; shipment reduces `on_hand`.
- Retail/warehouse stock stays separate unless explicitly configured to share.
- All movements are auditable and typed by reason.
- Inventory reports filter by tenant, business unit, channel, location, product, lot.

## Implementation checklist

- [ ] Balance dimensions incl. `business_unit_id`/`location_id`/`lot_id`/`unit_code`.
- [ ] Typed movement ledger (all movement types) — append-only, auditable.
- [ ] Reservations (available vs on_hand) + ship decrement.
- [ ] Transfers, cycle counts, lots/FEFO, warehouse bins.
- [ ] Retail-sale / wholesale-reserve / ship hooks (WP 05/06).
- [ ] Frontend: dashboard, store/warehouse views, transfer, cycle count, lot mgmt, adjustment approval.
