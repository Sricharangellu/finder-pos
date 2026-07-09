# Ascend — Enterprise Domain Roadmap

> Strategic design document. Defines all remaining enterprise domains in dependency order.
> Build in this sequence: domains higher in the list are prerequisites for domains below.
> Do NOT add isolated features — complete domain-by-domain so every module connects through
> a consistent domain model, RBAC, audit logging, workflows, and shared business rules.

---

## Design Principle

Stop adding isolated features. Design remaining enterprise domains so the entire platform
fits together before implementation. Build in **dependency order**, not feature order.

Target end state: Ascend transitions from a POS application into a complete enterprise
retail operations platform, scalable from single-store to multi-brand, multi-country,
franchise, wholesale, and omnichannel deployments.

---

## Domain Build Order

| Priority | Domain | Depends on |
|---|---|---|
| 1 | Sales & Order Management | Products, Customers, Payments |
| 2 | Customer 360 | Orders, Payments, Loyalty, Comms |
| 3 | Supplier 360 | Products, POs, Receiving, Invoices |
| 4 | Warehouse Management (WMS) | Products, Inventory, Transfers |
| 5 | Pricing Engine | Products, Price Books, Customer Groups |
| 6 | Promotion Engine | Pricing, Products, Customers, Loyalty |
| 7 | Enterprise Workflow Engine | All domains (approval gates) |
| 8 | Notification Center | All domains (event listeners) |
| 9 | Document Center | All transaction domains |
| 10 | Business Intelligence (BI) | All domains (read-only views) |
| 11 | Automation Engine | Workflow Engine, Notification Center |
| 12 | Integration Hub | All domains (external connectors) |
| 13 | Analytics & AI | BI data, all transactional domains |

---

## 1. Sales & Order Management (Highest Priority)

**Path:** `/sales`

### Module tree
```
Sales
├── Dashboard
├── Orders
├── Quotes
├── Layaways
├── Backorders
├── Invoices
├── Deliveries
├── Returns
├── Refunds
├── Exchanges
├── Customer Credit
├── Order Timeline
├── Payments
├── Taxes
├── Discounts
├── Shipping
├── Omnichannel Orders
└── Audit
```

### Order lifecycle (linear dependency chain)
```
Customer → Cart → Order → Payment → Invoice → Delivery → Return → Refund → Accounting
```

### Key design rules
- Orders are **immutable** — use status transitions + adjustment records, never edit in place
- Every state change creates an `order_events` record (timeline)
- Refunds always reference an original payment — no standalone refunds
- Layaways: partial payment, reserved stock, configurable expiry
- Backorders: order accepted, stock not yet available — linked to reorder suggestions
- Exchanges: return + new order in one transaction (atomic)
- Omnichannel: online orders, marketplace, phone, in-store all in one view

### Status state machine
```
Draft → Confirmed → Processing → Packed → Shipped → Delivered → Completed
                                                               → Returned
               → Cancelled
               → Backordered
               → On Hold (approval pending)
```

---

## 2. Customer 360 (Second Priority)

**Path:** `/customers/[id]` (upgrade existing page)

### Full tab workspace
```
Overview | Profile | Addresses | Contacts | Purchase History | Products Purchased |
Wish Lists | Subscriptions | Quotes | Invoices | Returns | Refunds | Payments |
Store Credit | Gift Cards | Loyalty | Reward Points | Communication | Marketing |
Support Tickets | Documents | Analytics | Audit
```

### Intelligence features (Customer Analytics tab)
| Intelligence | Source |
|---|---|
| Frequently purchased products | `order_items` frequency |
| Suggested reorder | Last purchase date + replenishment cycle |
| Average basket size | `orders.total_cents / order_count` |
| Lifetime value (LTV) | Sum of all `payments` |
| Churn prediction | Days since last order vs avg purchase interval |
| Favourite brands | Most purchased brand from `order_items → products.brand` |
| Buying seasonality | Monthly order frequency heatmap |

---

## 3. Supplier 360 (Third Priority)

**Path:** `/vendors/[id]` (upgrade existing page)

### Full tab workspace
```
Overview | Contacts | Products | Catalog | Price Lists | Purchase Orders | Receiving |
Invoices | Payments | Credit Notes | Lead Times | Performance | Quality |
Returns | EDI | Documents | Analytics | Audit
```

### Supplier KPIs (Performance tab)
| KPI | Formula |
|---|---|
| On-time delivery % | delivered_on_time / total_deliveries × 100 |
| Average lead time | avg(received_at − ordered_at) in days |
| Price trends | unit_cost change % over 90d rolling window |
| Fill rate | qty_received / qty_ordered × 100 |
| Defect rate | defective_qty / total_received × 100 |
| Order accuracy | lines_without_discrepancy / total_lines × 100 |
| Response time | avg(acknowledgment_at − sent_at) |
| Purchase volume | sum(po_total) per period |
| Spend analysis | Spend by product category, % of total COGS |

