import "server-only";
import type { AiConfig } from "./config";
import { sharedCooldowns, type CooldownStore } from "./cooldown";
import { createAdapters } from "./providers";
import { ProviderError, isAbort, type FetchLike, type ProviderAdapter } from "./providers/types";
import { candidatesFor, type Candidate } from "./registry";
import type { AiRequest, AiTextResult, AiUsage, AttemptLog, ProviderId, UnavailableReason } from "./types";

/**
 * The one place FITX calls AI providers. Every AI feature goes through here, so the kill switch,
 * the free-only guard, timeouts, fallbacks and cooldowns apply everywhere.
 *
 * For each task it tries the configured free models in order (registry.ts) and moves on after a
 * 429, a 5xx, a timeout, a refusal, or an answer that is not valid JSON for a structured task. When
 * nothing answers it throws AiUnavailableError, and the page says so; it never makes up a reply.
 * What a failure means for later requests (other tasks, other members) is cooldown.ts's failureReach.
 */

export class AiUnavailableError extends Error {
  readonly reason: UnavailableReason;
  /** When trying again is likely to work (ms since epoch), when known. */
  readonly retryAt?: number;
  readonly attempts: AttemptLog[];

  constructor(reason: UnavailableReason, attempts: AttemptLog[] = [], retryAt?: number) {
    super(`AI unavailable: ${reason}`);
    this.name = "AiUnavailableError";
    this.reason = reason;
    this.attempts = attempts;
    this.retryAt = retryAt;
  }
}

export type RouterDeps = {
  config: AiConfig;
  fetch?: FetchLike;
  now?: () => number;
  cooldowns?: CooldownStore;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  /** Called once per request with the attempt log (no prompts or replies). */
  log?: (entry: { task: string; attempts: AttemptLog[]; ok: boolean }) => void;
};

export type JsonOptions = { signal?: AbortSignal; attemptTimeoutMs?: number; deadlineMs?: number };
export type StreamOptions = {
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** The provider failed after it had started answering; the caller should clear the partial reply. */
  onReset: () => void;
  firstTokenTimeoutMs?: number;
  attemptTimeoutMs?: number;
  deadlineMs?: number;
};

export type JsonResult<T> = { value: T; provider: ProviderId; model: string; usage?: AiUsage; attempts: AttemptLog[] };

const DEFAULT_RETRY_MS = 2 * 60_000;
const MIN_ATTEMPT_MS = 2_500;

/**
 * Shorter limits for providers that may be slow or switched off: Ollama runs on a machine the owner keeps, so a
 * sleeping or busy server costs at most these few seconds before the coach says it is at capacity.
 */
export const PROVIDER_TIMEOUTS: Partial<Record<ProviderId, { firstTokenMs: number; attemptMs: number }>> = {
  ollama: { firstTokenMs: 10_000, attemptMs: 25_000 },
};

function capped(provider: ProviderId, kind: "firstTokenMs" | "attemptMs", ms: number) {
  const cap = PROVIDER_TIMEOUTS[provider]?.[kind];
  return cap ? Math.min(cap, ms) : ms;
}

