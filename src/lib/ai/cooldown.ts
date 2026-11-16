import "server-only";
import type { ProviderId } from "./types";

/**
 * Remembers which providers or models to leave alone for a while: after a 429 (for as long as the
 * provider asked), after a rejected key, or after repeated failures (a simple circuit breaker).
 *
 * State lives in this server instance's memory. Vercel reuses warm instances for many requests, so
 * this saves most repeated calls to a provider that is out of quota; a cold instance simply tries
 * once, gets the same 429 and backs off too.
 */
export type CooldownStore = {
  /** When the entry is usable again (ms since epoch), or 0 when it is usable now. */
  blockedUntil(provider: ProviderId, model: string, now: number): number;
  success(provider: ProviderId, model: string): void;
  failure(provider: ProviderId, model: string, failure: { now: number; retryAfterMs?: number; providerWide?: boolean; rateLimited?: boolean }): void;
  /** Forgets everything (tests, or after the owner changes keys). */
  clear(): void;
};

const BREAKER_THRESHOLD = 3;
const BREAKER_BASE_MS = 30_000;
const BREAKER_MAX_MS = 15 * 60_000;
const RATE_LIMIT_DEFAULT_MS = 60_000;
const PROVIDER_WIDE_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

export function createCooldownStore(): CooldownStore {
  const entries = new Map<string, { until: number; failures: number }>();
  const key = (provider: ProviderId, model: string) => `${provider}:${model}`;
  const providerKey = (provider: ProviderId) => `${provider}:*`;

  const set = (name: string, until: number, failures: number) => {
    if (entries.size >= MAX_ENTRIES && !entries.has(name)) entries.delete(entries.keys().next().value as string);
    entries.set(name, { until, failures });
  };

  return {
    blockedUntil(provider, model, now) {
      const until = Math.max(entries.get(key(provider, model))?.until ?? 0, entries.get(providerKey(provider))?.until ?? 0);
      return until > now ? until : 0;
    },
    success(provider, model) {
      entries.delete(key(provider, model));
    },
    failure(provider, model, { now, retryAfterMs, providerWide, rateLimited }) {
      if (providerWide) {
        set(providerKey(provider), now + Math.max(retryAfterMs ?? 0, PROVIDER_WIDE_MS), 0);
        return;
      }
      const name = key(provider, model);
      const failures = (entries.get(name)?.failures ?? 0) + 1;
      let wait = retryAfterMs ?? (rateLimited ? RATE_LIMIT_DEFAULT_MS : 0);
      if (!rateLimited && failures >= BREAKER_THRESHOLD) {
        wait = Math.max(wait, Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** (failures - BREAKER_THRESHOLD)));
      }
      set(name, wait > 0 ? now + wait : 0, failures);
    },
    clear() {
      entries.clear();
    },
  };
}

/** Shared by every request this server instance handles. */
export const sharedCooldowns = createCooldownStore();