---

## 4. Warehouse Management System (WMS)

**Path:** `/warehouse`

### Module tree
```
Warehouses → Zones → Aisles → Shelves → Bins → Pallets
Receiving | Putaway | Picking | Packing | Transfers | Cycle Counts | Physical Counts |
Adjustments | Shipping | Cross Docking
```

### Location hierarchy
```
Warehouse → Zone → Aisle → Rack → Shelf → Bin → Pallet → Item
```

### Key operations
- **Receiving**: inbound from PO, validate against ASN/EDI 856
- **Putaway**: assign bin location, print bin label, update inventory_balances
- **Picking**: FIFO/FEFO/LIFO strategies, pick-list generation, scan-to-confirm
- **Packing**: pack slip, weight/dim capture, carton label
- **Transfers**: inter-warehouse, inter-outlet, with in-transit status
- **Cycle Counts**: ABC classification-based schedule, partial counts without full lock
- **Cross Docking**: receive + immediately route to outbound dock without storage

---

## 5. Pricing Engine

**Path:** `/pricing` (standalone module)

### Pricing types
```
Retail Pricing      Wholesale Pricing     Customer Pricing
Tier Pricing        Contract Pricing      Location Pricing
Marketplace Pricing Scheduled Pricing     Markdowns
Margin Rules
```

### Pricing resolution order (highest to lowest priority)
```
1. Contract price (customer-specific)
2. Customer group price
3. Tier price (quantity break)
4. Price book price
5. Promotional price (active promotion)
6. Scheduled markdown
7. Retail base price
```

### Key rules
- Price changes above threshold → Workflow Engine approval
- All price changes create `price_change_log` entry (field-level audit)
- Scheduled prices activate/deactivate automatically via job
- Margin floor rule: never sell below configured minimum margin

---

## 6. Promotion Engine

**Path:** `/promotions` (upgrade existing page)

### Promotion types
```
Coupons             Promo Codes           Buy X Get Y
Mix & Match         Bundles               Flash Sales
Member Pricing      Loyalty Discounts     Automatic Discounts
Campaigns
```

### Stacking rules
- Define which promotion types can stack (e.g. coupon + automatic OK, two automatics not OK)
- Priority order when promotions conflict
- Max discount cap (% or $ amount) per order

---

## 7. Enterprise Workflow Engine

**Path:** `/workflows` (upgrade existing page)

### Approval-required actions
```
Price Change              Inventory Adjustment      Purchase Approval
Refund Approval           Void Sale                 Customer Credit
Delete Product            Delete Customer           Permission Requests
Cash Drawer Close
```

### Configurable approval chain
```
Employee → Supervisor → Store Manager → Regional Manager → Finance → Owner
```

### Design rules
- Chain is tenant-configurable per action type
- Escalation timeout (auto-escalate if not actioned within N hours)
- Any step can be skipped by configuring chain to omit it
- Approval/rejection emails sent automatically
- Full approval history in audit log

---

## 8. Notification Center

**Path:** `/notifications` (upgrade existing page)

### Notification triggers
```
Low Stock             Price Changes         Large Refund
Failed Payment        EDI Error             Receiving Complete
Purchase Approved     Customer Credit Limit Permission Request
Security Alert
```

### Delivery channels
```
In-app    Email    SMS    Push    Webhooks
```

### Design rules
- Each notification type has configurable per-user channel preferences
- Throttling rules (no more than N of same type per hour)
- Notification severity levels: Info / Warning / Critical
- Mark as read, bulk dismiss, link to affected entity

---

## 9. Document Center

**Path:** `/documents`

### Document types
```
Invoices              Purchase Orders       Receipts
Returns               Product Images        Compliance Certificates
Vendor Agreements     Employee Documents    Reports
```

### Design rules
- All documents linked to a parent entity (order, product, vendor, etc.)
- Version history (never delete, only supersede)
- Download, preview, share link generation
- RBAC: some doc types restricted to finance/owner role

---

## 10. Business Intelligence (BI)

**Path:** `/analytics` or `/bi`

### Dashboard suite
```
Executive Dashboard    Sales Dashboard       Inventory Dashboard
Purchasing Dashboard   Finance Dashboard     Customers Dashboard
Products Dashboard     Employees Dashboard   Suppliers Dashboard
Warehouses Dashboard
```

### Design rules
- Drill-down from summary → detail → individual record
- Date range selector on every dashboard (presets + custom)
- Comparisons: vs previous period, vs same period last year
- Export to CSV / PDF on every chart/table
- Role-based widget visibility (cashier sees sales only, owner sees all)

