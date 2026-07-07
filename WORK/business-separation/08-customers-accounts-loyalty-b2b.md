# Work Package 08: Customers, Accounts, Loyalty, And B2B Profiles

## Goal

Retail consumers and wholesale business accounts coexist in one customer system
without collision. Retail customers are walk-in consumers; wholesale customers
are business accounts with contacts, licenses, credit terms, price books, and
billing/shipping addresses.

## Database changes

Customer types: `retail_consumer`, `wholesale_account`, `ecommerce_customer`, `mixed`.

```txt
customers                 customer_contacts        customer_addresses
customer_groups           customer_business_profiles customer_licenses
customer_credit_profiles  loyalty_accounts         customer_price_assignments
```

## Current repo files affected

- `src/modules/customers`, `src/modules/loyalty`, `src/modules/billing`, `src/modules/pricing`.
- `web/app/(protected)/retail/customers`, `web/app/(protected)/wholesale/customers`.

## Backend endpoints

```txt
GET  /api/v1/customers?type=retail_consumer
GET  /api/v1/customers?type=wholesale_account
POST /api/v1/customers
PATCH /api/v1/customers/:id
POST /api/v1/customers/:id/contacts
POST /api/v1/customers/:id/licenses
GET  /api/v1/customers/:id/account-summary
GET  /api/v1/customers/:id/purchase-history
```

## Retail behavior

- Quick customer lookup; phone/email loyalty lookup; purchase history; loyalty
  points; receipts.

## Wholesale behavior

- Company account with multiple contacts; billing/shipping addresses; tax/resale
  licenses; credit profile; assigned price book (WP 04); AR balance (WP 06).

## Frontend screens

- Retail customer quick panel.
- Wholesale account detail page with tabs: Contacts, Licenses, Credit, Pricing,
  Purchase/invoice history.

## Tests required

- A retail customer does not require a credit profile.
- A wholesale customer can have multiple contacts and addresses.
- Wholesale orders require a valid account where configured.
- Restricted products require a valid license if applicable (WP 03/05).

## Acceptance criteria

- Customer screens differ by context but share one customer master.
- Retail consumer needs no credit profile; wholesale account carries contacts/addresses/licenses/credit/pricing.
- License requirements are enforced for restricted products where configured.

## Implementation checklist

- [ ] Customer `type` + business profile / licenses / credit tables.
- [ ] Type-filtered list endpoints + account-summary + purchase-history.
- [ ] Loyalty lookup (retail) and price-book assignment (wholesale, WP 04).
- [ ] Retail quick panel + wholesale account detail (tabs).
- [ ] License validation hook for restricted products.