export function createAiRouter(deps: RouterDeps) {
  const fetcher: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const cooldowns = deps.cooldowns ?? sharedCooldowns;
  const adapters = deps.adapters ?? createAdapters(deps.config);
  const log = deps.log ?? defaultLog;

  function plan(task: AiRequest["task"], personalData = false, consentVersion?: number): Candidate[] {
    if (!deps.config.enabled) throw new AiUnavailableError("disabled");
    const candidates = candidatesFor(task, deps.config, { personalData, consentVersion }).filter((candidate) => adapters[candidate.provider]);
    if (!candidates.length) {
      // Keys exist, but only for providers that may not receive member data, or this member's data (see registry.ts).
      const anyAtAll = candidatesFor(task, deps.config).some((candidate) => adapters[candidate.provider]);
      throw new AiUnavailableError(anyAtAll ? "private" : "not_configured");
    }
    return candidates;
  }

  /** Runs attempts in order until one succeeds; shared by json() and stream(). */
  async function attemptAll<T>(
    request: AiRequest,
    signal: AbortSignal | undefined,
    deadlineMs: number,
    attempt: (adapter: ProviderAdapter, candidate: Candidate, attemptSignal: AbortSignal, budgetMs: number) => Promise<T>,
  ): Promise<{ result: T; candidate: Candidate; attempts: AttemptLog[] }> {
    const task = request.task;
    const candidates = tryOrder(plan(task, request.personalData, request.consentVersion), (candidate) => cooldowns.deprioritised(candidate.provider, candidate.model, task, now()));
    const attempts: AttemptLog[] = [];
    const deadline = now() + deadlineMs;
    let refusals = 0;
    let unusable = 0;
    let skipped = 0;
    let tried = 0;

    for (const candidate of candidates) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (cooldowns.blockedUntil(candidate.provider, candidate.model, now(), task)) {
        attempts.push({ ...candidate, outcome: "skipped", ms: 0 });
        skipped += 1;
        continue;
      }
      const budget = deadline - now();
      if (budget < MIN_ATTEMPT_MS) break;
      const started = now();
      tried += 1;
      try {
        const result = await attempt(adapters[candidate.provider]!, candidate, combine(signal, budget), budget);
        cooldowns.success(candidate.provider, candidate.model, task);
        attempts.push({ ...candidate, outcome: "ok", ms: now() - started });
        log({ task, attempts, ok: true });
        return { result, candidate, attempts };
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        const failure = toProviderError(error);
        attempts.push({ ...candidate, outcome: failure.kind, ms: now() - started, ...(failure.status ? { status: failure.status } : {}) });
        if (failure.kind === "refused") refusals += 1;
        if (failure.kind === "invalid_response" || failure.kind === "bad_request") unusable += 1;
        cooldowns.failure(candidate.provider, candidate.model, {
          now: now(),
          task,
          kind: failure.kind,
          retryAfterMs: failure.retryAfterMs,
          providerWide: failure.providerWide,
        });
      }
    }

    log({ task, attempts, ok: false });
    if (tried > 0 && refusals === tried) throw new AiUnavailableError("refused", attempts);
    // Every model answered, but nothing it sent passed FITX's checks: not "busy", and trying again needs no wait.
    if (tried > 0 && !skipped && unusable === tried) throw new AiUnavailableError("unusable", attempts);
    const waits = candidates.map((candidate) => cooldowns.blockedUntil(candidate.provider, candidate.model, now(), task)).filter((until) => until > 0);
    throw new AiUnavailableError("at_capacity", attempts, waits.length ? Math.min(...waits) : now() + DEFAULT_RETRY_MS);
  }

  return {
    /** The models this task would try, in order (after the kill switch, the free-only guard and the member-data rule). */
    candidates(task: AiRequest["task"], options: { personalData?: boolean; consentVersion?: number } = {}) {
      return plan(task, options.personalData, options.consentVersion);
    },

    /** A structured task: the reply must parse as JSON and pass `parse`, or the next model is tried. */
    async json<T>(request: AiRequest, parse: (value: unknown) => T | null, options: JsonOptions = {}): Promise<JsonResult<T>> {
      const attemptTimeout = options.attemptTimeoutMs ?? 30_000;
      const { result, candidate, attempts } = await attemptAll(request, options.signal, options.deadlineMs ?? 55_000, async (adapter, chosen, signal, budget) => {
        const timed = combine(signal, capped(chosen.provider, "attemptMs", Math.min(attemptTimeout, budget)));
        const reply = await adapter.generate({ model: chosen.model, request, signal: timed, fetch: fetcher });
        const value = parse(parseJsonText(reply.text));
        if (value === null || value === undefined) throw new ProviderError("invalid_response", "answer did not match the expected format");
        return { value, usage: reply.usage };
      });
      return { value: result.value, provider: candidate.provider, model: candidate.model, usage: result.usage, attempts };
    },

    /** A chat reply streamed piece by piece. Falls back to the next model if one fails, before or during its answer. */
    async stream(request: AiRequest, options: StreamOptions): Promise<AiTextResult> {
      const firstTokenTimeout = options.firstTokenTimeoutMs ?? 15_000;
      const attemptTimeout = options.attemptTimeoutMs ?? 45_000;
      const { result, candidate, attempts } = await attemptAll(request, options.signal, options.deadlineMs ?? 55_000, async (adapter, chosen, signal, budget) => {
        const controller = new AbortController();
        const timed = AbortSignal.any([signal, controller.signal]);
        const firstToken = setTimeout(() => controller.abort(new DOMException("No first token in time", "TimeoutError")), capped(chosen.provider, "firstTokenMs", Math.min(firstTokenTimeout, budget)));
        const whole = setTimeout(() => controller.abort(new DOMException("Answer took too long", "TimeoutError")), capped(chosen.provider, "attemptMs", Math.min(attemptTimeout, budget)));
        let startedAnswer = false;
        try {
          return await adapter.stream({
            model: chosen.model,
            request,
            signal: timed,
            fetch: fetcher,
            onDelta: (text) => {
              if (!startedAnswer) {
                startedAnswer = true;
                clearTimeout(firstToken);
              }
              options.onDelta(text);
            },
          });
        } catch (error) {
          if (startedAnswer) options.onReset();
          throw error;
        } finally {
          clearTimeout(firstToken);
          clearTimeout(whole);
        }
      });
      return { text: result.text, provider: candidate.provider, model: candidate.model, usage: result.usage, attempts };
    },
  };
}

export type AiRouter = ReturnType<typeof createAiRouter>;

/**
 * The order to try models in: the registry's order, except that a model whose last answer for this task failed
 * FITX's checks goes after the others (it is still tried, so it never blocks the task when it is the only one).
 */
export function tryOrder<T>(candidates: readonly T[], retryLater: (candidate: T) => boolean): T[] {
  const later = candidates.filter(retryLater);
  return later.length ? [...candidates.filter((candidate) => !later.includes(candidate)), ...later] : [...candidates];
}

/** Reads a JSON object from a model reply, tolerating ```json fences or a sentence around it. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Fall through.
      }
    }
    throw new ProviderError("invalid_response", "answer was not valid JSON");
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (isAbort(error)) return new ProviderError("timeout", "no answer in time");
  return new ProviderError("unavailable", "unexpected provider failure");
}

function combine(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(Math.max(1, Math.round(timeoutMs)));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function defaultLog(entry: { task: string; attempts: AttemptLog[]; ok: boolean }) {
  // Provider, model, outcome and timing only: never prompts, replies, keys or member data.
  const line = JSON.stringify({ task: entry.task, ok: entry.ok, attempts: entry.attempts });
  if (entry.ok && entry.attempts.length === 1) console.info("[fitx-ai]", line);
  else console.warn("[fitx-ai]", line);
}
