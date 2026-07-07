# Work Package 13: End-To-End Workflow Orchestration

## Goal

Connect modules through events and workflows rather than direct imports, keeping retail and wholesale behavior separate but coordinated.

## Event Model

Retail events:

```txt
retail.order.created
retail.payment.captured
retail.order.completed
retail.return.created
retail.register.closed
```

Wholesale events:

```txt
wholesale.quote.created
wholesale.sales_order.approved
wholesale.pick_list.created
wholesale.order.shipped
wholesale.invoice.created
customer.credit_exceeded
```

Shared events:

```txt
inventory.reserved
inventory.decremented
payment.captured
invoice.created
accounting.entry.posted
report.aggregate.updated
```

## Existing Files To Touch

- `src/orchestration`
- `src/shared/events.ts`
- `src/modules/orders`
- `src/modules/sales`
- `src/modules/inventory`
- `src/modules/payments`
- `src/modules/accounting`

## Workflow Requirements

Retail checkout:

```txt
price resolve -> tax calculate -> payment capture -> inventory decrement -> receipt -> accounting -> reports
```

Wholesale order:

```txt
price resolve -> credit check -> approval -> inventory reserve -> pick -> ship -> invoice -> AR -> accounting -> reports
```

## Tests

- Payment failure does not decrement inventory.
- Inventory failure does not create invoice.
- Duplicate requests do not duplicate sales.
- Failed workflows can be retried.

## Acceptance Criteria

- Every cross-module side effect is event-driven, idempotent, and auditable.

