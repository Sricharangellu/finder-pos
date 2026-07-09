# E-Commerce & Omnichannel

## Who this is for

Retailers who sell both in-store and online, and want a single inventory and order management system for both channels.

## Activated modules

| Module | What it does |
|---|---|
| Online Store | Publish products to the storefront catalog |
| Fulfillment | Pick lists, packing, shipment tracking |
| Marketplace Sync | Sync inventory with external channels (roadmap) |
| Shipping | Carrier selection, tracking numbers, delivery confirmation |

## Publishing products online

**Catalog → [product] → E-Commerce tab → toggle Online**

Or in bulk: **Catalog → Bulk update → Set online = true**

Published products appear in the public storefront catalog (`/api/v1/ecommerce/catalog`).

## Online checkout

Customer-facing checkout posts to `/api/v1/ecommerce/checkout`:
- Customer ID (required for authenticated checkout)
- Line items with quantities
- Payment is captured via Stripe

Online orders appear in **Orders** alongside in-store orders, tagged with channel = `ecommerce`.

## Customer portal

Authenticated customers can view their order history at `/portal/:customerId/orders`. This endpoint is public (no staff auth) — it uses the customer ID as the access token. For production, this should be wrapped in your storefront authentication layer.

## Fulfillment workflow

When an online order is placed:
1. A pick list is auto-created (or manually from **Fulfillment → Pick Lists → New**)
2. Warehouse staff opens the pick list → picks each line
3. **Pack** the shipment — confirms all items are boxed
4. **Ship** — enter carrier and tracking number; status moves to `shipped`
5. **Deliver** — mark delivered when tracking confirms

Order status is updated at each step; customers can view in the portal.

## Shipping methods

Configure available shipping options in **Settings → Shipping Methods**:
- Name (e.g. "Standard Shipping", "Express 2-Day")
- Fixed amount or calculated (calculated rates require carrier integration)

## Inventory synchronization

Ascend maintains a single inventory across in-store and online:
- An online sale decrements inventory just like an in-store sale
- A return (from either channel) restocks inventory
- Low stock alerts fire regardless of which channel caused the depletion

Third-party marketplace sync (e.g. external shopping platforms) is on the roadmap.
