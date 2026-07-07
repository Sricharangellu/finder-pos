# Work Package 13: End-To-End Workflow Orchestration

## Goal

Connect modules through domain events and workflows — not direct imports —
keeping retail and wholesale behavior separate but coordinated, reliable, and
idempotent.

## Event model

Retail: `retail.order.created` · `retail.payment.captured` ·
`retail.order.completed` · `retail.return.created` · `retail.register.closed`.

Wholesale: `wholesale.quote.created` · `wholesale.sales_order.approved` ·
`wholesale.pick_list.created` · `wholesale.order.shipped` ·
`wholesale.invoice.created` · `customer.credit_exceeded`.

Shared: `inventory.reserved` · `inventory.decremented` · `payment.captured` ·
`invoice.created` · `accounting.entry.posted` · `report.aggregate.updated`.

## Workflows

Retail checkout:

```txt
price resolve -> tax calculate -> payment capture -> inventory decrement
-> receipt -> accounting post -> report aggregate
```

Wholesale order:

```txt
price resolve -> credit check -> approval -> inventory reserve -> pick list
-> shipment -> invoice -> AR update -> accounting post -> report aggregate
```

## Backend requirements

- Use the event bus (`src/shared/events.ts`), not cross-module imports.
- Use idempotency keys.
- Use an outbox table for reliable event processing.
- Use compensating actions for failed workflows.
- Keep module boundaries clean.

## Current repo files affected

- `src/orchestration/*`, `src/shared/events.ts`.
- `src/modules/orders`, `src/modules/sales`, `src/modules/inventory`, `src/modules/payments`, `src/modules/accounting`.

## Tests required

- A payment failure does not decrement inventory.
- An inventory failure does not create an invoice.
- A duplicate webhook/order request does not duplicate a sale.
- A failed workflow can be retried or manually reviewed.
- Workflow status is visible to the frontend.

## Acceptance criteria

- Every cross-module side effect is event-driven, idempotent, and auditable.
- Payment failure → no inventory decrement; inventory failure → no invoice.
- Duplicate requests never duplicate sales.
- Failed workflows are retryable/reviewable and their status is visible.

## Implementation checklist

- [ ] Retail + wholesale event contracts on the bus.
- [ ] Outbox table + reliable dispatch + idempotency keys.
- [ ] Retail checkout and wholesale order workflows wired via events.
- [ ] Compensating actions on failure (no partial commits).
- [ ] Workflow-status surface for the frontend + retry/review.
