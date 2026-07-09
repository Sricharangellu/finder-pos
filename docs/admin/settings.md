# Settings overview

## Settings sections

| Section | Location | What it controls |
|---|---|---|
| Business Profile | Settings → Business Profile | Business name, type, address, tax ID |
| Module Marketplace | Settings → Module Marketplace | Enable/disable individual modules |
| Team | Settings → Team | Invite staff, manage roles |
| Outlets & Registers | Settings → Outlets | Location setup, register config |
| Receipt Templates | Settings → Receipts | Header, footer, logo, return policy per outlet |
| Tax Rates | Settings → Tax | Tax rates by name and basis points |
| Payment Methods | Settings → Payments | Tender types, cash drawer, card reader |
| Loyalty | Settings → Loyalty | Tier rules, earn/redeem rates |
| Memberships | Settings → Memberships | Membership plans |
| Shipping Methods | Settings → Shipping | Available shipping options and rates |
| Payment Terms | Settings → Payment Terms | Net 30, Net 60, etc. |
| Email | Settings → Email | From address, provider config |
| Webhooks | Settings → Webhooks | Outbound event subscriptions |
| API Keys | Settings → API Keys | Create and revoke programmatic access |
| Custom Roles | Settings → Custom Roles | Fine-grained permission sets |
| SSO | Settings → SSO | OIDC/SAML single sign-on (enterprise) |
| Audit Log | Settings → Audit Log | Full change history |
| Feature Flags | Settings → Feature Flags | Enable/disable in-development features |

## Business profile

**Settings → Business Profile**

- Business name (shown on receipts and invoices)
- Business type (controls active module bundle)
- Address (printed on invoices and receipts)
- Tax ID / VAT number

Changing the business type activates or deactivates module bundles. Individual modules can be further tuned in the Module Marketplace.

## Outlets

Ascend supports multiple physical locations (outlets). Each outlet has:
- Name
- Address and timezone
- One or more registers

**Adding an outlet**: Settings → Outlets → New outlet → enter name and timezone → Save.

**Adding a register to an outlet**: Settings → Outlets → [outlet] → New register → enter name.

## Receipt templates

Each outlet can have its own receipt template:
- Header text (business name, address, phone)
- Footer text (thank-you message, return policy)
- Logo image URL
- Toggles: show barcode, show cashier name, show tax breakdown

Configure at **Settings → Receipts → [outlet]**.

## Feature flags

Feature flags gate in-development features. Toggle them at **Settings → Feature Flags** (owner only). Flags default to `false` in production. Enabling a flag activates the feature for your tenant only — it does not affect other tenants.

Current flags are documented in [API — Feature flags](../api/overview.md).
