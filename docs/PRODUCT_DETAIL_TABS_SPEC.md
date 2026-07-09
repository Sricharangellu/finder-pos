# Ascend — Product Detail Suggested Tabs

> Authoritative tab layout for `/products/[id]` (catalog/[id]). Consult before adding or
> reordering tabs on the product detail page.

---

## Canonical Tab Order

```
/products/[id]

Overview (General)
Variants
Inventory
Pricing
Ecommerce
Purchase by Supplier
Sales by Customer
Reorder Suggestions
Supplier Price Comparison
Expiry / Batch / Lot
Labels & Printing
Audit Log
```

**Rule**: Place Sales by Customer directly next to Purchase by Supplier — they are the demand/supply pair.

---

## Tab: Purchase by Supplier

### Filters
Date range | Supplier | Purchase order | Outlet / warehouse | Vendor SKU | Cost price | Quantity received | Invoice status | Receiving status

### Columns
Supplier | PO number | Purchase date | Received date | Qty ordered | Qty received | Unit cost | Landed cost | Invoice number | Price variance | Last bought date

---

## Tab: Sales by Customer

Place directly after Purchase by Supplier.

### Filters
```
Date range (preset + custom)    Customer / Customer group
Outlet / Sales channel          Register / Cashier
Order status / Return status    Quantity sold / Revenue / Margin
Wholesale / Retail
```

### Preset date filters
Today | Yesterday | Last 7 days | Last 30 days | This month | Last month | This quarter | This year | Custom range

### Columns
Customer name | Customer type | Order number | Order date | Outlet | Qty bought | Unit price | Discount | Tax | Total revenue | Gross margin | Returned qty | Last purchase date

### Row actions
View customer → `/customers/[id]`
View order → `/orders/[id]`
View receipt → receipt modal
Create customer segment
Export CSV
Reorder for demand → `/inventory/pipeline`

---

## Tab: Reorder Suggestions

Shows product-level reorder intelligence.

Formula: `Suggested Qty = (Avg Daily Sales × Lead Time) + Safety Stock − Available − Incoming`

Displays: current stock, reorder point, suggested qty, preferred supplier, best price supplier, estimated days until stockout.

CTA: Create PO → `/purchasing/new?product=[id]&supplier=[id]`

---

## Tab: Supplier Price Comparison

Side-by-side comparison of all linked suppliers for this product.

Columns: Supplier | Last bought date | Unit cost | Landed cost | MOQ | Lead time | Price trend (30d) | Savings vs current

Best price highlighted in green. Preferred supplier marked with star.

CTA: Switch preferred supplier | Create PO with this supplier

---

## Tab: Labels & Printing

Add this product's variants to the label print queue. Select template, qty per variant, printer.

---

## Page Connection Map

```
Product Detail
 ├── Purchase by Supplier → Supplier Detail, Purchase Order, Receiving, Supplier Invoice
 ├── Sales by Customer → Customer Detail, Sales Order, Receipt, Returns
 ├── Reorder Suggestions → Create PO, Compare Supplier Price, Inventory Forecast
 └── Labels & Printing → Label Queue, Template Select, Print
```

---

## Backend API Routes

```
GET /api/v1/catalog/:id/sales-by-customer
GET /api/v1/catalog/:id/reorder-suggestions
GET /api/v1/catalog/:id/supplier-price-comparison
GET /api/v1/catalog/:id/labels
POST /api/v1/catalog/:id/labels/add-to-queue
```

## Data Source Mapping

### Sales by Customer
`orders` + `order_items` + `customers` + `returns` + `payments`

### Purchase by Supplier
`purchase_orders` + `purchase_order_items` + `vendors` + `goods_receipts` + `supplier_product_price_history`

---

## Implementation Status

| Tab | Component | Status |
|---|---|---|
| General (Overview) | `GeneralTab.tsx` | ✅ Built |
| Variants | `VariantsTab.tsx` | ✅ Built |
| Inventory | `InventoryTab.tsx` | ✅ Built |
| Pricing | `PricingTab.tsx` | ✅ Built |
| eCommerce | `EcommerceTab.tsx` | ✅ Built |
| Purchase by Supplier | `PurchasesTab.tsx` | ✅ Built |
| Sales by Customer | `SalesCustomerTab.tsx` | ✅ Built |
| Reorder Suggestions | `ReorderSuggestionsTab.tsx` | ✅ Built |
| Supplier Price Comparison | `SupplierPriceComparisonTab.tsx` | ✅ Built |
| Expiry / Batch / Lot | `ExpiryTab.tsx` | ✅ Built |
| Labels & Printing | *(merged into Images/actions for now)* | 🔶 Partial |
| Audit Log | `AuditLogTab.tsx` | ✅ Built |
| Suppliers | `SuppliersTab.tsx` | ✅ Built |
| Analytics | `AnalyticsTab.tsx` | ✅ Built |
| Images | `ImagesTab.tsx` | ✅ Built |
