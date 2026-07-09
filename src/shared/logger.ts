import pino from "pino";

const isDev = process.env["NODE_ENV"] !== "production";

/**
 * Structured logger for the Ascend backend.
 *
 * In development: outputs human-readable text (no pino-pretty required —
 * pipe output through `npx pino-pretty` locally if desired).
 * In production: outputs newline-delimited JSON for log aggregators
 * (Datadog, Loki, CloudWatch, etc.).
 *
 * Usage:
 *   logger.info({ orderId, amountCents }, "payment captured");
 *   logger.error({ err }, "database query failed");
 *   const child = logger.child({ module: "billing" });
 */
export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info"),
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout, plain JSON in dev too
        },
      }
    : {}),
});

/** Create a child logger bound to a specific module name. */
export function moduleLogger(name: string): pino.Logger {
  return logger.child({ module: name });
}

/**
 * DB-17: OpenTelemetry-compatible trace context logger.
 *
 * Creates a child logger that includes W3C trace context fields
 * (trace_id, span_id) for correlation with Datadog/Jaeger/CloudWatch.
 *
 * The trace context is extracted from the Express request via requestIdMiddleware
 * which sets res.locals.traceId and res.locals.spanId.
 *
 * This is a lightweight OTEL-compatible foundation that works with any
 * log aggregator without requiring @opentelemetry/sdk-node (deferred to
 * when a specific APM vendor is chosen).
 */
export function requestLogger(traceId: string, spanId: string, path?: string): pino.Logger {
  return logger.child({
    // W3C trace context — parseable by Datadog APM, Jaeger, etc.
    "trace_id": traceId,
    "span_id": spanId,
    // OTEL resource attributes
    ...(path ? { "http.target": path } : {}),
  });
}
