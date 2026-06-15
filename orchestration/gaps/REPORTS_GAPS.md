# Reports — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note. The assessment lists
50+ named reports from the benchmark system — `ROADMAP.md` already warns
against chasing that list 1:1.

Updated: 2026-06-15.

## Where Finder's reports module stands today

`src/modules/reports`: summary/top-products/hourly, `ar-aging`, `ap-aging`,
`sales-by-category`, `sales-by-customer`, `inventory-valuation`. BE-3 (in
progress) adds `sales-by-rep`, `sales-by-vendor`, and a product-profit P&L.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| `sales-by-rep`, `sales-by-vendor`, P&L | **Already queued as BE-3.** |
| Sales-by-product, returns/lost-sales reports | **Worth a small follow-up** once BE-3 lands — same query shape (group by `product_id` instead of rep/vendor); low effort given BE-3 establishes the pattern. |
| Report scheduling / automated delivery | **Out of scope** — needs a job scheduler + email delivery, neither of which exist; Finder is serverless (Vercel functions), so "scheduled reports" means a new cron/worker surface. Revisit if/when `webhooks` gains a notification channel for `ACCOUNTING_GAPS.md` BE-14 (AR dunning) — that's a smaller, more concrete first step toward "the system proactively tells you things." |
| Custom report builder, BI export (Power BI/Tableau) | **Out of scope** — large self-serve surfaces; existing reports already return JSON that's trivially exportable to CSV (catalog already has a CSV export pattern from BE-7 to copy if needed). |
| Multi-store comparative reports, franchise rollups | **Tied to BE-4** (multi-store `storeIds[]` filter) — once that lands, existing reports can accept `?storeIds=` for comparison; not a new report type, an enhancement to existing ones. |
| Inventory turn-rate, gross margin by category/channel | **Margin by category is close** — `inventory-valuation` + `sales-by-category` together can compute it; a dedicated endpoint is low-effort once BE-3's pattern exists. Low priority. |
| Employee productivity, CAC/LTV, sales forecasting | **Out of scope** — analytics-heavy, no current tenant request. |

## What this turns into on the roadmap

No new items beyond what's already queued (BE-3, BE-4). After BE-3 lands,
add a one-line follow-up to `ROADMAP.md`'s Backend lane for
`sales-by-product` using the same query pattern — don't pre-create it now
per the "don't reorder, append concrete follow-ups as discovered" convention
in `AGENT_BACKEND_CYCLE.md`.
