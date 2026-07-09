# Ascend — Enterprise Orchestration Layer

This directory contains the orchestration layer that coordinates multi-step business processes across Ascend modules. It implements the **saga pattern** — each workflow is a sequence of steps with compensating transactions that run in reverse on failure.

## Architecture

```
src/orchestration/
├── index.ts                    # Bootstrap entry point — call bootstrapOrchestration()
├── types.ts                    # WorkflowContext, WorkflowDefinition, StepDefinition
├── workflow-runner.ts          # Core engine: registers workflows, executes steps, triggers compensations
│
├── workflows/                  # Business process definitions
│   ├── checkout.workflow.ts
│   ├── order-fulfillment.workflow.ts
│   ├── purchasing-receiving.workflow.ts
│   ├── payment-reconciliation.workflow.ts
│   ├── accounting-posting.workflow.ts
│   ├── inventory-transfer.workflow.ts
│   ├── stock-adjustment.workflow.ts
│   ├── refund.workflow.ts
│   ├── returns.workflow.ts
│   └── ecommerce-sync.workflow.ts
│
├── sagas/                      # Long-running cross-event coordinators
├── handlers/                   # CommandBus handlers (one per module)
├── events/                     # EventBus, EventRegistry, EventTypes, DomainEvents
├── commands/                   # CommandBus, CommandRegistry, CommandTypes
├── compensations/              # Standalone compensation functions
├── policies/                   # Business rules: retry, risk, discount, routing, allocation
├── jobs/                       # Background job implementations
├── queues/                     # QueueProducer, QueueConsumer, QueueNames
├── locks/                      # LockManager + per-resource helpers (inventory, order, register)
├── idempotency/                # IdempotencyStore, IdempotencyKey, idempotencyMiddleware
├── telemetry/                  # OrchestrationLogger, OrchestrationMetrics, tracing
├── state/                      # WorkflowStateStore, SagaStateStore, RetryStateStore
└── tests/                      # Workflow unit tests (vitest)
```

## Design Principles

### 1. Workflows own orchestration, not business logic
Business logic (tax calculation, FEFO picking, payment capture) stays in its module. Workflows call modules via events/commands and handle sequencing, compensation, and cross-cutting concerns.

### 2. Saga pattern with compensating transactions
Every workflow step that mutates data must implement `compensate()`. The `CompensationRunner` executes compensations in LIFO order on failure.

### 3. Idempotency everywhere
- Payments: idempotency key checked before any financial mutation
- Accounting: `reference_id + reference_type` uniqueness enforced at DB level
- Webhooks: `ecommerce_product_queue` + `ecommerce_order_queue` deduplicate by external ID
- Jobs: `enqueueOnce()` prevents duplicate job creation

### 4. No silent failures
- All workflow errors surface to `workflow_events` table via `OrchestrationLogger`
- Financial exceptions emit domain events (e.g. `refund.exception`, `payment.reconciliation_exception`)
- Partial compensations log but continue — a partial rollback is better than none

### 5. Module boundary respect
The orchestration layer does **not** own core business tables. It owns:
- `workflow_instances` — workflow lifecycle
- `workflow_steps` — step execution history
- `workflow_events` — event log / audit trail
- `workflow_locks` — distributed locks
- `idempotency_keys` — deduplication store
- `job_queue` — background jobs
- `retry_state` — persistent retry tracking

## Workflows

| Workflow | Trigger | Steps | Compensations |
|---|---|---|---|
| `checkout` | `order.created` | validate → accounting → loyalty → confirm | reverse accounting, reverse loyalty |
| `order_fulfillment` | `payment.captured` | check → pick list → allocate → ship → notify | delete pick list, cancel shipment |
| `purchase_receiving` | `purchase_order.received` | validate PO → AP accounting → vendor balance → report | reverse AP, restore vendor balance |
| `payment_reconciliation` | `payment.reconciliation_started` | fetch batch → match → fees → detect → post → report | — (read-mostly) |
| `accounting_posting` | `accounting.entry_requested` | validate CoA → check balance → post → emit | reverse journal entry |
| `inventory_transfer` | `inventory.transfer_requested` | validate → reserve source → create order → confirm movement | restore source, cancel transfer |
| `stock_adjustment` | `stock.adjustment_requested` | validate reason → permissions → apply → audit → valuation → emit | reverse adjustment, reverse accounting |
| `refund` | `order.refunded` | validate → double-refund guard → payment → inventory → accounting → loyalty → notify → report | mark exception, undo restock |
| `returns` | `customer_return.requested` | validate items → condition → restock → credit → accounting → report | reverse restock, mark credit exception |
| `ecommerce_sync` | `ecommerce.sync_requested` | validate creds → idempotency → catalog deltas → conflict detect → apply → pull orders → import → push inventory → record → emit | mark exception, cancel imports |

## Bootstrap

```typescript
import { bootstrapOrchestration } from "./orchestration/index.js";
import { db } from "./shared/db.js";
import { events } from "./shared/events.js";

const { runner, commandBus, jobConsumer } = bootstrapOrchestration(db, events);
```

## Required Database Tables

The orchestration layer requires these additional tables (add to migrations):

```sql
-- Workflow state
CREATE TABLE workflow_instances (...);
CREATE TABLE workflow_steps (...);
CREATE TABLE workflow_events (...);

-- Infrastructure
CREATE TABLE workflow_locks (lock_key TEXT PRIMARY KEY, holder TEXT, acquired_at BIGINT, expires_at BIGINT);
CREATE TABLE idempotency_keys (key TEXT, tenant_id TEXT, workflow_id TEXT, result TEXT, created_at BIGINT, expires_at BIGINT, PRIMARY KEY (tenant_id, key));
CREATE TABLE job_queue (...);
CREATE TABLE retry_state (operation_key TEXT, tenant_id TEXT, attempt INT, last_error TEXT, next_retry_at BIGINT, exhausted BOOLEAN, PRIMARY KEY (tenant_id, operation_key));

-- Domain tables used by workflows (owned by modules, not orchestration)
-- transfer_orders, inventory_reservations, refunds, customer_returns,
-- ecommerce_integrations, ecommerce_sync_runs, ecommerce_product_queue, ecommerce_order_queue
```
