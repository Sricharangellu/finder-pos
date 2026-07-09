# Retail & General POS

## Who this is for

General merchandise retailers, convenience stores, specialty shops, liquor stores, pharmacies, and any business with a physical product catalog and walk-in customers.

## Activated modules

| Module | What it does |
|---|---|
| Catalog | Products, variants, categories, barcodes |
| Inventory | On-hand tracking, receiving, adjustments, cycle counts |
| POS / Register | Checkout, split tender, cash drawer, receipt printer |
| Discounts | Promo codes, percentage/flat discounts, loyalty-tier pricing |
| Loyalty | Points earn/redeem, tier auto-upgrade |
| Gift Cards | Issue, redeem, and void gift cards |
| Customers | Profiles, purchase history, store credit |
| Reports | Sales, inventory valuation, margin, low stock |

## Key workflows

### Daily open

1. **Open register session** — Register → Open session → enter opening float
2. Check **Low stock alerts** — Inventory → Low stock
3. Verify **Pending purchase orders** — Purchasing → Orders

### Ringing up a sale

See [Checkout & payments](../core-workflows/checkout.md) for full detail. Retail-specific tips:

- **Barcode scanning** — plug in any USB HID scanner; tap the search field and scan
- **Weighted items** — enter the weight manually when prompted (for products with `unit = kg/lb`)
- **Age-restricted items** — a full-screen age-gate prompts the cashier to verify ID for products flagged as tobacco, vape, or age-restricted alcohol

### End of day

1. **Close register session** — Register → Close session → count cash → confirm
2. The session summary shows expected vs. actual cash, total by tender type
3. **Z-report** prints automatically (or export from Reports → Register closures)

## Compliance (tobacco / vape)

For stores selling tobacco or vape products:

- Flag products in Catalog → [product] → Compliance tab
- Set `tobacco_type`, `flavored`, `restricted_states`
- At checkout, flavored products trigger an age-gate prompt
- Products in restricted states are blocked from sale (error shown at POS)
- **MSA reporting** — Reports → Compliance → export monthly MSA report

## Inventory tips

- Set **reorder points** on fast-moving items — Ascend surfaces them in Low Stock automatically
- Use **cycle counts** weekly for high-value sections; full stocktake quarterly
- Enable **expiry tracking** for perishable or dated products (food, supplements, medication)
- Use **store locations** (Aisle / Shelf / Bin) to speed up stocktakes and picking

## Gift cards

- Issue: Register → tender screen → Issue gift card → enter amount
- Redeem: Register → tender screen → Gift card → scan or enter code
- Balance inquiry: Customers → search card code → view balance
- Void: Customers → Gift cards → void (manager only)
