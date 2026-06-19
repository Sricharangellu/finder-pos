/**
 * Orchestration Tracing
 *
 * Lightweight structured tracing for workflow executions.
 * In Year 1 this writes to the workflow_events table (already available
 * via OrchestrationLogger). In Year 2 it exports OTLP spans.
 *
 * Each "span" is a named unit of work with a start time, end time,
 * and structured attributes.
 */

export interface Span {
  traceId: string;
  spanId: string;
  name: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
  error?: string;
}

let traceCounter = 0;

export function generateTraceId(): string {
  return `tr_${Date.now()}_${++traceCounter}`;
}

export function generateSpanId(): string {
  return `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SpanContext {
  readonly span: Span;

  constructor(
    name: string,
    traceId: string,
    attributes: Record<string, unknown> = {},
  ) {
    this.span = {
      traceId,
      spanId: generateSpanId(),
      name,
      startMs: Date.now(),
      attributes,
      status: "ok",
    };
  }

  setAttribute(key: string, value: unknown): void {
    this.span.attributes[key] = value;
  }

  end(error?: Error): void {
    this.span.endMs = Date.now();
    this.span.durationMs = this.span.endMs - this.span.startMs;
    if (error) {
      this.span.status = "error";
      this.span.error = error.message;
    }
  }

  toLog(): Record<string, unknown> {
    return {
      trace_id: this.span.traceId,
      span_id: this.span.spanId,
      name: this.span.name,
      duration_ms: this.span.durationMs,
      status: this.span.status,
      error: this.span.error,
      ...this.span.attributes,
    };
  }
}

/**
 * Execute fn within a traced span. Automatically ends the span on completion.
 */
export async function withSpan<T>(
  name: string,
  traceId: string,
  attributes: Record<string, unknown>,
  fn: (span: SpanContext) => Promise<T>,
): Promise<T> {
  const span = new SpanContext(name, traceId, attributes);
  try {
    const result = await fn(span);
    span.end();
    return result;
  } catch (err) {
    span.end(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
