import { Redis } from "ioredis";
import { logger } from "./logger.js";

export type { Redis };

/**
 * Minimal interface that our rate-limit store needs from a Redis client.
 * Keeps the gateway layer decoupled from the full ioredis API.
 */
export interface RedisClient {
  eval(script: string, numkeys: number, ...rest: string[]): Promise<unknown>;
  quit(): Promise<string>;
}

/**
 * Open a Redis connection from REDIS_URL (or the supplied url).
 * Returns null when no URL is configured so callers can fall back to
 * in-memory implementations — keeps dev/test zero-config.
 *
 * Returns the full ioredis Redis type (superset of RedisClient) so callers
 * that need Pub/Sub (EventBus bridge) can use publish() and duplicate().
 */
export function openRedis(url?: string): Redis | null {
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) return null;

  const client = new Redis(redisUrl, {
    lazyConnect: false,
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
  });

  client.on("error", (err) => {
    // Non-fatal — rate limiting and event fan-out degrade gracefully without Redis.
    logger.error({ err: (err as Error).message }, "[redis] connection error");
  });

  return client;
}
