/**
 * Ascend — Enterprise Orchestration Layer
 *
 * This module wires together all workflows, sagas, handlers, and
 * infrastructure into a single bootstrap function.
 *
 * Usage in src/app.ts or src/server.ts:
 *
 *   import { bootstrapOrchestration } from "./orchestration/index.js";
 *   const runner = bootstrapOrchestration(db, events);
 */

export { WorkflowRunner } from "./workflow-runner.js";
export { ORCHESTRATION_MIGRATIONS } from "./migrations.js";

// Workflows
export { CheckoutWorkflow } from "./workflows/checkout.workflow.js";
export { OrderFulfillmentWorkflow } from "./workflows/order-fulfillment.workflow.js";
export { PurchaseReceivingWorkflow } from "./workflows/purchasing-receiving.workflow.js";
export { PaymentReconciliationWorkflow } from "./workflows/payment-reconciliation.workflow.js";
export { InventoryTransferWorkflow } from "./workflows/inventory-transfer.workflow.js";
export { StockAdjustmentWorkflow } from "./workflows/stock-adjustment.workflow.js";
export { RefundWorkflow } from "./workflows/refund.workflow.js";
export { ReturnsWorkflow } from "./workflows/returns.workflow.js";
export { EcommerceSyncWorkflow } from "./workflows/ecommerce-sync.workflow.js";

// Events
export { EventRegistry } from "./events/event-registry.js";
export { EventTypes } from "./events/event-types.js";
export type { EventType } from "./events/event-types.js";

// Commands
export { CommandBus } from "./commands/command-bus.js";
export { CommandRegistry } from "./commands/command-registry.js";
export { CommandTypes } from "./commands/command-types.js";
export type { Command, CommandType } from "./commands/command-types.js";

// Infrastructure
export { WorkflowStateStore } from "./state/workflow-state.store.js";
export { SagaStateStore } from "./state/saga-state.store.js";
export { RetryStateStore } from "./state/retry-state.store.js";
export { LockManager } from "./locks/lock-manager.js";
export { InventoryLock } from "./locks/inventory-lock.js";
export { OrderLock } from "./locks/order-lock.js";
export { RegisterLock } from "./locks/register-lock.js";
export { IdempotencyStore } from "./idempotency/idempotency-store.js";
export { IdempotencyKey } from "./idempotency/idempotency-key.js";
export { idempotencyMiddleware } from "./idempotency/idempotency-middleware.js";
export { OrchestrationLogger } from "./telemetry/orchestration-logger.js";
export { OrchestrationMetrics, MetricNames } from "./telemetry/orchestration-metrics.js";
export { withSpan, generateTraceId } from "./telemetry/orchestration-tracing.js";
export { CompensationRunner } from "./compensations/compensation-runner.js";
export { QueueProducer, QueueNames as QueueNamesFromProducer } from "./queues/queue-producer.js";
export { QueueConsumer } from "./queues/queue-consumer.js";
export { QueueNames } from "./queues/queue-names.js";
export { withRetry, DefaultRetryPolicy, FinancialRetryPolicy, NoRetryPolicy } from "./policies/retry.policy.js";
export { evaluatePaymentRisk } from "./policies/payment-risk.policy.js";
export { validateDiscount } from "./policies/discount-limit.policy.js";
export { canAllocate } from "./policies/inventory-allocation.policy.js";
export { determineFulfillmentRoute } from "./policies/fulfillment-routing.policy.js";

// Handlers
export { registerCheckoutHandlers } from "./handlers/checkout.handler.js";
export { registerFulfillmentHandlers } from "./handlers/fulfillment.handler.js";
export { registerPurchasingHandlers } from "./handlers/purchasing.handler.js";
export { registerPaymentHandlers } from "./handlers/payment.handler.js";
export { registerInventoryHandlers } from "./handlers/inventory.handler.js";
export { registerAccountingHandlers } from "./handlers/accounting.handler.js";
export { registerEcommerceHandlers } from "./handlers/ecommerce.handler.js";
export { registerStoreHandlers } from "./handlers/store.handler.js";

// Sagas
export { registerCheckoutSaga } from "./sagas/checkout.saga.js";
export { registerFulfillmentSaga } from "./sagas/fulfillment.saga.js";
export { registerPurchasingSaga } from "./sagas/purchasing.saga.js";
export { registerRefundSaga } from "./sagas/refund.saga.js";
export { registerEcommerceSyncSaga } from "./sagas/ecommerce-sync.saga.js";

