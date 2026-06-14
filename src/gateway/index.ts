/**
 * Gateway seam — all cross-cutting middleware for the Finder POS modular monolith.
 *
 * Mounting order in app.ts:
 *   1. requestIdMiddleware       — assign requestId + W3C traceparent
 *   2. metricsMiddleware         — RED metrics per route (exposed at /metrics)
 *   3. rateLimitMiddleware()     — token-bucket per IP (Wave 0: simple, Wave 2: Redis+tiers)
 *   4. authMiddleware            — verify JWT, populate res.locals.auth
 *   5. tenantResolver            — record tenant context (DB SET LOCAL happens in service layer)
 *   --- your route handlers ---
 *   6. errorEnvelopeMiddleware   — { error: { code, message, requestId } } envelope
 */
export { requestIdMiddleware } from "./requestId.js";
export { rateLimitMiddleware, tenantRateLimitMiddleware, RATE_TIERS } from "./rateLimit.js";
export type { TierLimit, TenantRateLimitOptions } from "./rateLimit.js";
export { authMiddleware, tenantResolver, requireRole } from "./auth.js";
export { errorEnvelopeMiddleware } from "./errorEnvelope.js";
export { metricsMiddleware, renderMetrics, recordRequest, normalizePath, resetMetrics } from "./metrics.js";
export type { AuthPayload } from "./auth.js";
