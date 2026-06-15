# Ecommerce — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Finder's ecommerce module stands today

- `src/modules/ecommerce` + `outlets`: an "Ecommerce" outlet/channel exists
  alongside in-store outlets; orders can be tagged to it. Products have an
  ecommerce-visibility flag (from `CATALOG_PRODUCT_FINDER.md`'s BE-6 work).
- There is no storefront, no external-channel sync, and no payment-gateway
  integration — this is the most "greenfield" module relative to the
  assessment.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Multi-channel sync (Shopify/WooCommerce/Amazon/eBay), real-time cross-channel inventory | **Out of scope.** Each is a paid third-party integration; building a generic channel-sync abstraction with zero real channels is premature design. |
| Storefront / customer-facing site, B2B portal, product reviews | **Out of scope** — Finder is the back-office; a storefront is a separate frontend product. If a tenant needs one, it consumes Finder's existing `/api/v1/catalog` + `ecommerce` flag as a read API — no new backend work implied. |
| Online payment gateway integration | **Out of scope** — same reasoning as carrier integration in `FULFILLMENT_SHIPPING_GAPS.md`: no current gateway contract to integrate against. |
| Abandoned cart recovery, order status notifications, returns portal, chatbot | **Out of scope** — all assume a storefront that doesn't exist yet. |
| Wholesale pricing by customer tier on ecommerce | **Already have the data** — tier pricing exists in `sales` (Wave A/B). When a storefront exists, it reads the same tier-price endpoints; no separate ecommerce pricing model needed. |
| Age verification gate (tobacco/alcohol) | **Tracked in `SETTINGS_TEAM_COMPLIANCE_GAPS.md`** as a checkout-time check applicable to any channel, not ecommerce-specific. |

## What this turns into on the roadmap

No new items. This module stays as-is (an outlet/channel tag + visibility
flag) until a tenant has a concrete storefront/channel to integrate —
at that point the integration target itself determines the right contract,
and speculative work now would likely be thrown away.
