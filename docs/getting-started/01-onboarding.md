# Getting started with Ascend

## What you need before you begin

- A Ascend account (owner credentials)
- Your business type (retail, restaurant, hotel, etc.)
- Hardware: receipt printer, barcode scanner, card reader (optional at first)

## Step 1 — Choose your business type

When you log in for the first time you land on the onboarding wizard at `/onboarding`.

1. Select your vertical (e.g. "Restaurant", "Retail", "Automotive"). This activates the right module bundle for your business.
2. Click **Confirm setup**. The navigation updates immediately to show the features for your vertical.

You can change this later in **Settings → Business Profile**.

## Step 2 — Add your products or services

Navigate to **Inventory → Catalog** and add your first products:

- **Retail**: add SKUs with barcode, price, and tax class.
- **Restaurant**: add menu items under categories (Beverages, Mains, etc.).
- **Services**: add service types with duration and price (used by appointments).
- **Other verticals**: the catalog is always the starting point for what you sell.

See [Catalog management](../core-workflows/catalog.md) for the full guide.

## Step 3 — Set up your team

Go to **Settings → Team** and invite staff:

| Role | What they can do |
|---|---|
| Owner | Everything — manage users, view all reports, change billing |
| Manager | Manage catalog, process refunds/voids, run reports |
| Cashier | Ring up sales, view products, accept payments |

Each user gets an email invite. They set their own password on first login.

## Step 4 — Configure your register

Go to **Settings → Outlets** to name your location(s). Then set up:

- **Receipt template** — header, footer, return policy
- **Tax rates** — per state/province
- **Payment methods** — cash, card, store credit, split tender

## Step 5 — Enable additional modules

Your base bundle covers the most common features for your vertical. To unlock extras, go to **Settings → Module Marketplace**:

- Browse all 60+ modules grouped by vertical
- Toggle individual modules on or off
- Changes take effect immediately — the navigation updates automatically

See [Module marketplace](../core-workflows/module-marketplace.md).

## Step 6 — Make your first sale

Navigate to the **Register** (or **POS**) from the sidebar. The checkout flow:

1. Add items by barcode scan, search, or tap
2. Select a customer (optional, required for loyalty and invoicing)
3. Choose tender (cash, card, split)
4. Complete the transaction — receipt prints automatically

See [Checkout & payments](../core-workflows/checkout.md).

## Offline mode

Ascend works without internet. When your connection drops:

- An **Offline** banner appears at the top of the register
- Sales are queued locally (IndexedDB)
- When connectivity resumes, queued transactions sync automatically

No data is lost if you lose connection mid-shift.
