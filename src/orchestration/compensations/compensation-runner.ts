import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowContext, StepDefinition } from "../types.js";
import type { WorkflowStateStore } from "../state/workflow-state.store.js";
import type { OrchestrationLogger } from "../telemetry/orchestration-logger.js";

/**
 * Runs compensation (rollback) steps in reverse order for failed workflows.
 * Each step that defines `compensate()` is called in LIFO order from the
 * point of failure back to step 0.
 */
export class CompensationRunner {
  constructor(
    private readonly stateStore: WorkflowStateStore,
    private readonly logger: OrchestrationLogger,
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async run<Ctx extends WorkflowContext>(
    workflowId: string,
    ctx: Ctx,
    steps: StepDefinition<Ctx>[],
    failedAtIndex: number,
  ): Promise<void> {
    await this.stateStore.updateStatus(workflowId, "compensating");
    await this.logger.log(workflowId, "compensation.started", { failedAtIndex });

    // Run compensations in reverse, from the step *before* the failed one.
    for (let i = failedAtIndex - 1; i >= 0; i--) {
      const step = steps[i];
      if (!step.compensate) continue;
      try {
        await this.logger.logStep(workflowId, step.name, "compensating");
        await step.compensate(ctx, this.db, this.events);
        await this.stateStore.recordStep(workflowId, step.name, "compensated");
        await this.logger.logStep(workflowId, step.name, "compensated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compensation] step '${step.name}' failed: ${msg}`);
        await this.logger.log(workflowId, "compensation.step_failed", { step: step.name, error: msg });
        // Continue with remaining compensations — partial rollback is better than none.
      }
    }

    await this.stateStore.updateStatus(workflowId, "compensated");
    await this.logger.log(workflowId, "compensation.completed", {});
  }
}
