import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

let _redis: Redis | null = null;
let _ratelimiter: Ratelimit | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN"
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

/**
 * Rate limiter for the /api/ask endpoint.
 * 10 requests per minute per IP.
 */
function getAskRatelimiter(): Ratelimit {
  if (!_ratelimiter) {
    _ratelimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      analytics: true,
      prefix: "pghackers:ratelimit:ask",
    });
  }
  return _ratelimiter;
}

export function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous"
  );
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Check rate limit for the /api/ask endpoint.
 * Returns { success: false } if the limit has been exceeded.
 */
export async function checkAskRateLimit(
  req: NextRequest
): Promise<RateLimitResult> {
  try {
    const ratelimiter = getAskRatelimiter();
    const ip = getClientIP(req);
    const { success, limit, remaining, reset } = await ratelimiter.limit(ip);
    return { success, limit, remaining, reset };
  } catch (error) {
    // If Redis is unavailable, allow the request
    console.error("[RateLimit] Redis unavailable, allowing request:", error);
    return { success: true, limit: 10, remaining: 10, reset: Date.now() };
  }
}

/**
 * Generic cache helper — get a cached value by key.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis();
    const value = await redis.get<T>(key);
    return value;
  } catch {
    return null;
  }
}

/**
 * Generic cache helper — set a value with TTL (seconds).
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds = 300
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // Ignore cache write failures — cache is best-effort
  }
}
