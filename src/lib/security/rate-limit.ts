/**
 * In-memory request limits for route handlers, on top of the database-backed ones (coach quota, food search
 * quota, support limits, checkout cooldown). On Vercel each server instance keeps its own counts, so a limit here
 * holds per instance only: it stops one browser or script hammering a route, not a spread-out attack. Limits that
 * must hold across instances live in the database. No imports.
 */

export type RateLimitRule = { limit: number; windowMs: number };
export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  take(key: string, now?: number): RateLimitDecision;
  reset(): void;
  readonly size: number;
};

/**
 * A sliding-window limiter: at most `limit` takes per key within any `windowMs`. Memory is bounded: at most
 * `maxKeys` keys are tracked, the least recently used dropped first, and each key keeps at most `limit` times.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 5000 }: RateLimitRule & { maxKeys?: number }): RateLimiter {
  if (!(limit >= 1) || !(windowMs > 0)) throw new RangeError("a rate limit needs limit >= 1 and windowMs > 0");
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const since = now - windowMs;
      const times = (hits.get(key) ?? []).filter((at) => at > since);
      // Re-insert so Map order is least recently used first.
      hits.delete(key);
      if (times.length >= limit) {
        hits.set(key, times);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) };
      }
      times.push(now);
      hits.set(key, times);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return { allowed: true, remaining: limit - times.length };
    },
    reset() {
      hits.clear();
    },
    get size() {
      return hits.size;
    },
  };
}

/** Per-account limits for the routes that cost money or reach the owner. Keys are account ids from the session. */
export const ROUTE_LIMITS = {
  /** Coach messages and meal swaps: bursts only; the daily allowance is the database quota. */
  coachTurn: { limit: 8, windowMs: 60_000 },
  /** Help requests and replies: bursts only; the database allows 3 requests and 10 replies an hour. */
  support: { limit: 6, windowMs: 60_000 },
  /** Razorpay subscription creation: the database cooldown also applies. */
  checkout: { limit: 5, windowMs: 10 * 60_000 },
  /** Razorpay cancel and Checkout verification calls. */
  billingAction: { limit: 10, windowMs: 10 * 60_000 },
  /** Account deletion attempts. */
  accountDelete: { limit: 5, windowMs: 10 * 60_000 },
  /** Session re-stamping after sign-in. */
  session: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RouteLimitName = keyof typeof ROUTE_LIMITS;

const limiters = new Map<RouteLimitName, RateLimiter>();
let overrides: Partial<Record<RouteLimitName, RateLimitRule>> = {};

/** The shared limiter of one route family in this server instance. */
export function routeLimiter(name: RouteLimitName): RateLimiter {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = createRateLimiter(overrides[name] ?? ROUTE_LIMITS[name]);
    limiters.set(name, limiter);
  }
  return limiter;
}

/** Takes one request of `name` for `key`. */
export function takeRouteLimit(name: RouteLimitName, key: string, now?: number): RateLimitDecision {
  return routeLimiter(name).take(key, now);
}

/** For tests: forgets every count. */
export function resetRouteLimits() {
  for (const limiter of limiters.values()) limiter.reset();
}

/**
 * For tests of other behaviour that call one route many times in a row: other rules for some route families
 * (their counts start again). Nothing in the app calls it; tests/unit/security-limits.test.ts covers the real rules.
 */
export function configureRouteLimitsForTests(next: Partial<Record<RouteLimitName, RateLimitRule>>) {
  overrides = { ...next };
  limiters.clear();
}
