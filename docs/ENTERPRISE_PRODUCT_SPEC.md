# Ascend — Enterprise Product (PIM + Inventory + Supply Chain) Spec

> Authoritative design spec for the Product domain. Products are the **central business entity** —
> every other module (purchasing, inventory, sales, accounting, reporting, analytics) references them.
> Consult before any work on the catalog, variants, inventory, ecommerce, or label printing.

---

## 1. Architecture Philosophy

Ascend treats the Product module as a **PIM + Inventory + Supply Chain** system, not a simple CRUD form. This mirrors how enterprise platforms structure the product domain: a 360° workspace where every downstream process references authoritative product data.

---

## 2. Product Management Module Tree

```
Product Management
│
├── Dashboard
│
├── Products
│   ├── Product List
│   ├── Product Detail
│   ├── Product Wizard
│   ├── Product Import
│   ├── Product Export
│   ├── Bulk Actions
│   └── Product Archive
│
├── Categories
├── Brands
├── Manufacturers
├── Suppliers
├── Collections
├── Product Types
├── Attributes
├── Variants
├── Bundles
├── Kits
├── Assemblies
├── Recipes
├── BOM (Bill of Materials)
├── Pricing
├── Promotions
├── Inventory
├── Purchasing
├── Warehousing
├── Sales
├── Ecommerce
├── Marketplace
├── Audit
└── Analytics
```

---

## 3. Product Detail Page — Tab Workspace

The Product Detail page is a **workspace with connected submodules**, not a form.

```
Product Detail
 ├── Overview
 ├── Variants
 ├── Pricing
 ├── Inventory
 ├── Warehouses
 ├── Suppliers
 ├── Purchase History
 ├── Sales History
 ├── Transfers
 ├── Reservations
 ├── Serial Numbers
 ├── Lots
 ├── Expiry
 ├── Compliance
 ├── Tax
 ├── Images
 ├── Documents
 ├── Marketplace
 ├── POS Settings
 ├── Wholesale
 ├── Promotions
 ├── Analytics
 ├── Audit Log
 └── Settings
```

### Workspace layout
- **Left nav**: Persistent section navigator (Overview, Inventory, Pricing, Compliance, Analytics, etc.)
- **Center workspace**: Context-specific data tables, forms, charts, related records
- **Right panel**: Quick actions, product KPIs, alerts, workflow status, approval tasks, recent activity
- **Sticky action bar**: Save, Publish, Duplicate, Archive, Print Labels, Generate Barcodes, Export, View Audit Log
- **Relationship chips**: Clickable links to Vendor, Purchase Orders, Inventory Locations, Sales Orders, Returns
- **Status timeline**: Draft → Approved → Published → Active → Low Stock → Reorder → Archived

---

## 4. Parent → Child Matrix

```
Product
│
├── Variants
│    ├── SKU
│    ├── Barcode
│    ├── Price
│    ├── Inventory
│    ├── Supplier
│    └── Images
│
├── Categories
├── Brand
├── Manufacturer
├── Collections
├── Warehouses
├── Price Books
├── Promotions
├── Vendors
├── Purchase Orders
├── Inventory Movements
├── Sales Orders
├── Returns
├── Transfers
├── Lots
├── Serial Numbers
├── Batches
├── Expiry Records
├── Documents
├── Images
├── Attachments
├── Recipes
├── Components
└── Audit Log
```

### Master vs Child split

| Data | Lives on | Notes |
|---|---|---|
| Name, Brand, Category, Description | Master product | Shared across all variants |
| Images, Tax category, SEO content | Master product | Shared |
| SKU, Barcode, Color, Size | Variant | Variant-specific |
| Price, Cost, Weight | Variant | Variant-specific |
| Inventory, Expiry, Batch, Serial | Variant | Per-location per-variant |
| Vendor SKU, Label format | Variant | Variant-specific |

---

## 5. Product Lifecycle

```
Draft → Pending Approval → Approved → Published → Selling → Low Stock → Reorder → Discontinued → Archived
```

---

## 6. Product Tracking Types

Supported per product:

```
No Tracking       SKU Tracking       Barcode Tracking    QR Tracking
RFID              Serial Number      Batch Number         Lot Number
IMEI              UPC                EAN                  ISBN
GTIN              Expiration Date    Manufacturing Date   Warranty
Asset Tag         Vendor SKU         Internal SKU
```

---

## 7. Inventory Tracking Modes

