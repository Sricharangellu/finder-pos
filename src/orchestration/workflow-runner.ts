import type { DB } from "../shared/db.js";
import type { EventBus } from "../shared/events.js";
import type { DomainEvent } from "../shared/types.js";
import type { WorkflowDefinition, WorkflowContext } from "./types.js";
import { WorkflowStateStore } from "./state/workflow-state.store.js";
import { CompensationRunner } from "./compensations/compensation-runner.js";
import { OrchestrationLogger } from "./telemetry/orchestration-logger.js";
import { EventTypes } from "./events/event-types.js";
import { withRetry, DefaultRetryPolicy } from "./policies/retry.policy.js";

/**
 * Core orchestration engine.
 *
 * Responsibilities:
 * 1. Register workflow definitions against the event bus.
 * 2. On trigger: create a WorkflowInstance in Postgres, execute steps sequentially.
 * 3. On step failure: run compensations in reverse (saga pattern).
 * 4. Emit workflow lifecycle events back to the bus so other modules can react.
 */
export class WorkflowRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly definitions: WorkflowDefinition<any>[] = [];
  private readonly stateStore: WorkflowStateStore;
  private readonly compensationRunner: CompensationRunner;
  private readonly logger: OrchestrationLogger;

  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {
    this.stateStore = new WorkflowStateStore(db);
    this.logger = new OrchestrationLogger(db);
    this.compensationRunner = new CompensationRunner(this.stateStore, this.logger, db, events);
  }

  /** Register a workflow definition and subscribe its triggers to the event bus. */
  register<Ctx extends WorkflowContext>(def: WorkflowDefinition<Ctx>): void {
    this.definitions.push(def);
    for (const trigger of def.triggers) {
      this.events.on(trigger, async (event: DomainEvent) => {
        await this.execute(def, event).catch((err) =>
          console.error(`[workflow-runner] ${def.type} failed on ${trigger}:`, err instanceof Error ? err.message : err),
        );
      });
    }
  }

  private async execute<Ctx extends WorkflowContext>(
    def: WorkflowDefinition<Ctx>,
    event: DomainEvent,
  ): Promise<void> {
    const raw = event.payload as Record<string, unknown>;
    const tenantId = (raw["tenantId"] as string | undefined) ?? "";
    if (!tenantId) return; // no tenant context — skip

    const correlationId = (raw["id"] as string | undefined) ?? event.aggregateId ?? `evt_${Date.now()}`;

    // Idempotency: don't start the same workflow twice for the same correlation.
    const existing = await this.stateStore.getByCorrelation(correlationId, def.type, tenantId);
    if (existing && existing.status !== "failed") return;

    let ctx = def.buildContext(raw, tenantId);

    const instance = await this.stateStore.create(def.type, tenantId, raw, correlationId);
    ctx = { ...ctx, workflowId: instance.id };

    await this.stateStore.updateStatus(instance.id, "running");
    await this.logger.log(instance.id, EventTypes.WORKFLOW_STARTED, { type: def.type, trigger: event.type });
    await this.events.publish(EventTypes.WORKFLOW_STARTED, { workflowId: instance.id, type: def.type, tenantId });

    let failedAtIndex = -1;

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      await this.stateStore.updateStatus(instance.id, "running", step.name);
      await this.stateStore.recordStep(instance.id, step.name, "running");
      await this.logger.logStep(instance.id, step.name, "started");

      try {
        ctx = await withRetry(() => step.execute(ctx, this.db, this.events), DefaultRetryPolicy);
        await this.stateStore.recordStep(instance.id, step.name, "completed", null, ctx as unknown as Record<string, unknown>);
        await this.logger.logStep(instance.id, step.name, "completed");
        await this.events.publish(EventTypes.WORKFLOW_STEP_COMPLETED, {
          workflowId: instance.id,
          step: step.name,
          tenantId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.stateStore.recordStep(instance.id, step.name, "failed", null, null, msg);
        await this.logger.logStep(instance.id, step.name, "failed", { error: msg });
        await this.stateStore.updateStatus(instance.id, "failed", step.name);
        await this.events.publish(EventTypes.WORKFLOW_FAILED, { workflowId: instance.id, step: step.name, error: msg, tenantId });

        failedAtIndex = i;
        break;
      }
    }

    if (failedAtIndex >= 0) {
      await this.compensationRunner.run(instance.id, ctx, def.steps, failedAtIndex);
      await this.events.publish(EventTypes.WORKFLOW_COMPENSATED, { workflowId: instance.id, type: def.type, tenantId });
      return;
    }

    await this.stateStore.updateStatus(instance.id, "completed", null, ctx as unknown as Record<string, unknown>);
    await this.logger.log(instance.id, EventTypes.WORKFLOW_COMPLETED, { type: def.type });
    await this.events.publish(EventTypes.WORKFLOW_COMPLETED, { workflowId: instance.id, type: def.type, tenantId });
  }

  /** Directly start a workflow by type without waiting for an event. */
  async start<Ctx extends WorkflowContext>(
    type: string,
    payload: Record<string, unknown>,
    tenantId: string,
  ): Promise<string> {
    const def = this.definitions.find((d) => d.type === type);
    if (!def) throw new Error(`No workflow registered for type '${type}'`);
    const event: DomainEvent = {
      type: `direct.${type}`,
      payload: { ...payload, tenantId },
      aggregateId: `direct_${Date.now()}`,
      occurredAt: new Date().toISOString(),
    };
    await this.execute(def, event);
    const correlationId = (payload["correlationId"] as string | undefined) ?? event.aggregateId!;
    const instance = await this.stateStore.getByCorrelation(correlationId, type, tenantId);
    return instance?.id ?? "";
  }
}