// Jobs
export { expireReservationsJob } from "./jobs/expire-reservations.job.js";
export { reconcilePaymentsJob } from "./jobs/reconcile-payments.job.js";
export { closeRegisterJob } from "./jobs/close-register.job.js";
export { syncEcommerceJob } from "./jobs/sync-ecommerce.job.js";
export { trialExpiryJob, TRIAL_EXPIRY_INTERVAL_MS } from "./jobs/trial-expiry.job.js";

// Compensations
export { releaseInventoryCompensation } from "./compensations/release-inventory.compensation.js";
export { voidPaymentCompensation } from "./compensations/void-payment.compensation.js";
export { cancelShipmentCompensation } from "./compensations/cancel-shipment.compensation.js";

// Types
export type { WorkflowContext, WorkflowDefinition, StepDefinition, WorkflowInstance, WorkflowStatus } from "./types.js";

import type { DB } from "../shared/db.js";
import type { EventBus } from "../shared/events.js";
import { WorkflowRunner } from "./workflow-runner.js";
import { CheckoutWorkflow } from "./workflows/checkout.workflow.js";
import { OrderFulfillmentWorkflow } from "./workflows/order-fulfillment.workflow.js";
import { PurchaseReceivingWorkflow } from "./workflows/purchasing-receiving.workflow.js";
import { PaymentReconciliationWorkflow } from "./workflows/payment-reconciliation.workflow.js";
import { InventoryTransferWorkflow } from "./workflows/inventory-transfer.workflow.js";
import { StockAdjustmentWorkflow } from "./workflows/stock-adjustment.workflow.js";
import { RefundWorkflow } from "./workflows/refund.workflow.js";
import { ReturnsWorkflow } from "./workflows/returns.workflow.js";
import { EcommerceSyncWorkflow } from "./workflows/ecommerce-sync.workflow.js";
import { CommandBus } from "./commands/command-bus.js";
import { CommandRegistry } from "./commands/command-registry.js";
import { EventRegistry } from "./events/event-registry.js";
import { registerCheckoutHandlers } from "./handlers/checkout.handler.js";
import { registerFulfillmentHandlers } from "./handlers/fulfillment.handler.js";
import { registerPurchasingHandlers } from "./handlers/purchasing.handler.js";
import { registerPaymentHandlers } from "./handlers/payment.handler.js";
import { registerInventoryHandlers } from "./handlers/inventory.handler.js";
import { registerAccountingHandlers } from "./handlers/accounting.handler.js";
import { registerEcommerceHandlers } from "./handlers/ecommerce.handler.js";
import { registerStoreHandlers } from "./handlers/store.handler.js";
import { registerCheckoutSaga } from "./sagas/checkout.saga.js";
import { registerFulfillmentSaga } from "./sagas/fulfillment.saga.js";
import { registerPurchasingSaga } from "./sagas/purchasing.saga.js";
import { registerRefundSaga } from "./sagas/refund.saga.js";
import { registerEcommerceSyncSaga } from "./sagas/ecommerce-sync.saga.js";
import { QueueConsumer } from "./queues/queue-consumer.js";
import { QueueProducer } from "./queues/queue-producer.js";
import { QueueNames } from "./queues/queue-names.js";
import { expireReservationsJob } from "./jobs/expire-reservations.job.js";
import { reconcilePaymentsJob } from "./jobs/reconcile-payments.job.js";
import { closeRegisterJob } from "./jobs/close-register.job.js";
import { syncEcommerceJob } from "./jobs/sync-ecommerce.job.js";
import { arDunningJob } from "./jobs/ar-dunning.job.js";
import { idempotencyExpiryJob, IDEMPOTENCY_EXPIRY_INTERVAL_MS } from "./jobs/idempotency-expiry.job.js";
import { outboxRetentionJob, OUTBOX_RETENTION_INTERVAL_MS } from "./jobs/outbox-retention.job.js";
import { trialExpiryJob, TRIAL_EXPIRY_INTERVAL_MS } from "./jobs/trial-expiry.job.js";

