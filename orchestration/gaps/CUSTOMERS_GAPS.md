# Customers — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Finder's customers module stands today

- `src/modules/customers`: company/DBA/tax-id/license, `tier` (1–5),
  financial summary (`dueCents`, `excessCents`, `storeCreditCents`), points
  redemption.
- `src/modules/giftcards`: issue/redeem gift cards (separate from store
  credit).
- Credit limit enforcement is tracked as **BE-13** in
  `SALES_ORDERS_GAPS.md` — not duplicated here.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Customer credit limit + enforcement | **Tracked in `SALES_ORDERS_GAPS.md` (BE-13)** — cross-cutting between customers and sales, owned there. |
| Loyalty program / points / membership tiers with benefits | **Points already exist** (redemption). "Tier with automatic benefits" overlaps `DISCOUNTS_GAPS.md` (tier-restricted discount rules) — not a separate customers feature. |
| Customer documents (resale certificates, licenses) | **Worth a minimal version**: `license_no` already exists as a string field; a `customer_documents` table (file metadata + expiry date, no actual file storage yet) would let a tenant track *that* a license/cert exists and when it expires, surfacing in a "compliance" report. Low priority — needs object storage (S3/Blob) to be genuinely useful, which Finder doesn't have yet. |
| Automated dunning | **Tracked in `ACCOUNTING_GAPS.md` (BE-14)** — it's an AR/invoice concern, not a customer-record concern. |
| Customer portal, RFM/LTV analysis, segmentation engine, satisfaction scoring | **Out of scope** — each is a standalone analytics/portal surface with no current tenant demand; RFM/LTV could become a `reports` addition later if requested (see `REPORTS_GAPS.md`). |
| Age verification workflow (tobacco/alcohol) | **Tracked in `SETTINGS_TEAM_COMPLIANCE_GAPS.md`** — it's a checkout-time compliance check, not a customer-record field. |
| Contact management (multiple contacts per company), delivery address book | **Worth a minimal version** if/when a tenant has B2B accounts with multiple buyers — defer until requested; the current single email/phone per customer covers most tenants. |

## What this turns into on the roadmap

No new items originate in this file — every actionable gap is either
already covered (points, tier, financial summary) or owned by another
gaps file (`SALES_ORDERS_GAPS.md` BE-13, `ACCOUNTING_GAPS.md` BE-14,
`SETTINGS_TEAM_COMPLIANCE_GAPS.md` for age verification). This file exists
so the cross-references are discoverable from the customers angle.
