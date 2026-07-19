import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { rateLimitMiddleware, tenantRateLimitMiddleware, RATE_TIERS } from "./rateLimit.js";
import type { RedisClient } from "../shared/redis.js";

// Minimal fake req/res to drive the middleware without HTTP.
function fakeReq(): Request {
  return { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
}
function fakeRes(tenantId?: string): Response {
  const headers: Record<string, string> = {};
  return {
    locals: tenantId ? { auth: { tenantId } } : {},
    setHeader: (k: string, v: string) => { headers[k] = v; },
    getHeader: (k: string) => headers[k],
  } as unknown as Response;
}

class SlidingWindowRedis implements RedisClient {
  readonly keys: string[] = [];
  private readonly hits = new Map<string, Array<{ score: number; member: string }>>();

  async eval(_script: string, _numkeys: number, key: string, nowRaw: string, windowRaw: string, limitRaw: string, member: string): Promise<number> {
    this.keys.push(key);
    const now = Number(nowRaw);
    const windowMs = Number(windowRaw);
    const limit = Number(limitRaw);
    const hits = (this.hits.get(key) ?? []).filter((hit) => hit.score > now - windowMs);
    if (hits.length >= limit) {
      this.hits.set(key, hits);
      return 0;
    }
    hits.push({ score: now, member });
    this.hits.set(key, hits);
    return 1;
  }

  async quit(): Promise<string> {
    return "OK";
  }
}

/** Drive N requests through the middleware; return how many were allowed. */
function hit(mw: ReturnType<typeof tenantRateLimitMiddleware>, res: Response, n: number): number {
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    let err: unknown = null;
    mw(fakeReq(), res, (e?: unknown) => { err = e; });
    if (!err) allowed++;
  }
  return allowed;
}

function invoke(mw: ReturnType<typeof rateLimitMiddleware> | ReturnType<typeof tenantRateLimitMiddleware>, req: Request, res: Response): Promise<unknown> {
  return new Promise((resolve) => {
    mw(req, res, ((err?: unknown) => resolve(err ?? null)) as NextFunction);
  });
}

test("tenant limiter allows up to tier capacity then 429s", () => {
  const tiers = { standard: { capacity: 5, refillRate: 0 } }; // no refill within the test window
  const mw = tenantRateLimitMiddleware({ tiers });
  const res = fakeRes("tnt_a");
  const allowed = hit(mw, res, 8);
  assert.equal(allowed, 5, "exactly capacity requests allowed");
  assert.equal(res.getHeader("X-RateLimit-Tier"), "standard");
});

test("buckets are isolated per tenant", () => {
  const tiers = { standard: { capacity: 3, refillRate: 0 } };
  const mw = tenantRateLimitMiddleware({ tiers });
  const a = hit(mw, fakeRes("tnt_a"), 5); // a exhausts at 3
  const b = hit(mw, fakeRes("tnt_b"), 2); // b is independent
  assert.equal(a, 3);
  assert.equal(b, 2, "second tenant unaffected by the first's usage");
});

test("tierOf selects a higher tier with a larger budget", () => {
  const mw = tenantRateLimitMiddleware({
    tiers: { standard: { capacity: 2, refillRate: 0 }, enterprise: { capacity: 10, refillRate: 0 } },
    tierOf: (t) => (t === "tnt_big" ? "enterprise" : "standard"),
  });
  assert.equal(hit(mw, fakeRes("tnt_small"), 5), 2);
  assert.equal(hit(mw, fakeRes("tnt_big"), 5), 5);
});

test("RATE_TIERS exposes standard/premium/enterprise ascending", () => {
  assert.ok(RATE_TIERS.standard.capacity < RATE_TIERS.premium.capacity);
  assert.ok(RATE_TIERS.premium.capacity < RATE_TIERS.enterprise.capacity);
});

test("Redis IP limiter uses a rolling window instead of fixed window buckets", async () => {
  const redis = new SlidingWindowRedis();
  const mw = rateLimitMiddleware({
    capacity: 2,
    windowMs: 1_000,
    redis,
    keyFn: () => "client-a",
  });
  const realNow = Date.now;
  try {
    Date.now = () => 990;
    assert.equal(await invoke(mw, fakeReq(), fakeRes()), null);
    assert.equal(await invoke(mw, fakeReq(), fakeRes()), null);

    Date.now = () => 1_010;
    const err = await invoke(mw, fakeReq(), fakeRes());
    assert.ok(err instanceof Error, "third request across a fixed boundary is still denied");

    Date.now = () => 1_991;
    assert.equal(await invoke(mw, fakeReq(), fakeRes()), null, "request is allowed after the rolling window expires");
    assert.deepEqual(new Set(redis.keys), new Set(["rl:client-a"]), "Redis key has no fixed-window timestamp suffix");
  } finally {
    Date.now = realNow;
  }
});

test("Redis tenant limiter uses a rolling window per tenant", async () => {
  const redis = new SlidingWindowRedis();
  const mw = tenantRateLimitMiddleware({
    tiers: { standard: { capacity: 2, refillRate: 0 } },
    windowMs: 1_000,
    redis,
  });
  const realNow = Date.now;
  try {
    Date.now = () => 990;
    assert.equal(await invoke(mw, fakeReq(), fakeRes("tnt_a")), null);
    assert.equal(await invoke(mw, fakeReq(), fakeRes("tnt_a")), null);
    assert.equal(await invoke(mw, fakeReq(), fakeRes("tnt_b")), null, "second tenant has an isolated Redis bucket");

    Date.now = () => 1_010;
    const err = await invoke(mw, fakeReq(), fakeRes("tnt_a"));
    assert.ok(err instanceof Error, "tenant cannot double-dip at the fixed-window boundary");
    assert.deepEqual(new Set(redis.keys), new Set(["trl:tnt_a", "trl:tnt_b"]), "tenant Redis keys have no fixed-window timestamp suffix");
  } finally {
    Date.now = realNow;
  }
});

test("a malformed numeric override (NaN) falls back to the safe default instead of disabling the limiter", async () => {
  // Mirrors how src/app.ts builds options from env vars: Number(process.env["X"] ?? default).
  // A typo'd override (e.g. IDENTITY_RATE_LIMIT_CAPACITY="abc") produces NaN here, and NaN is
  // neither null nor undefined, so a naive `options.capacity ?? 60` would let it through —
  // every downstream comparison against NaN is false, which fails OPEN (unlimited requests).
  const mw = rateLimitMiddleware({ capacity: Number("not-a-number"), refillRate: Number("also-not-a-number") });
  const res = fakeRes();
  let allowed = 0;
  for (let i = 0; i < 65; i++) {
    const err = await invoke(mw, fakeReq(), res);
    if (!err) allowed++;
  }
  assert.equal(allowed, 60, "NaN capacity enforces the documented default (60), not unlimited");
});
