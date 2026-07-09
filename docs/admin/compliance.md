# Compliance & age verification

## Age verification

For retailers selling age-restricted products (tobacco, vape, alcohol, cannabis):

1. Flag the product in **Catalog → [product] → Compliance tab**
   - Check **Age restricted** (triggers age-gate for all jurisdictions)
   - Or set `restricted_states` for state-specific blocks
2. At checkout, when an age-restricted item is added to the cart, Ascend shows a full-screen prompt:
   - **"Verify customer is 21+ (or 18+ for tobacco)"**
   - Cashier must tap **Confirmed — ID verified** to proceed
   - Tapping **Cancel** removes the item from the cart
3. The age-gate check is logged in the audit trail

## Tobacco compliance

### Product tagging

In **Catalog → [product] → Compliance tab**:
- `tobacco_type` — cigarettes, cigars, smokeless, chewing, vape, other
- `flavored` — true/false
- `menthol` — true/false
- `msa_reportable` — true/false (included in MSA exports)
- `restricted_states` — array of state codes where product is blocked

### State-level flavor bans

Ascend blocks sale of `flavored = true` products in states with active flavor bans (CA, MA, NJ, RI, IL). The list is maintained in `src/lib/complianceRules.ts`. When a restricted product is scanned at checkout and the outlet's state matches a restricted state, a hard block error is shown.

### MSA reporting

The Master Settlement Agreement (MSA) requires cigarette manufacturers and distributors to report sales volumes. For MSA-covered products:
1. Set `msa_reportable = true` on all qualifying products
2. Monthly: **Reports → Compliance → MSA Report → Export CSV**
3. Submit the CSV to your MSA administrator

### PACT Act (online sales)

For online tobacco/vape sales, PACT Act compliance requires age verification and state tax collection at checkout. Ascend does not currently automate PACT Act filings — use the compliance export and file manually or via a third-party service.

## Cannabis compliance

Ascend supports cannabis retail operations as a point-of-sale layer. It does not replace a state-mandated seed-to-sale tracking system (e.g. Metrc). You must integrate Ascend with your state's required track-and-trace system.

Ascend can:
- Track product by batch, weight unit, and strain
- Record sales and generate till reports
- Enforce age verification at checkout

Ascend cannot (and you must handle separately):
- Report to Metrc or other state systems
- Manage dispensary licenses or compliance reporting

## EBT / WIC

EBT (SNAP) and WIC acceptance requires a certified terminal and FNS authorization. Ascend supports EBT as a tender method via:
- A third-party EBT gateway (contact your payment processor)
- The "EBT" tender type in the checkout tender screen

WIC product eligibility must be flagged manually on eligible products.

## Audit log

Every change in Ascend is logged:
- Who made it (user + role)
- What changed (resource type, action, before/after values)
- When (timestamp)

**Settings → Audit Log** — filter by actor, resource type, action, or date range. Export as CSV for compliance reviews or audits.
