# Finder Business Separation Work Packages

These work packages convert the retail, wholesale, ecommerce, warehouse, and shared-platform separation prompts into implementation tickets for the existing Finder codebase.

Use them as sequenced work, not as one giant build. Each package defines the user-facing separation, data ownership, connection points, endpoints, frontend surfaces, and acceptance criteria.

## Sequence

1. [Business Units, Channels, And Capabilities](01-business-units-capabilities.md)
2. [Identity, Roles, Permissions, And User Access](02-identity-permissions.md)
3. [Catalog And Product Channel Visibility](03-catalog-channel-visibility.md)
4. [Pricing And Price Books](04-pricing-price-books.md)
5. [Retail POS, Orders, Register, And Payments](05-retail-pos-orders-register-payments.md)
6. [Wholesale Quotes, Sales Orders, Credit, And Invoices](06-wholesale-sales-credit-invoices.md)
7. [Inventory, Warehouse, Lots, And Movements](07-inventory-warehouse-lots-movements.md)
8. [Customers, Accounts, Loyalty, And B2B Profiles](08-customers-accounts-loyalty-b2b.md)
9. [Purchasing, Vendors, Receiving, And Landed Cost](09-purchasing-vendors-receiving.md)
10. [Reports, Analytics, Dashboards, And Data Views](10-reports-analytics-dashboards.md)
11. [Integrations, Sync, Webhooks, And Connectors](11-integrations-sync-webhooks.md)
12. [Frontend Shell, Navigation, And UX Separation](12-frontend-shell-navigation-ux.md)
13. [End-To-End Workflow Orchestration](13-workflow-orchestration.md)

## Implementation Rule

For every package:

1. Database schema and migrations.
2. Service-layer behavior.
3. Routes and authorization guards.
4. Backend tests.
5. Frontend surfaces.
6. Frontend tests.
7. Reports, events, and integrations.

## Existing Finder Anchors

- Module registry: `src/modules/index.ts`
- Module contract: `src/modules/types.ts`
- Auth and tenant context: `src/gateway/auth.ts`, `src/shared/tenant-context.ts`
- Existing retail order module: `src/modules/orders`
- Existing wholesale sales module: `src/modules/sales`
- Existing settings/capability surface: `src/modules/settings`, `web/contexts/CapabilitiesContext.tsx`
- Frontend protected shell: `web/app/(protected)/layout.tsx`, `web/components/EnterpriseShell.tsx`

