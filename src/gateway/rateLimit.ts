import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../shared/http.js";
import type { RedisClient } from "../shared/redis.js";

/**
 * Extract the real client IP safely.
 *
 * In production behind Vercel/Cloudflare, the true client IP is the LAST
 * IP added by our trusted proxy (rightmost), not the first (which an attacker
 * controls). Using the first IP allows X-Forwarded-For spoofing to bypass
 * per-IP rate limits.
 *
 * TRUST_PROXY_DEPTH env var (default 1): how many proxy hops to strip from
 * the right of the XFF header before taking the client IP. Set to 2 if your
 * traffic passes through two proxy layers (e.g., Cloudflare → Vercel).
 */
function extractClientIp(req: Request): string {
  const depth = Number(process.env["TRUST_PROXY_DEPTH"] ?? 1);
  const xff = req.headers["x-forwarded-for"] as string | undefined;
  if (xff) {
    const ips = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // The rightmost `depth` entries are added by our own proxies.
    // The entry just before those is the real client IP.
    const clientIndex = ips.length - depth - 1;
    if (clientIndex >= 0 && ips[clientIndex]) return ips[clientIndex]!;
    // Fewer hops than expected — fall back to leftmost (safest fallback).
    return ips[0] ?? req.socket.remoteAddress ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

// Lua: atomic rolling-window counter backed by a sorted set.
// Returns 1 if the request is allowed, 0 if rate-limited.
const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window_ms)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  redis.call('PEXPIRE', KEYS[1], window_ms)
  return 0
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], window_ms)
return 1
`;

/**
 * Simple in-memory token-bucket rate limiter.
 *
 * Each unique key (IP address by default, or tenant_id once auth runs)
 * gets a bucket that refills at `refillRate` tokens/second with a
 * maximum of `capacity` tokens. Each request costs 1 token.
 *
 * This is intentionally lightweight for Wave 0. Wave 2 upgrades to
 * Redis-backed sliding-window counters with per-tenant tier limits.
 */
export interface RateLimitOptions {
  /** Max tokens in the bucket (burst allowance). Default: 60. */
  capacity?: number;
  /** Tokens added per second (sustained RPS). Default: 20. */
  refillRate?: number;
  /** Key extractor function. Default: IP address. */
  keyFn?: (req: Request) => string;
  /**
   * When provided, uses Redis for distributed state (shared across all
   * instances). Falls back to in-memory token bucket when null/undefined.
   */
  redis?: RedisClient | null;
  /** Rolling-window duration for the Redis path. Default: 60_000 ms. */
  windowMs?: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * `?? fallback` only catches null/undefined — a caller building options from
 * `Number(process.env["X"] ?? default)` (several call sites in src/app.ts do
 * exactly this for CI/tier overrides) silently produces NaN on a malformed
 * env var, and NaN is neither null nor undefined, so `??` lets it through.
 * Every downstream comparison against NaN (`tokens < 1`, `Math.min(NaN, ...)`)
 * evaluates false/NaN, which fail-OPEN — a typo'd override would silently
 * disable a brute-force limiter instead of erroring. Enforced once here, at
 * the single point every caller funnels through, rather than duplicated at
 * each call site (and safe against call sites added later too).
 */
function safeNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const capacity = safeNumber(options.capacity, 60);
  const refillRate = safeNumber(options.refillRate, 20); // tokens/sec
  const windowMs = safeNumber(options.windowMs, 60_000);
  const keyFn = options.keyFn ?? ((req: Request) => {
    return extractClientIp(req);
  });
  const redis = options.redis ?? null;
  const allowedFromRedis = (result: unknown) => result === 1 || result === "1";

  // ── Redis path ──────────────────────────────────────────────────────────────
  if (redis) {
    return function rateLimit(req: Request, res: Response, next: NextFunction): void {
      const now = Date.now();
      const key = `rl:${keyFn(req)}`;
      const member = `${now}:${Math.random().toString(36).slice(2)}`;
      redis
        .eval(SLIDING_WINDOW_SCRIPT, 1, key, String(now), String(windowMs), String(capacity), member)
        .then((allowed) => {
          if (!allowedFromRedis(allowed)) {
            res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
            next(new HttpError(429, "rate_limit_exceeded", "Too many requests — slow down."));
          } else {
            next();
          }
        })
        .catch(() => next()); // on Redis error, allow through (fail open)
    };
  }

  // ── In-memory path (dev / no Redis) ────────────────────────────────────────
  const buckets = new Map<string, Bucket>();
  const purgeIntervalMs = 60_000;
  let lastPurgeMs = Date.now();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    if (now - lastPurgeMs > purgeIntervalMs) {
      for (const [key, bucket] of buckets) {
        const idleSec = (now - bucket.lastRefillMs) / 1000;
        if (bucket.tokens >= capacity && idleSec > 300) {
          buckets.delete(key);
        }
      }
      lastPurgeMs = now;
    }

    const key = keyFn(req);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillMs: now };
      buckets.set(key, bucket);
    }

    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillRate);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      const retryAfterSec = Math.ceil((1 - bucket.tokens) / refillRate);
      res.setHeader("Retry-After", String(retryAfterSec));
      next(new HttpError(429, "rate_limit_exceeded", "Too many requests — slow down."));
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}

// ── Per-tenant tiered rate limiting (Wave 2) ────────────────────────────────

export interface TierLimit {
  /** Burst capacity (max tokens). */
  capacity: number;
  /** Sustained tokens/second. */
  refillRate: number;
}

/** Subscription tiers → sustained RPS + burst. Applied per tenant. */
export const RATE_TIERS: Record<string, TierLimit> = {
  standard: { capacity: 60, refillRate: 10 }, // ~600 req/min sustained
  premium: { capacity: 200, refillRate: 50 }, // ~3k req/min
  enterprise: { capacity: 600, refillRate: 200 }, // ~12k req/min
};

export interface TenantRateLimitOptions {
  /** Tier table (defaults to RATE_TIERS). Override for tests. */
  tiers?: Record<string, TierLimit>;
  /** Resolve a tenant's tier. Defaults to "standard" (no tier column yet). */
  tierOf?: (tenantId: string) => string;
  /** Key when there is no authenticated tenant (defaults to client IP). */
  fallbackKey?: (req: Request) => string;
  /** When provided, uses Redis for distributed state across instances. */
  redis?: RedisClient | null;
  /** Rolling-window duration for the Redis path. Default: 60_000 ms. */
  windowMs?: number;
}

/**
 * Per-tenant tiered limiter. Must run AFTER authMiddleware so the tenant is
 * known (keys by `res.locals.auth.tenantId`). Each tenant gets an isolated
 * bucket sized by its tier, so one tenant's traffic can't starve another's.
 */
export function tenantRateLimitMiddleware(options: TenantRateLimitOptions = {}) {
  const tiers = options.tiers ?? RATE_TIERS;
  const tierOf = options.tierOf ?? (() => "standard");
  const windowMs = options.windowMs ?? 60_000;
  const redis = options.redis ?? null;
  const fallbackKey =
    options.fallbackKey ??
    ((req: Request) =>
      "ip:" + extractClientIp(req));
  const allowedFromRedis = (result: unknown) => result === 1 || result === "1";

  // ── Redis path ──────────────────────────────────────────────────────────────
  if (redis) {
    return function tenantRateLimit(req: Request, res: Response, next: NextFunction): void {
      const auth = res.locals["auth"] as { tenantId?: string } | undefined;
      const tenantId = auth?.tenantId;
      const tierName = tenantId ? tierOf(tenantId) : "standard";
      const cfg = tiers[tierName] ?? tiers["standard"] ?? RATE_TIERS["standard"]!;
      const now = Date.now();
      const key = `trl:${tenantId ?? fallbackKey(req)}`;
      const member = `${now}:${Math.random().toString(36).slice(2)}`;

      res.setHeader("X-RateLimit-Tier", tierName);
      res.setHeader("X-RateLimit-Limit", String(cfg.capacity));

      redis
        .eval(SLIDING_WINDOW_SCRIPT, 1, key, String(now), String(windowMs), String(cfg.capacity), member)
        .then((allowed) => {
          if (!allowedFromRedis(allowed)) {
            res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
            next(new HttpError(429, "rate_limit_exceeded", "Tenant rate limit exceeded — slow down."));
          } else {
            next();
          }
        })
        .catch(() => next()); // on Redis error, allow through (fail open)
    };
  }

  // ── In-memory path (dev / no Redis) ────────────────────────────────────────
  const buckets = new Map<string, Bucket>();
  let lastPurgeMs = Date.now();

  return function tenantRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    if (now - lastPurgeMs > 60_000) {
      for (const [k, b] of buckets) {
        if ((now - b.lastRefillMs) / 1000 > 300) buckets.delete(k);
      }
      lastPurgeMs = now;
    }

    const auth = res.locals["auth"] as { tenantId?: string } | undefined;
    const tenantId = auth?.tenantId;
    const key = tenantId ? `t:${tenantId}` : fallbackKey(req);
    const tierName = tenantId ? tierOf(tenantId) : "standard";
    const cfg = tiers[tierName] ?? tiers["standard"] ?? RATE_TIERS["standard"]!;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: cfg.capacity, lastRefillMs: now };
      buckets.set(key, bucket);
    }
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillRate);
    bucket.lastRefillMs = now;

    res.setHeader("X-RateLimit-Tier", tierName);
    res.setHeader("X-RateLimit-Limit", String(cfg.capacity));

    if (bucket.tokens < 1) {
      res.setHeader("Retry-After", String(Math.ceil((1 - bucket.tokens) / cfg.refillRate)));
      next(new HttpError(429, "rate_limit_exceeded", "Tenant rate limit exceeded — slow down."));
      return;
    }
    bucket.tokens -= 1;
    res.setHeader("X-RateLimit-Remaining", String(Math.floor(bucket.tokens)));
    next();
  };
}
