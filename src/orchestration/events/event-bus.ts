/**
 * Orchestration-layer re-export of the shared EventBus.
 * The orchestration layer imports from here so internal consumers
 * don't need to know where the implementation lives.
 */
export { EventBus } from "../../shared/events.js";
