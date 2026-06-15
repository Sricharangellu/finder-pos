# Fulfillment / Shipping — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Finder's fulfillment/shipping stands today

- `src/modules/fulfillment`: locations (bins), assign products to
  locations, pick lists (create, pick line, pack).
- `src/modules/shipping`: shipping orders with pack → ship → deliver →
  cancel lifecycle.
- This is already a working pick → pack → ship → deliver pipeline — the
  assessment's "shipping module exists as a list with no fulfillment
  workflow" finding does **not** apply to Finder. FE-4 (locations grid +
  pick & pack queue UI) is already on the roadmap to surface this.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Carrier integration (UPS/FedEx/USPS/DHL), real-time rates, label printing | **Out of scope.** Each carrier is a paid API integration with credentials/contracts Finder doesn't have; building a generic carrier abstraction speculatively is exactly the kind of premature design this roadmap avoids. Revisit if a tenant requests a *specific* carrier. |
| Tracking number auto-capture + carrier status webhooks | **Worth a minimal version once a carrier is chosen** — `shipping` already has a `ship`/`deliver` transition; add an optional `tracking_number` + `carrier` string field now (free), defer webhook ingestion until carrier integration above is justified. |
| Pick list / pack list / packing slip generation (PDF) | **Pick lists already exist** as data. A printable packing slip is a frontend rendering concern (HTML→print), not a new backend feature — if pursued, it's a frontend item consuming the existing pick-list/shipping-order data. |
| Wave picking, zone-based shipping rules, dimensional weight, freight management | **Out of scope** — multi-warehouse/3PL complexity with no current tenant. |
| Driver/route assignment, last-mile routing, proof of delivery, signature capture | **Out of scope** — Finder doesn't operate a delivery fleet; this is a separate logistics product. |
| Return shipping labels, shipment insurance, dangerous-goods handling | **Out of scope**, same reasons as carrier integration. |

## What this turns into on the roadmap

- **BE-15** — Add optional `tracking_number` and `carrier` text fields to
  shipping orders, settable on `POST /:id/ship`. No carrier API integration
  — just a place to record the info a tenant already has. Small,
  unblocks a future carrier-webhook feature without committing to one now.

Everything else above is explicitly **not** on the roadmap. FE-4 (already
queued) remains the primary frontend item for this domain.
