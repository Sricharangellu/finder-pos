# Ascend — Enterprise Inventory Pipeline, Supplier Reorder, EDI & Error Safeguards

> Authoritative spec for the Inventory Pipeline domain. Consult before any work on
> reorder suggestions, purchase orders, supplier price history, EDI imports, or error handling.

---

## 1. Inventory Pipeline Architecture

```
Inventory Pipeline
 ├── Reorder Suggestions
 ├── Purchase Order
 ├── Supplier Confirmation
 ├── EDI Import
 ├── Receiving
 ├── Billing / Supplier Invoice
 ├── Cost Update
 ├── Inventory Update
 ├── Error Check
 └── Audit Log
```

---

## 2. Pipeline Status Flow

### Normal path
```
Suggested → Draft PO → Sent to Supplier → Confirmed → Partially Received → Fully Received → Supplier Billed → Cost Verified → Closed
```

### Exception statuses
```
Supplier Price Mismatch    Quantity Mismatch     Duplicate Item
Unknown SKU                Below Minimum Order   Backordered
Rejected                   Import Failed         Needs Review
```

---

## 3. Inventory Pipeline Page — `/inventory/pipeline`

### Tabs
```
Overview | Reorder Needed | By Supplier | Purchase Orders | Receiving | Billed | Price Changes | EDI Imports | Errors | Audit Log
```

---

## 4. Supplier-Based Reorder View

```
Reorder by Supplier
 ├── Supplier selector
 ├── Low-stock products
 ├── Below minimum order products
 ├── Suggested reorder quantity
 ├── Last bought price
 ├── Last bought date
 ├── Best recent supplier price
 ├── Alternative supplier suggestions
 └── Create PO button
```

### Filters
```
Supplier / Category / Brand / Outlet / Warehouse
Low stock / Out of stock / Below reorder point / Below minimum order quantity
Last bought date / Last purchased supplier / Best price supplier
Lead time / Minimum order quantity / Margin impact / Expiry risk
Fast moving products / Slow moving products
```

---

## 5. Auto-Update Supplier for Products (on PO receive)

```
Purchase Order Received
 ↓
Check vendor_products table
 ↓
If supplier already exists → update: last_purchase_price, last_purchase_date, lead_time, pack_size, vendor_sku
 ↓
If supplier does not exist → create supplier-product mapping
 ↓
Write audit log
```

### Safety rules
| Rule | Enforcement |
|---|---|
| Do not overwrite preferred supplier automatically | Soft-lock on preferred flag |
| Do not change default supplier without approval | Requires `purchasing.approve` permission |
| Store price history every time | Always insert into `supplier_product_price_history` |
| Flag large cost changes | Alert threshold configurable per tenant |
| Require approval if cost change exceeds threshold | Hold movement until approved |

---

## 6. Reorder Suggestion Logic

### Trigger conditions
```
Quantity below reorder point        Quantity below minimum stock
Sales velocity                      Supplier lead time
Open purchase orders                Reserved stock
Seasonality                         Expiry risk
Last purchase date                  Margin impact
Supplier availability
```

### Suggested quantity formula
```
Suggested Qty = (Average Daily Sales × Supplier Lead Time) + Safety Stock - Available Stock - Incoming Stock
```

---

## 7. Supplier Price Comparison

When reordering, system compares all known supplier prices for the variant:

```
Current supplier: ABC Foods       — price: $12.50  — last bought: June 15, 2026
Alternative:      Global Foods    — price: $11.80  — last bought: June 20, 2026
→ Suggestion: Global Foods saves $0.70/unit
```

### Price window filters
```
Last 7d / 30d / 90d / 180d / Custom date range
Best recent price / Lowest landed cost / Fastest supplier
Preferred supplier only / Approved suppliers only
```

---

## 8. EDI Import Page — `/purchasing/edi-imports`

### Supported import formats
```
EDI 850 Purchase Order              EDI 855 Supplier Acknowledgment
EDI 856 Advance Ship Notice         EDI 810 Supplier Invoice
CSV / Excel / XML / JSON            Supplier Portal Upload
```

### Import flow
```
Upload file → Parse supplier → Map SKUs → Validate quantities → Validate price
→ Detect duplicate lines → Show preview → User confirms
→ Create/update PO → Create receiving document
→ Create supplier invoice if billed → Write audit log
```

---

## 9. Fallback Safeguards (never blindly update inventory)

| Condition | Action |
|---|---|
| Unknown SKU | Send to review queue |
| Unknown supplier | Hold import |
| Price mismatch | Warning |
| Quantity mismatch | Warning |
| Duplicate PO number | Block |
| Duplicate invoice number | Block |
| Expired product received | Quarantine |
| Negative stock risk | Review |
| Missing cost | Hold |
| Invalid barcode | Warning |
| Unmapped vendor SKU | Review |
| Supplier not approved | Block or approval required |
| Large cost increase (>threshold) | Approval required |

---

## 10. Error Check Center — `/inventory/errors`

