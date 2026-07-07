# Work Package 08: Customers, Accounts, Loyalty, And B2B Profiles

## Goal

Let retail consumers and wholesale business accounts coexist in one customer system without requiring the same data or workflows.

## Data Scheme

Customer types:

```txt
retail_consumer
wholesale_account
ecommerce_customer
mixed
```

Tables:

```txt
customers
customer_contacts
customer_addresses
customer_groups
customer_business_profiles
customer_licenses
customer_credit_profiles
loyalty_accounts
customer_price_assignments
```

## Existing Files To Touch

- `src/modules/customers`
- `src/modules/loyalty`
- `src/modules/billing`
- `src/modules/pricing`
- `web/app/(protected)/retail/customers`
- `web/app/(protected)/wholesale/customers`

## Backend Endpoints

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

## Tests

- Retail customer does not require credit profile.
- Wholesale customer supports contacts, addresses, terms, licenses, and price books.
- Restricted product flow can require valid customer license.

## Acceptance Criteria

- Customer screens are different by context but backed by shared customer master data.

