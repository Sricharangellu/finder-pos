# Ascend — Domain Model & Team Ownership

Team → modules (`src/modules/*` unless noted). The owner reviews changes to
these modules and their tables. Shared entities (Product, Customer, Supplier,
Order, Invoice, Payment, Ledger Entry, Tenant, Location) each have exactly ONE
owning module — creating a duplicate concept is a constitution violation.

| Team | Modules |
|---|---|
| **Commerce** | orders (POS), sales (quotes/SOs), returns, discounts, promotions (in catalog), customers, loyalty, giftcards, quotes, service_orders |
| **Supply Chain** | inventory, purchasing (POs/suppliers/receiving), product_batches, serial_numbers, store_locations, outlets, fulfillment, shipping, warehouse pages |
| **Finance** | accounting (COA/ledger/deposits), billing (AP bills/AR invoices), payments, expenses, customer_invoices, tax (settings tax rates) |
| **Platform** | identity (src/identity), gateway (src/gateway), custom_roles, permission_requests, sso, sync, webhooks, sequences (+outbox infra), monitoring, notifications, audit_log, rls, workflows, search, settings |
| **Experience** | web/ (EnterpriseShell, components, pages), reports UI, storefront (/store) |
| **Verticals** (gated) | restaurant, healthcare, automotive, hospitality, manufacturing, rental, entertainment, education, golf pages |

Cross-team seams are event contracts (bus) and documented read-joins
(ADR-002) — never imports of another module's service.