```
Simple Inventory          Batch Inventory          Lot Tracking
Serialized Inventory      Per Warehouse Inventory  Per Store Inventory
Per Bin Inventory         Per Shelf Inventory      Per Pallet Inventory
Cold Storage Tracking     Temperature Controlled Tracking
```

---

## 8. Expiry Tracking Fields

```
Manufacturing Date    Expiry Date       Best Before      Sell By
Use By               Opened On         Shelf Life        Remaining Shelf Life
Expiry Alerts        Expired Stock     Near Expiry       Quarantine
Disposed             Recall
```

---

## 9. Batch Tracking Fields

```
Batch Number     Production Date    Received Date    Expiry Date
Quantity         Warehouse          Supplier         Purchase Order
Quality Status   Inspection Status  Released         Rejected         Quarantine
```

---

## 10. Serial Number Tracking Fields

```
Serial Number    Warranty         Purchase Date    Customer
Repair History   Return History   Current Status   Current Location   Current Owner
```

---

## 11. Warehouse / Location Tracking

```
Warehouse → Zone → Aisle → Rack → Shelf → Bin → Pallet

Per location:
  Quantity    Reserved    Available    Incoming    Outgoing    Damaged    Returned
```

---

## 12. Product Feature Fields

### Basic
`SKU`, `Barcode`, `QR Code`, `Name`, `Description`, `Category`, `Brand`, `Vendor`, `Images`, `Status`, `Weight`, `Dimensions`

### Pricing
`Retail Price`, `Wholesale Price`, `Cost Price`, `Average Cost`, `Landed Cost`, `MAP Price`, `Sale Price`, `Tier Pricing`, `Contract Pricing`, `Customer Group Pricing`, `Price Books`

### Tax
`Tax Category`, `Tax Code`, `Country`, `State`, `VAT`, `GST`, `PST`, `HST`, `Tax Exempt`

### Compliance
`FDA`, `USDA`, `CE`, `RoHS`, `REACH`, `Hazmat`, `MSDS`, `Nutrition`, `Ingredients`, `Allergens`

### Purchasing
`Default Vendor`, `Lead Time`, `MOQ`, `Case Pack`, `Reorder Point`, `Preferred Vendor`, `Vendor SKU`, `Purchase UOM`

### Inventory
`Track Inventory`, `Allow Negative`, `Reserve Stock`, `Committed Stock`, `Available Stock`, `Incoming Stock`, `Safety Stock`, `Maximum Stock`, `Cycle Count`, `ABC Classification`

### Ecommerce
`SEO`, `Slug`, `Meta Title`, `Meta Description`, `Search Keywords`, `Related Products`, `Cross Sell`, `Upsell`, `Images`, `Videos`

### Wholesale
`Case Pricing`, `Pallet Pricing`, `Contract Pricing`, `Customer Pricing`, `Credit Terms`, `MOQ`, `Bulk Discounts`

---

## 13. Product List View

The list supports multiple display modes via a view switcher:

```
Master View | Variant View | Grid View | Ecommerce View | Inventory View | Label View
```

### Collapsed master view
```
▸ Nike T-Shirt
   Parent SKU: NTS-001  |  Variants: 12  |  Channels: POS, Ecommerce  |  Status: Active
```

### Expanded parent → child view
```
▼ Nike T-Shirt
   ├── Red / Small     SKU: NTS-R-S
   ├── Red / Medium    SKU: NTS-R-M
   ├── Blue / Small    SKU: NTS-B-S
   └── Blue / Medium   SKU: NTS-B-M
```

---

## 14. Product Filters

```
Search by name / SKU / barcode / vendor SKU
Category / Brand / Vendor / Product type / Variant option
Status / Ecommerce status / Inventory status
Low stock / Out of stock / Overstock / Near expiry / Expired
Batch tracked / Serial tracked / Lot tracked
Has image / Missing image / Missing barcode / Missing price / Missing cost
Online enabled / POS enabled / Taxable / Discountable
Created date / Updated date / Outlet / Warehouse / Sales channel
```

### Saved views (built-in)
```
All Products        POS Products        Ecommerce Products    Low Stock
No Barcode          Missing Images      Near Expiry           Draft Ecommerce
Published Online    High Margin         Recently Updated      Needs Review
```

---

## 15. Bulk Update Rules