export interface OrchestrationBootstrap {
  runner: WorkflowRunner;
  commandBus: CommandBus;
  eventRegistry: EventRegistry;
  commandRegistry: CommandRegistry;
  jobConsumer: QueueConsumer;
}

/**
 * Bootstrap the entire orchestration layer.
 * Call this once at application startup after the DB connection is ready.
 */
export function bootstrapOrchestration(db: DB, events: EventBus): OrchestrationBootstrap {
  // ── 1. Workflow Runner ──────────────────────────────────────────────────────
  const runner = new WorkflowRunner(db, events);

  // ── 2. Register all workflows ───────────────────────────────────────────────
  // NOTE: the double-entry ledger is posted by the accounting MODULE's event
  // handlers (payment.captured, bill.*, purchase_order.received, order.refunded)
  // writing the canonical journal_entries schema — NOT by a workflow. The former
  // AccountingPostingWorkflow (trigger accounting.entry_requested) was retired:
  // it wrote a journal_entries(reference_id)/journal_entry_lines schema no
  // migration ever created, so every posting threw and was swallowed. See
  // WORK/audits/AUDIT_2026-07-18T024400Z-accounting-posting-drift.md.
  runner.register(CheckoutWorkflow);
  runner.register(OrderFulfillmentWorkflow);
  runner.register(PurchaseReceivingWorkflow);
  runner.register(PaymentReconciliationWorkflow);
  runner.register(InventoryTransferWorkflow);
  runner.register(StockAdjustmentWorkflow);
  runner.register(RefundWorkflow);
  runner.register(ReturnsWorkflow);
  runner.register(EcommerceSyncWorkflow);

  // ── 3. Event Registry ──────────────────────────────────────────────────────
  const eventRegistry = new EventRegistry(events);

  // ── 4. Command Bus + Registry ──────────────────────────────────────────────
  const commandBus = new CommandBus();
  const commandRegistry = new CommandRegistry(commandBus);

  registerCheckoutHandlers(commandBus, db, events);
  registerFulfillmentHandlers(commandBus, db, events);
  registerPurchasingHandlers(commandBus, db, events);
  registerPaymentHandlers(commandBus, db, events);
  registerInventoryHandlers(commandBus, db, events);
  registerAccountingHandlers(commandBus, db, events);
  registerEcommerceHandlers(commandBus, db, events);
  registerStoreHandlers(commandBus, db, events);

  // Audit: log any unregistered commands at startup.
  commandRegistry.syncFromBus();
  commandRegistry.audit();

  // ── 5. Sagas ───────────────────────────────────────────────────────────────
  registerCheckoutSaga(runner, events);
  registerFulfillmentSaga(events);
  registerPurchasingSaga(events);
  registerRefundSaga(events);
  registerEcommerceSyncSaga(events);

  // ── 6. Job Consumer ────────────────────────────────────────────────────────
  const jobConsumer = new QueueConsumer(db);
  const jobProducer = new QueueProducer(db);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const backgroundJobsEnabled =
    process.env["NODE_ENV"] !== "test" &&
    process.env["FINDER_BACKGROUND_JOBS"] !== "false";

  jobConsumer.register(QueueNames.EXPIRE_RESERVATIONS, async (job) => {
    await expireReservationsJob(job, db, events);
  });
  jobConsumer.register(QueueNames.PAYMENT_RECONCILIATION, async (job) => {
    await reconcilePaymentsJob(job, db, events);
  });
  jobConsumer.register(QueueNames.CLOSE_REGISTER, async (job) => {
    await closeRegisterJob(job, db, events);
  });
  jobConsumer.register(QueueNames.ECOMMERCE_SYNC, async (job) => {
    await syncEcommerceJob(job, db, events);
  });

  // INF-6: AR dunning — runs once per tenant per day. The handler re-enqueues
  // itself 24 h in the future so the sweep perpetuates without a cron daemon.
  jobConsumer.register(QueueNames.AR_DUNNING, async (job) => {
    const payload = JSON.parse(job.payload) as { tenantId?: string };
    const tenantId = payload.tenantId ?? job.tenant_id;
    await arDunningJob(job, db, events);
    // Re-schedule for tomorrow — idempotent (skips if one is already pending).
    await jobProducer.enqueueOnce({
      type: QueueNames.AR_DUNNING,
      tenantId,
      payload: { tenantId },
      runAt: Date.now() + DAY_MS,
      maxAttempts: 3,
    });
  });

  // Seed dunning jobs for every active tenant on startup (once per tenant;
  // enqueueOnce is a no-op if a pending job already exists).
  if (backgroundJobsEnabled) {
    void (async () => {
      try {
        const tenants = await db.query<{ id: string }>("SELECT id FROM tenants");
        for (const t of tenants) {
          await jobProducer.enqueueOnce({
            type: QueueNames.AR_DUNNING,
            tenantId: t.id,
            payload: { tenantId: t.id },
            runAt: Date.now(), // run immediately on first boot
            maxAttempts: 3,
          });
        }
      } catch {
        // Non-fatal — dunning jobs will be seeded on next startup or manual trigger.
      }
    })();
  }

  // DB-10: Idempotency key expiry — global job (not per-tenant), runs every 6h.
  jobConsumer.register(QueueNames.IDEMPOTENCY_EXPIRY, async (job) => {
    await idempotencyExpiryJob(job, db);
    await jobProducer.enqueueOnce({
      type: QueueNames.IDEMPOTENCY_EXPIRY,
      tenantId: "system",
      payload: {},
      runAt: Date.now() + IDEMPOTENCY_EXPIRY_INTERVAL_MS,
      maxAttempts: 3,
    });
  });
  // Seed on first startup.
  if (backgroundJobsEnabled) {
    void jobProducer.enqueueOnce({
      type: QueueNames.IDEMPOTENCY_EXPIRY,
      tenantId: "system",
      payload: {},
      runAt: Date.now(),
      maxAttempts: 3,
    }).catch(() => {});
  }

  // ACPA M1.4: daily retention sweep — purges delivered event_outbox rows and
  // event_consumptions claims past the 30-day window.
  jobConsumer.register(QueueNames.OUTBOX_RETENTION, async (job) => {
    await outboxRetentionJob(job, db);
    await jobProducer.enqueueOnce({
      type: QueueNames.OUTBOX_RETENTION,
      tenantId: "system",
      payload: {},
      runAt: Date.now() + OUTBOX_RETENTION_INTERVAL_MS,
      maxAttempts: 3,
    });
  });
  if (backgroundJobsEnabled) {
    void jobProducer.enqueueOnce({
      type: QueueNames.OUTBOX_RETENTION,
      tenantId: "system",
      payload: {},
      runAt: Date.now(),
      maxAttempts: 3,
    }).catch(() => {});
  }

  // DEMO-1: Trial lifecycle — global job (not per-tenant), runs once a day.
  // Nurture emails at day 7 / day 13 of a trial, then soft-expires tenants
  // whose trial_ends_at has passed without converting to a paid plan.
  jobConsumer.register(QueueNames.TRIAL_EXPIRY, async (job) => {
    await trialExpiryJob(job, db);
    // Re-schedule for tomorrow — idempotent (skips if one is already pending).
    await jobProducer.enqueueOnce({
      type: QueueNames.TRIAL_EXPIRY,
      tenantId: "system",
      payload: {},
      runAt: Date.now() + TRIAL_EXPIRY_INTERVAL_MS,
      maxAttempts: 3,
    });
  });
  // Seed on first startup.
  if (backgroundJobsEnabled) {
    void jobProducer.enqueueOnce({
      type: QueueNames.TRIAL_EXPIRY,
      tenantId: "system",
      payload: {},
      runAt: Date.now(),
      maxAttempts: 3,
    }).catch(() => {});
  }

  // ACPA M1.2: the DB-8 outbox relay is retired. It republished
  // dispatched=FALSE event_outbox rows to ALL bus subscribers — a
  // double-dispatch hazard for non-idempotent consumers — and has had no
  // producers since M1 (rows are written dispatched=TRUE with a status state
  // machine; the shared Outbox reconciler owns redelivery). Purge the
  // self-re-enqueueing relay jobs left behind by older deploys so they don't
  // park as "No handler registered" failures.
  if (backgroundJobsEnabled) {
    void db.query("DELETE FROM job_queue WHERE type = 'outbox_relay'").catch(() => {});
  }

  // Start polling background jobs.
  if (backgroundJobsEnabled) {
    jobConsumer.start(10_000); // poll every 10 seconds
  }

  return { runner, commandBus, eventRegistry, commandRegistry, jobConsumer };
}
