import type { CoachStatus } from "@/lib/ai/status";
import type { CoachActionView, CoachErrorCode, CoachMessageView, CoachQuota, CoachStreamEvent, CoachSwap, CoachThreadSummary } from "@/lib/ai/types";

/** Browser helpers for the coach's API. Every call is same-origin and carries the session cookies. */

export class CoachRequestError extends Error {
  readonly code: CoachErrorCode | "network";
  readonly retryAt?: string;
  constructor(code: CoachErrorCode | "network", message: string, retryAt?: string) {
    super(message);
    this.name = "CoachRequestError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers }, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CoachRequestError("network", "You seem to be offline. Check your connection and try again.");
  }
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

/** What the proxy answers while FITX Admin has switched the AI coach off (src/lib/platform/gate.ts). */
export const SWITCHED_OFF_MESSAGE = "The AI Coach is switched off for now. Your conversations and settings are safe.";

export async function errorFrom(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string | { code?: CoachErrorCode; message?: string; retryAt?: string } } | null;
  const error = body?.error;
  // The platform gate's body is a plain string, not the coach's { code, message }.
  if (error === "feature_unavailable") return new CoachRequestError("paused", SWITCHED_OFF_MESSAGE);
  if (!error || typeof error !== "object") return new CoachRequestError("failed", "Something went wrong. Please try again.");
  return new CoachRequestError(error.code ?? "failed", error.message ?? "Something went wrong. Please try again.", error.retryAt);
}

export type TurnRequest = { message: string; threadId: string | null; mode: "chat" | "meal_plan" | "workout_plan"; budget?: string };

/** Sends a message and reports each streamed event. Errors before the stream starts are thrown. */
export async function sendTurn(request: TurnRequest, onEvent: (event: CoachStreamEvent) => void, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch("/api/coach/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CoachRequestError("network", "You seem to be offline. Check your connection and try again.");
  }
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new CoachRequestError("failed", "The coach's answer didn't arrive. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line) as CoachStreamEvent);
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CoachRequestError("network", "The connection dropped while the coach was answering. Please try again.");
  }
}

export const fetchStatus = () => call<CoachStatus>("/api/coach/status");
export const fetchThread = (id: string) => call<{ thread: CoachThreadSummary; messages: CoachMessageView[]; actions: CoachActionView[] }>(`/api/coach/threads/${id}`);
export const deleteThread = (id: string) => call<{ deleted: true }>(`/api/coach/threads/${id}`, { method: "DELETE" });
export const applyAction = (id: string) => call<{ status: "applied"; kind: string; refId: string; already: boolean }>(`/api/coach/actions/${id}`, { method: "POST", body: JSON.stringify({ op: "apply" }) });
export const requestSwap = (actionId: string, note: string) =>
  call<{ swap: CoachSwap; action: CoachActionView; quota: CoachQuota }>("/api/coach/swap", { method: "POST", body: JSON.stringify({ actionId, note: note || null }) });
export const saveConsent = (shareData: boolean) => call<{ consent: { shareData: boolean } }>("/api/coach/consent", { method: "POST", body: JSON.stringify({ shareData }) });
/** Agrees again to the current consent screen (the one-time prompt for consents given to an older one). */
export const renewConsent = () => call<{ consent: { shareData: boolean; version: number } }>("/api/coach/consent", { method: "POST", body: JSON.stringify({ renew: true }) });
export const deleteCoachData = () => call<{ deleted: true }>("/api/coach/data", { method: "DELETE" });