### Bulk-editable fields
Category, Brand, Vendor, Status, POS/Ecommerce visibility, Taxable, Discountable, Track inventory, Reorder point/qty, Retail/Wholesale/Cost/Compare-at price, SEO title/description, Tags, Collections, Shipping class, Label template, Barcode type, Print quantity

### Bulk price update modes
Set exact price | Increase/Decrease by amount | Increase/Decrease by % | Set margin % | Round price rule | Apply price book

### Bulk safety rules
- Preview changes before applying, show affected count
- Require confirmation for price changes
- Require `products.bulk_update` permission
- Create audit log entry for every changed field
- Allow rollback of batch update
- Export snapshot before applying

---

## 16. Ecommerce Product Controls

### Per-product ecommerce settings
```
Ecommerce Enabled       Online Store Visibility    Sales Channel
Product URL Slug        SEO Title                  SEO Description
SEO Keywords            Online Description         Short Description
Product Images          Product Videos             Size Chart
Shipping Class          Return Policy
Related Products        Upsell Products            Cross-Sell Products
Marketplace Status      Publish Status             Schedule Publish/Unpublish Date
```

### Ecommerce publish statuses
`Draft` | `Ready to Publish` | `Published` | `Hidden` | `Out of Stock Online` | `Scheduled` | `Archived`

### Ecommerce Product View tabs
```
Online Preview | SEO | Media | Variants | Online Pricing | Shipping | Channels | Related Products | Reviews | Analytics | Publish Settings
```

### Right panel
Online status | SEO score | Image completeness | Missing fields | Publish checklist | Channel errors | Last synced time

---

## 17. Label Printing Center

```
Label Printing Center
 ├── Select Products
 ├── Label Queue
 ├── Label Sequence
 ├── Template Selection
 ├── Size Selection
 ├── Printer Selection
 ├── Preview
 └── Print History
```

### Mixed-type label queue
Users add products of any type into a single print queue:
```
1. T-Shirt Red Small     → 10 labels
2. Milk 1 Gallon         → 25 labels
3. iPhone Case           → 15 labels
4. Gift Card $50         → 20 labels
5. Bakery Item           → 30 labels
```

### Label sequence options
By selected order | By category | By brand | By SKU | By barcode | By product type | By outlet | By warehouse bin | By expiry date | By vendor | By receiving batch | By purchase order

### Label data fields (configurable per template)
Product name | Variant name | SKU | Barcode | QR code | Price | Compare-at price | Brand | Category | Size | Color | Batch number | Lot number | Expiry date | Manufacturing date | Vendor SKU | Store name | Outlet code | Bin location | Currency | Custom field

### Label sizes supported
1×1" | 1×2" | 2×1" | 2×2" | 2.25×1.25" | 3×1" | 3×2" | 4×2" | A4 sheet | Letter sheet | Jewelry tag | Shelf label | Food expiry label | Warehouse bin label | Shipping label | Custom

Custom settings: Width, Height, Margin, Padding, Gap, Rows, Columns, DPI, Rotation, Font size, Barcode size, QR size

### Product-type label defaults
| Product type | Default label |
|---|---|
| Retail product | Price + barcode |
| Food product | Expiry + batch |
| Serialized product | Serial number |
| Warehouse product | Bin + SKU |
| Gift card | QR / barcode |
| Apparel | Size + color |
| Jewelry | Small tag |
| Electronics | Serial + warranty |
| Pharmacy/Health | Lot + expiry |

---

## 18. Printer & External Driver Connection

### Settings path
`Settings → Printing & Devices`
```
 ├── Printers
 ├── Label Templates
 ├── Barcode Settings
 ├── Print Drivers
 ├── Test Print
 ├── Device Mapping
 └── Print Logs
```

### Connection types
USB | Bluetooth | Wi-Fi | Network IP | Cloud Print | Browser Print | Raw TCP/IP | ESC/POS | ZPL | EPL | PDF print | External driver

### Printer categories
Receipt | Barcode label | Shipping label | Shelf label | Kitchen | Warehouse

### Printer record fields
Name, Type, Connection type, IP address, Port, Driver type, Default label size, Default template, Assigned outlet, Assigned register, Assigned user, Status, Last test print

---

## 19. Page-to-Page Connections

```
Product List → Product Detail → Ecommerce Product View → Variant Detail → Inventory Detail → Label Printing Center → Printer Settings

Inventory Receiving → Add received products to label queue → Select template → Print receiving labels

Purchase Order → Receive items → Generate labels by PO → Print by receiving sequence

Product Import → Map fields → Validate barcodes → Generate missing barcodes → Add imported products to label queue

Bulk Update → Preview changes → Apply → Create audit log → Optional print labels for updated items
```

