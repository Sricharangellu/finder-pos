import type { Cents } from "./money.js";

/** US state codes supported by the tax engine in Year 1. */
export type StateCode = "CA" | "NY" | "TX" | "FL";

/** Immutable domain event. Every state change in the platform emits one. */
export interface DomainEvent<T = unknown> {
  /** Stable event identity (ACPA M1.3): assigned once by EventBus.publish and
   *  preserved verbatim on outbox redelivery, so consumers can use it as an
   *  idempotency key. Optional only for hand-built events in older code paths. */
  id?: string;
  /** e.g. "order.created", "payment.captured", "inventory.adjusted" */
  type: string;
  /** ISO timestamp — identical across sync dispatch and outbox redelivery */
  occurredAt: string;
  /** event-specific payload */
  payload: T;
  /** optional aggregate id the event concerns */
  aggregateId?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type { Cents };
