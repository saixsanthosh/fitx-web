import "server-only";
import type { AiTask, AttemptOutcome, ProviderId } from "./types";

/**
 * Remembers which providers or models to leave alone for a while: after a 429 (for as long as the
 * provider asked), after a rejected key, or after repeated failures to answer at all (a simple circuit breaker).
 *
 * Only real availability failures count towards a model's breaker: timeouts, network errors, 429s and 5xx answers
 * (failureReach). An answer that fails FITX's format check, or a request this model rejected, says nothing about
 * other tasks or other members: that model is only tried after the others for the same task, briefly, and never
 * skipped. A refusal (a safety filter on one request) leaves no trace at all.
 *
 * While a breaker is open, a task that has not failed during that run of failures still gets one try (one chat
 * question is still tried when plans keep timing out); if it fails too, it waits like the others. A provider's own
 * wait (Retry-After, a model that does not exist) holds for every task.
 *
 * State lives in this server instance's memory. Vercel reuses warm instances for many requests, so
 * this saves most repeated calls to a provider that is out of quota; a cold instance simply tries
 * once, gets the same 429 and backs off too.
 */
export type CooldownStore = {
  /** When the model is usable again for `task` (ms since epoch), or 0 when it may be tried now. */
  blockedUntil(provider: ProviderId, model: string, now: number, task: AiTask): number;
  /** True while the model's last answer for `task` failed FITX's checks: it is tried after the others for that task. */
  deprioritised(provider: ProviderId, model: string, task: AiTask, now: number): boolean;
  success(provider: ProviderId, model: string, task: AiTask): void;
  failure(provider: ProviderId, model: string, failure: { now: number; task: AiTask; kind: FailureKind; retryAfterMs?: number; providerWide?: boolean }): void;
  /** Forgets everything (tests, or after the owner changes keys). */
  clear(): void;
};

export type FailureKind = Exclude<AttemptOutcome, "ok" | "skipped">;

/**
 * How far a failed attempt reaches (BRIEF-3 D8):
 * - "provider": a rejected key or a region the provider refuses; every model of that provider waits.
 * - "model": the model did not answer (429, 5xx, timeout, network error, a model that is gone); it counts towards
 *   the breaker, and a provider's own wait holds for every task.
 * - "task": the model answered, but not in a form FITX can use for this task (invalid_response), or rejected this
 *   request's shape (bad_request); only this task tries other models first, for a short while.
 * - "request": the model declined this request (a safety filter); nothing is remembered.
 */
export type FailureReach = "provider" | "model" | "task" | "request";

export function failureReach(kind: FailureKind, providerWide = false): FailureReach {
  if (providerWide) return "provider";
  if (kind === "invalid_response" || kind === "bad_request") return "task";
  if (kind === "refused") return "request";
  // rate_limited, unavailable, timeout, and an auth failure that did not name the whole provider.
  return "model";
}

const BREAKER_THRESHOLD = 3;
const BREAKER_BASE_MS = 30_000;
const BREAKER_MAX_MS = 15 * 60_000;
const RATE_LIMIT_DEFAULT_MS = 60_000;
const PROVIDER_WIDE_MS = 10 * 60_000;
/** How long a model whose answer failed FITX's checks is tried after the others for that task. */
export const TASK_RETRY_LATER_MS = 2 * 60_000;
const MAX_ENTRIES = 200;

type ModelEntry = {
  /** A wait the provider asked for (Retry-After, a 404's hour): every task waits. */
  waitUntil: number;
  /** The breaker, after BREAKER_THRESHOLD failures in a row: it holds for the tasks in `tasks`. */
  breakerUntil: number;
  failures: number;
  /** The tasks that failed since the model last answered. */
  tasks: Set<AiTask>;
};

export function createCooldownStore(): CooldownStore {
  const models = new Map<string, ModelEntry>();
  const providers = new Map<ProviderId, number>();
  const later = new Map<string, number>();
  const modelKey = (provider: ProviderId, model: string) => `${provider}:${model}`;
  const taskKey = (provider: ProviderId, model: string, task: AiTask) => `${provider}:${model}:${task}`;

  function bounded<V>(map: Map<string, V>, name: string, value: V) {
    if (map.size >= MAX_ENTRIES && !map.has(name)) map.delete(map.keys().next().value as string);
    map.set(name, value);
  }

  return {
    blockedUntil(provider, model, now, task) {
      const entry = models.get(modelKey(provider, model));
      const breaker = entry && entry.tasks.has(task) ? entry.breakerUntil : 0;
      const until = Math.max(entry?.waitUntil ?? 0, breaker, providers.get(provider) ?? 0);
      return until > now ? until : 0;
    },
    deprioritised(provider, model, task, now) {
      return (later.get(taskKey(provider, model, task)) ?? 0) > now;
    },
    success(provider, model, task) {
      models.delete(modelKey(provider, model));
      later.delete(taskKey(provider, model, task));
    },
    failure(provider, model, { now, task, kind, retryAfterMs, providerWide }) {
      const reach = failureReach(kind, providerWide);
      if (reach === "request") return;
      if (reach === "provider") {
        providers.set(provider, now + Math.max(retryAfterMs ?? 0, PROVIDER_WIDE_MS));
        return;
      }
      if (reach === "task") {
        bounded(later, taskKey(provider, model, task), now + TASK_RETRY_LATER_MS);
        return;
      }
      const name = modelKey(provider, model);
      const entry = models.get(name) ?? { waitUntil: 0, breakerUntil: 0, failures: 0, tasks: new Set<AiTask>() };
      entry.failures += 1;
      entry.tasks.add(task);
      const wait = retryAfterMs ?? (kind === "rate_limited" ? RATE_LIMIT_DEFAULT_MS : 0);
      if (wait > 0) entry.waitUntil = Math.max(entry.waitUntil, now + wait);
      // A 429 is the provider's quota, with its own wait; it never opens the breaker by itself.
      if (kind !== "rate_limited" && entry.failures >= BREAKER_THRESHOLD) {
        entry.breakerUntil = now + Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** (entry.failures - BREAKER_THRESHOLD));
      }
      bounded(models, name, entry);
    },
    clear() {
      models.clear();
      providers.clear();
      later.clear();
    },
  };
}

/** Shared by every request this server instance handles. */
export const sharedCooldowns = createCooldownStore();