### Full downstream chain
```
Product → Variant → Inventory → Warehouse → Bin → Purchase Order → Vendor → Receiving
→ Stock Movement → Sales Order → Invoice → Payment → Customer → Return → Refund
→ Inventory Update → Reports → Audit Log
```

---

## 20. Database Schema Additions

### `ecommerce_product_settings`
```sql
CREATE TABLE ecommerce_product_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL,
    enabled BOOLEAN DEFAULT false,
    slug VARCHAR(255),
    seo_title VARCHAR(255),
    seo_description TEXT,
    online_description TEXT,
    short_description TEXT,
    publish_status VARCHAR(50) DEFAULT 'draft',
    publish_at TIMESTAMP,
    unpublish_at TIMESTAMP,
    shipping_class VARCHAR(100),
    return_policy_id UUID,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, product_id)
);
```

### `label_templates`
```sql
CREATE TABLE label_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    label_type VARCHAR(100),
    width NUMERIC(10,3),
    height NUMERIC(10,3),
    unit VARCHAR(20) DEFAULT 'inch',
    dpi INT DEFAULT 203,
    layout JSONB NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

### `product_label_settings`
```sql
CREATE TABLE product_label_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID,
    variant_id UUID,
    default_template_id UUID,
    barcode_type VARCHAR(50),
    default_print_quantity INT DEFAULT 1,
    custom_label_data JSONB,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

### `label_print_jobs`
```sql
CREATE TABLE label_print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    job_number VARCHAR(100) NOT NULL,
    printer_id UUID,
    template_id UUID,
    status VARCHAR(50) DEFAULT 'draft',
    sequence_mode VARCHAR(100),
    created_by UUID,
    created_at TIMESTAMP DEFAULT now(),
    printed_at TIMESTAMP,
    UNIQUE (tenant_id, job_number)
);
```

### `label_print_job_items`
```sql
CREATE TABLE label_print_job_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    print_job_id UUID NOT NULL,
    product_id UUID,
    variant_id UUID,
    label_quantity INT NOT NULL DEFAULT 1,
    sequence_number INT,
    label_data JSONB,
    created_at TIMESTAMP DEFAULT now()
);
```

### `printers`
```sql
CREATE TABLE printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID,
    register_id UUID,
    name VARCHAR(255) NOT NULL,
    printer_type VARCHAR(100),
    connection_type VARCHAR(100),
    ip_address VARCHAR(100),
    port INT,
    driver_type VARCHAR(100),
    default_label_size VARCHAR(100),
    default_template_id UUID,
    status VARCHAR(50) DEFAULT 'active',
    last_tested_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

### `printer_drivers`
```sql
CREATE TABLE printer_drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    driver_type VARCHAR(100),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    protocol VARCHAR(100),
    settings JSONB,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now()
);
```

### `print_logs`
```sql
CREATE TABLE print_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    printer_id UUID,
    print_job_id UUID,
    status VARCHAR(50),
    message TEXT,
    printed_by UUID,
    created_at TIMESTAMP DEFAULT now()
);
```

---

## 21. RBAC Permission Codes

```
products.view           products.create         products.update
products.bulk_update    products.export         products.import

ecommerce_products.view     ecommerce_products.update   ecommerce_products.publish

labels.view     labels.create   labels.print    labels.manage_templates

printers.view   printers.create     printers.update     printers.test   printers.delete
```

---

## 22. Advanced Enterprise Features (roadmap)

- Product versioning with rollback
- Configurable products and dynamic variant generation
- Multi-language product content and localized pricing
- Multi-currency price books
- AI-assisted product categorization and attribute extraction
- Demand forecasting and automatic reorder recommendations
- Product lifecycle management (PLM)
- Quality inspection and quarantine workflows
- Vendor scorecards and supplier performance metrics
- Product relationship graph (substitutes, accessories, cross-sell, upsell)
- Digital asset management (DAM) for images, videos, manuals, certificates
- GS1 standards support (GTIN, SSCC, EPC/RFID)
- Configurable approval workflows for product creation and pricing changes
- Enterprise search with saved filters and customizable views
- Field-level audit history and change comparison
- Real-time inventory availability across all outlets and warehouses
