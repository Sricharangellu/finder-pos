# Scope Expansion — expiry, bills/invoices, multi-UPC

Driven by the `product-export` sample (71 cols) + the request to track product
expiry (with purchase), bill/invoice records, and multiple UPCs per product.
Each area is a tenant-scoped bounded context (or extension) that integrates via
the event bus, consistent with the existing modular monolith.

## 1. Multiple UPCs per product  ← building first (data-backed)
The export carries several barcodes per product: `upc, upc1, upc2, singleUpc,
boxUpc, caseUpc, Vendor UPC`. Today a product has one `barcode`.
- **Schema:** new `product_barcodes (tenant_id, product_id, barcode, kind, pack_size)` — `kind` ∈ each/single/box/case/vendor/alt; UNIQUE (tenant_id, barcode).
- **Catalog:** `getByBarcode` searches `product_barcodes` (then falls back to `products.barcode`); import populates every non-empty UPC column with its `kind` + pack size (`boxQuantity`, `caseQuantity`). Box/case scans can later resolve to N eaches.
- **Endpoints:** `GET /api/v1/catalog/:id/barcodes`, `POST /:id/barcodes`, and the existing `GET /catalog/barcode/:code` now matches any UPC.

## 2. Expiry / batch (lot) tracking  ← next
FEFO retail (groceries, pharmacy). Stock isn't just a quantity — it's lots with
expiry dates, received via purchasing.
- **Schema:** `inventory_lots (id, tenant_id, product_id, lot_code, expiry_date, qty_on_hand, received_at, po_id, unit_cost_cents)`.
- **Purchasing:** PO receive captures `expiryDate` + `lotCode` per line → creates a lot. `purchase_order.received` payload gains `expiryDate`.
- **Inventory:** on-hand = SUM(lot qty). Sales decrement **FEFO** (earliest expiry first) across lots. New reads: `GET /api/v1/inventory/:productId/lots`, `GET /api/v1/inventory/expiring?days=30` (near-expiry report).
- **Events:** `inventory.lot_expiring` (scheduled sweep) for alerts/markdowns.
- Gated by a per-product `track_expiry` flag (export has a `Track Inventory` column) so non-perishables are unaffected.

## 3. Bills & invoices  ← after expiry
- **Supplier bills (AP):** a bill records what's owed to a vendor for received goods.
  `bills (id, tenant_id, supplier_id, po_id, status[open|partial|paid], subtotal_cents, tax_cents, total_cents, due_date, issued_at)` + `bill_payments`. Created from a received PO; `purchase_order.received` → draft bill.
- **Customer invoices (AR):** for B2B/net-terms sales. `invoices (id, tenant_id, customer_id, order_id, status, total_cents, due_date, issued_at)` — an order can be invoiced instead of paid at till; `payment.captured` settles it. Ties into the existing customers + orders modules.
- **Endpoints:** `/api/v1/bills` (+ `/:id/pay`), `/api/v1/invoices` (+ `/:id/pay`); reports gain AP/AR aging.
- **Numbering:** per-tenant sequential bill/invoice numbers.

## Phasing
1. Multi-UPC (scan any UPC) — **DONE + live** (6,473 products imported).
2. Expiry/batch lots + near-expiry report — **DONE + live** (`inventory_lots`, captured on receive, `/inventory/expiring`). FEFO sale-depletion still TODO.
3. Vendor list + AP credits (chargebacks + credit memos) — **DONE + live** (`/purchasing/vendors`, `/purchasing/vendor-credits`).
4. Supplier bills (AP) from POs + customer invoices (AR) from orders — **DONE + live** (`/api/v1/billing/bills|invoices` + `/:id/pay`; received PO auto-drafts a bill).

5. Expiry lifecycle — **DONE + live**: FEFO sale-depletion, `/inventory/expired`, `/inventory/expiry-summary` (value-at-risk), manual receive with expiry, and vendor returns/write-offs with auto credit memo.

Remaining: AP/AR + credit **aging reports**; lot restoration on refund (refunds restock aggregate but not specific lots); multi-outlet stock (per-outlet inventory).

Each ships as: migration (self-provisioning, idempotent) + tenant-scoped routes +
events + MSW mocks + `BACKEND_HANDOFF.md` entry, committed to `backend-cycle3`.
