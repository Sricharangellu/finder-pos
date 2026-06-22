import pino from "pino";

const isDev = process.env["NODE_ENV"] !== "production";

/**
 * Structured logger for the FinderPOS backend.
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
