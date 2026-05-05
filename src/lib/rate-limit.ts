/**
 * In-memory rate limiter.
 * For production scale, swap the Map for Redis with INCR + EXPIRE.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const MAX_MESSAGES = parseInt(
  process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || "30",
  10,
);

export function checkRateLimit(
  key: string,
  limit = MAX_MESSAGES,
  windowMs = WINDOW_MS,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

// Prune stale entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetAt < now) store.delete(key);
    }
  },
  5 * 60 * 1_000,
);
