# Inventory receiving

## Overview

Inventory receiving records stock arriving from suppliers. It creates a positive `inventory_movement` record and adjusts the on-hand quantity.

## Receiving a purchase order

1. Go to **Purchasing → Purchase Orders**
2. Open the PO or create a new one (supplier, expected date, line items)
3. When goods arrive, click **Receive**
4. For each line, enter the quantity actually received (may differ from ordered)
5. Click **Complete receiving** — on-hand quantities update immediately

## Manual adjustment

For spot corrections (count discrepancy, damaged goods removal):

1. **Inventory → Adjustments → New adjustment**
2. Select the product(s)
3. Enter the adjustment quantity (positive = add, negative = remove)
4. Select reason: `receiving`, `adjustment`, `damage`, `theft`, `write-off`
5. Save — the movement is logged in the audit trail

## Stocktake / cycle count

1. **Inventory → Stocktake → Start count**
2. Select a category or location subset (full store or section)
3. Count each item and enter quantities (or scan barcodes)
4. **Finalize count** — Ascend calculates the variance and posts adjustments

Stocktake locks inventory edits for the scoped products until finalized.

## Low-stock alerts

Set a **Reorder point** on each product (Catalog → product → Inventory tab).

When on-hand drops to or below the reorder point:
- A notification appears in the notification bell
- The product is flagged in **Inventory → Low stock** report
- If webhooks are configured, an `inventory.low_stock` event fires

## Location tracking

Products can have a shelf location: **Aisle / Shelf / Bin** (e.g. A-3-12). Set in Catalog → product → Inventory tab. Location is shown on purchase orders and stocktake sheets.

## Expiry & batch tracking

For perishable or batch-tracked products (pharmacy, food):

- Enable **Expiry tracking** on the product
- When receiving, enter the batch number and expiry date
- Ascend warns at checkout if an item in the batch has expired
- **Inventory → Expiring soon** shows items expiring within 30 days

## Movement history

Every inventory change is logged. Go to **Inventory → Movements** to see:
- Date, product, quantity change, reason, and the user who made it
- Filter by product, date range, or reason type
- Export as CSV