---

## 11. Automation Engine

**Path:** `/automations` (upgrade existing workflows page)

### Example trigger → action pairs
| Trigger | Action |
|---|---|
| `stock < reorder_point` | Create draft PO for preferred supplier |
| `supplier_invoice arrives` | Match with open PO, flag variances |
| `expiry_date < 30 days` | Notify inventory manager |
| `customer.total_spend > $10,000` | Upgrade to VIP pricing tier |
| `refund_amount > $500` | Route to approval workflow |
| `order.status = shipped` | Send tracking email to customer |
| `po.status = received` | Update average cost, close PO |

### Design rules
- Visual trigger/condition/action builder (no-code)
- Test mode: dry-run without executing actions
- Execution log for every fired automation
- Pause/resume per automation

---

## 12. Integration Hub

**Path:** `/integrations` (upgrade existing page)

### Integration categories
| Category | Examples |
|---|---|
| Ecommerce | Shopify, WooCommerce, Amazon, eBay |
| Accounting | QuickBooks, Xero, Sage |
| Payments | Stripe, Square, Worldpay |
| EDI | GS1, SPS Commerce |
| Shipping Carriers | FedEx, UPS, USPS, DHL |
| Email | SendGrid, Mailchimp, Resend |
| SMS | Twilio, Vonage |
| ERP | SAP, Oracle, Microsoft Dynamics |

### Design rules
- Each integration has a health status + last-sync timestamp
- Sync logs per integration (success / error / skipped)
- Field mapping UI for each connector
- Webhook delivery log

---

## 13. Analytics & AI

**Path:** `/ai-insights`

### AI/ML features
| Feature | Input | Output |
|---|---|---|
| Inventory forecasting | Sales history, seasonality, lead time | Recommended stock levels |
| Demand prediction | Order history, trends, events | Units to order per SKU |
| Supplier recommendations | Price history, fill rate, lead time | Best supplier per SKU |
| Price optimization | Demand elasticity, competitor prices | Suggested retail price |
| Product affinity analysis | `order_items` basket data | Cross-sell / upsell suggestions |
| Customer segmentation | RFM model (Recency, Frequency, Monetary) | Segments for campaigns |
| Sales forecasting | Historical sales + seasonality | Revenue projection |
| Stock aging analysis | Days on hand, sell-through rate | Dead stock identification |
| Fraud detection | Order patterns, payment anomalies | Flagged suspicious orders |
| Suggested POs | Reorder signals + supplier data | Draft POs ready to approve |
| Suggested transfers | Stock imbalance between outlets | Transfer recommendations |

---

## Final Enterprise Layer (after all domains above are complete)

Once all 13 domains are implemented, the final enterprise layer adds cross-cutting services:

| Layer | Components |
|---|---|
| Workflow & Approval Engine | Configurable chains, escalation, SLA |
| Rule Engine | Business rule definitions (pricing, compliance, tax) |
| Notification Center | Unified multi-channel notification delivery |
| Reporting & BI | Scheduled reports, custom report builder, dashboards |
| Automation Engine | No-code trigger/action automations |
| Integration Marketplace | App store for connectors |
| AI Recommendation Engine | ML-powered suggestions across all domains |
| Administration & System Settings | Tenant config, feature flags, health monitoring |

At that point, Ascend is a complete enterprise retail operations platform.

---

## Current Build Status vs Roadmap

| Domain | Frontend | Backend | Priority |
|---|---|---|---|
| Products (PIM) | ✅ 20 tabs | 🔶 Mock | Done |
| Purchasing / POs | ✅ Built | 🔶 Mock | Done |
| Inventory | ✅ Built | 🔶 Mock | Done |
| Sales & Orders | ✅ Partial | 🔶 Mock | **Next** |
| Customer 360 | ✅ Partial | 🔶 Mock | 2nd |
| Supplier 360 | ✅ Partial | 🔶 Mock | 3rd |
| WMS | 🔲 Not started | 🔲 Not started | 4th |
| Pricing Engine | 🔶 Embedded in Products | 🔲 Not started | 5th |
| Promotion Engine | ✅ Basic page | 🔶 Mock | 6th |
| Workflow Engine | ✅ Basic page | 🔶 Mock | 7th |
| Notification Center | ✅ Basic page | 🔶 Mock | 8th |
| Document Center | 🔲 Not started | 🔲 Not started | 9th |
| BI / Analytics | ✅ Basic dashboards | 🔶 Mock | 10th |
| Automation Engine | ✅ Basic page | 🔶 Mock | 11th |
| Integration Hub | ✅ Basic page | 🔶 Mock | 12th |
| Analytics & AI | ✅ Basic page | 🔲 Not started | 13th |
