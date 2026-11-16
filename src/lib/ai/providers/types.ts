import "server-only";
import type { AiRequest, AiUsage, AttemptOutcome, ProviderId } from "../types";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ProviderCall = {
  model: string;
  request: AiRequest;
  signal: AbortSignal;
  fetch: FetchLike;
};

export type ProviderResult = { text: string; usage?: AiUsage; model: string };

/** Streams text pieces as they arrive; resolves with the whole reply. */
export type ProviderStreamCall = ProviderCall & { onDelta: (text: string) => void };

export interface ProviderAdapter {
  id: ProviderId;
  generate(call: ProviderCall): Promise<ProviderResult>;
  stream(call: ProviderStreamCall): Promise<ProviderResult>;
}

/**
 * A failed provider attempt, classified so the router knows whether to try the next model and how
 * long to leave this one alone. Messages never include prompts, replies or keys.
 */
export class ProviderError extends Error {
  readonly kind: Exclude<AttemptOutcome, "ok" | "skipped">;
  readonly status?: number;
  /** How long the provider asked us to wait (429 Retry-After or Gemini RetryInfo), in ms. */
  readonly retryAfterMs?: number;
  /** The whole provider (bad key, region not allowed), not just this model, should be skipped. */
  readonly providerWide: boolean;

  constructor(kind: ProviderError["kind"], message: string, options: { status?: number; retryAfterMs?: number; providerWide?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.providerWide = options.providerWide ?? false;
  }
}

/** Maps an HTTP status to an outcome. 429 and 5xx are worth another model; 400 means this request shape failed here. */
export function errorForStatus(status: number, detail: string, retryAfterMs?: number): ProviderError {
  if (status === 429) return new ProviderError("rate_limited", `rate limited (${detail})`, { status, retryAfterMs });
  if (status === 401 || status === 403) return new ProviderError("auth", `key rejected (${detail})`, { status, providerWide: true });
  if (status === 402) return new ProviderError("auth", `payment required (${detail})`, { status, providerWide: true });
  if (status === 404) return new ProviderError("unavailable", `model not found (${detail})`, { status, retryAfterMs: 60 * 60_000 });
  if (status === 400 || status === 413 || status === 422) return new ProviderError("bad_request", `request rejected (${detail})`, { status });
  if (status === 408) return new ProviderError("timeout", `provider timed out (${detail})`, { status });
  return new ProviderError("unavailable", `provider error ${status} (${detail})`, { status, retryAfterMs });
}

/** Retry-After as seconds or an HTTP date, in ms; undefined when absent or unreadable. Capped at a day. */
export function retryAfterHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 86_400_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - now), 86_400_000) : undefined;
}

export function isAbort(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** A short, key-free description of a failed body for logs: provider status words only. */
export function errorDetail(body: unknown): string {
  const error = (body && typeof body === "object" ? (body as { error?: unknown }).error : null) as Record<string, unknown> | string | null;
  if (typeof error === "string") return error.slice(0, 60).replace(/[^\w .:-]/g, "");
  const status = error && typeof error === "object" ? error.status ?? error.code ?? error.type : null;
  return typeof status === "string" || typeof status === "number" ? String(status).slice(0, 40) : "no detail";
}