### Error categories
```
SKU Mapping Errors          Supplier Mapping Errors     Price Mismatches
Quantity Mismatches         Duplicate Documents         Missing Barcodes
Missing Costs               Below Minimum Order         Expired / Near Expiry Stock
Unapproved Supplier         EDI Parsing Errors          PO / Invoice Mismatch
Receiving Mismatch
```

### Actions per error
```
Fix mapping / Approve exception / Reject import / Retry import
Create product / Create supplier mapping / Update vendor SKU
Ignore with reason / Escalate to admin
```

---

## 11. Database Schema (5 new tables)

### `supplier_product_price_history`
```sql
CREATE TABLE supplier_product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    supplier_id UUID NOT NULL,
    product_id UUID,
    variant_id UUID NOT NULL,
    vendor_sku VARCHAR(100),
    purchase_order_id UUID,
    unit_cost NUMERIC(12,2) NOT NULL,
    landed_cost NUMERIC(12,2),
    quantity NUMERIC(14,3),
    currency CHAR(3) DEFAULT 'USD',
    bought_at TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP DEFAULT now()
);
```

### `reorder_suggestions`
```sql
CREATE TABLE reorder_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID,
    warehouse_id UUID,
    supplier_id UUID,
    variant_id UUID NOT NULL,
    current_stock NUMERIC(14,3),
    reserved_stock NUMERIC(14,3),
    incoming_stock NUMERIC(14,3),
    reorder_point NUMERIC(14,3),
    minimum_order_quantity NUMERIC(14,3),
    suggested_quantity NUMERIC(14,3),
    suggested_supplier_id UUID,
    last_purchase_price NUMERIC(12,2),
    best_recent_price NUMERIC(12,2),
    best_recent_supplier_id UUID,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'suggested',
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

### `edi_imports`
```sql
CREATE TABLE edi_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    supplier_id UUID,
    import_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255),
    file_url TEXT,
    status VARCHAR(50) DEFAULT 'uploaded',
    total_lines INT DEFAULT 0,
    success_lines INT DEFAULT 0,
    error_lines INT DEFAULT 0,
    uploaded_by UUID,
    uploaded_at TIMESTAMP DEFAULT now(),
    processed_at TIMESTAMP
);
```

### `edi_import_errors`
```sql
CREATE TABLE edi_import_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    edi_import_id UUID NOT NULL,
    line_number INT,
    error_type VARCHAR(100),
    error_message TEXT,
    raw_data JSONB,
    status VARCHAR(50) DEFAULT 'open',
    resolved_by UUID,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
```

### `purchase_invoice_matches`
```sql
CREATE TABLE purchase_invoice_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    purchase_order_id UUID,
    supplier_invoice_number VARCHAR(100),
    supplier_id UUID NOT NULL,
    match_status VARCHAR(50) DEFAULT 'pending',
    po_total NUMERIC(12,2),
    invoice_total NUMERIC(12,2),
    variance_amount NUMERIC(12,2),
    variance_reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
```

---

## 12. API Routes

```
GET  /api/v1/inventory/pipeline
GET  /api/v1/inventory/reorder-suggestions
GET  /api/v1/inventory/reorder-suggestions/by-supplier
POST /api/v1/inventory/reorder-suggestions/create-po

GET  /api/v1/suppliers/:id/reorder-products
GET  /api/v1/suppliers/:id/price-history
GET  /api/v1/products/:id/supplier-price-comparison

POST /api/v1/purchasing/edi-imports
GET  /api/v1/purchasing/edi-imports
GET  /api/v1/purchasing/edi-imports/:id
POST /api/v1/purchasing/edi-imports/:id/process
POST /api/v1/purchasing/edi-imports/:id/retry

GET  /api/v1/inventory/errors
POST /api/v1/inventory/errors/:id/resolve
POST /api/v1/inventory/errors/:id/ignore
POST /api/v1/inventory/errors/:id/escalate
```

---

## 13. Page-to-Page Connections

```
Inventory Dashboard → Reorder Needed → Reorder by Supplier → Create PO → Supplier Confirmation
→ Receive Inventory → Supplier Bill → Match PO/Invoice → Update Cost → Update Inventory → Audit Log

Supplier Detail → Products Supplied → Price History → Reorder Suggestions → POs → EDI Imports → Invoice Matches

Product Detail → Suppliers → Purchase History → Best Supplier Price → Reorder Suggestions → Inventory Movements
```

---

## 14. Enterprise UI Features to Build

```
Supplier comparison panel          Reorder recommendation badge     Best price alert
Minimum order warning              Lead time indicator              EDI import preview
Error resolution drawer            PO vs invoice match screen
Bulk create PO by supplier         Bulk approve reorder suggestions
Bulk update supplier mapping       Bulk update vendor SKU           Bulk retry failed imports
```

---

## 15. New Pages Required

| Page | Path | Status |
|---|---|---|
| Inventory Pipeline | `/inventory/pipeline` | Not built |
| EDI Imports | `/purchasing/edi-imports` | Not built |
| Error Check Center | `/inventory/errors` | Not built |
