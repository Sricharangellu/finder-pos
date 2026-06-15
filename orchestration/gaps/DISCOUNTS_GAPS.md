# Discounts — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Finder's discounts module stands today

`src/modules/discounts` is more advanced than the assessment gives credit
for:
- Rule types: `simple` (fixed/percent), `volume`, `bxgy` (i.e. BOGO) —
  `RuleType = "simple" | "volume" | "bxgy"`.
- `apply_to`: `product` | `category` | `cart`.
- `tier_restriction` (customer tiers 1–5), `min_order_cents`, `min_qty`,
  date window, `auto_applicable`, `usage_limit`, `per_customer_limit`
  (enforcement is BE-5, in progress).
- `POST /discounts/evaluate` and `/:id/redeem` exist.

The assessment's "only Simple Discount observed, no volume/tiered/BOGO" is
**outdated for Finder** — those rule types already exist in the schema and
service; what's missing is **frontend exposure** (a rule builder UI) and
**per-customer-limit enforcement** (BE-5, already queued).

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Volume/tiered, BOGO, customer-tier-restricted discounts | **Already built** (rule types above). Not a backend gap — see frontend item below. |
| Per-customer discount usage limits | **Already queued as BE-5.** |
| Discount rule builder UI (create/edit `simple`/`volume`/`bxgy` rules, tier restriction, coupon codes) | **Worth building** — `/discounts` page likely only lists rules today; an editor exposing the rule types Finder already supports is the highest-value frontend gap here. |
| Bundle discounts, category-level discounts | **`apply_to: category`/`product` already covers category-level**; a true multi-SKU "bundle" (buy A+B+C for $X) is a new `apply_to` value — defer until a tenant asks, since `bxgy` covers the common "buy X get Y" case. |
| Vendor-funded promotions, trade promotion management, deal sheets, scan-based discounts | **Out of scope** — these are vendor-rebate accounting concerns layered on top of discounts; would need `ACCOUNTING_GAPS.md`'s GL work as a prerequisite to track the vendor-funded portion. |
| Discount stacking rules/exclusions, discount budget tracking | **Defer** — `evaluate` presumably already has some stacking behavior (multiple discounts can apply); explicit exclusion rules are a refinement to revisit once multiple auto-applicable discounts actually collide for a real tenant. |

## What this turns into on the roadmap

- **FE-11** — Discount rule builder on `/discounts`: create/edit form
  covering `ruleType` (simple/volume/bxgy), `discountType`
  (fixed/percent), `applyTo`, `tierRestriction`, `minOrderCents`/`minQty`,
  `buyQty`/`getQty` (for bxgy), date window, `autoApplicable`,
  `usageLimit`/`perCustomerLimit`, coupon code. Consumes the existing
  `POST/GET/PATCH /api/v1/discounts*` endpoints (BE-5's enforcement once
  done).

Everything else above is explicitly **not** on the roadmap unless a future
need justifies it.
