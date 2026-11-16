import "server-only";
import type { AiMessage, AiRequest, JsonSchema } from "../types";
import { readSseData } from "./sse";
import { ProviderError, errorDetail, errorForStatus, isAbort, retryAfterHeader } from "./types";
import type { ProviderAdapter, ProviderCall, ProviderResult, ProviderStreamCall } from "./types";

/**
 * Google Gemini through its native REST API (generativelanguage.googleapis.com, v1beta).
 * The key travels in the x-goog-api-key header, never in the URL, so it stays out of logs.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

type GeminiPart = { text?: unknown; thought?: unknown };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  error?: unknown;
};

const REFUSED_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export function createGeminiAdapter(apiKey: string): ProviderAdapter {
  return {
    id: "gemini",
    async generate(call: ProviderCall): Promise<ProviderResult> {
      const response = await send(call, `${GEMINI_BASE}/models/${encodeURIComponent(call.model)}:generateContent`, apiKey);
      const data = (await readJson(response)) as GeminiResponse;
      const { text, finish } = textOf(data);
      checkFinish(data, finish, text);
      return { text, model: call.model, usage: usageOf(data) };
    },
    async stream(call: ProviderStreamCall): Promise<ProviderResult> {
      const response = await send(call, `${GEMINI_BASE}/models/${encodeURIComponent(call.model)}:streamGenerateContent?alt=sse`, apiKey);
      if (!response.body) throw new ProviderError("invalid_response", "empty stream");
      let whole = "";
      let last: GeminiResponse = {};
      try {
        for await (const chunk of readSseData(response.body, call.signal)) {
          let data: GeminiResponse;
          try {
            data = JSON.parse(chunk) as GeminiResponse;
          } catch {
            throw new ProviderError("invalid_response", "unreadable stream chunk");
          }
          if (data.error) throw geminiError(500, data);
          const { text } = textOf(data);
          if (text) {
            whole += text;
            call.onDelta(text);
          }
          last = { ...data, usageMetadata: data.usageMetadata ?? last.usageMetadata };
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (isAbort(error)) throw new ProviderError("timeout", "stream stopped");
        throw new ProviderError("unavailable", "stream broke off");
      }
      checkFinish(last, last.candidates?.[0]?.finishReason, whole);
      return { text: whole, model: call.model, usage: usageOf(last) };
    },
  };
}

/** The request body Gemini expects. Exported for tests. */
export function geminiBody(request: AiRequest) {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: mergeTurns(request.messages).map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      ...(request.json ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(request.json.schema) } : {}),
    },
  };
}

/** Gemini's schema is the OpenAPI subset with upper-case type names. */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.nullable) out.nullable = true;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  return out;
}

/** Gemini wants the conversation to start with the member and alternate; join same-speaker turns. */
function mergeTurns(messages: AiMessage[]): AiMessage[] {
  const merged: AiMessage[] = [];
  for (const message of messages) {
    if (!merged.length && message.role === "assistant") continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.content = `${last.content}\n\n${message.content}`;
    else merged.push({ ...message });
  }
  return merged;
}

async function send(call: ProviderCall, url: string, apiKey: string) {
  let response: Response;
  try {
    response = await call.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(geminiBody(call.request)),
      signal: call.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbort(error)) throw new ProviderError("timeout", "no answer in time");
    throw new ProviderError("unavailable", "could not reach Gemini");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw geminiError(response.status, body, retryAfterHeader(response.headers.get("retry-after")));
  }
  return response;
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw new ProviderError("timeout", "answer cut off");
    throw new ProviderError("invalid_response", "unreadable answer");
  }
}

/** Maps Gemini's error body (google.rpc.Status) to a ProviderError, reading RetryInfo and per-day quotas. */
export function geminiError(status: number, body: unknown, headerRetryMs?: number, now = Date.now()): ProviderError {
  const error = (body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : null) ?? {};
  const details = Array.isArray(error.details) ? (error.details as Array<Record<string, unknown>>) : [];
  const message = typeof error.message === "string" ? error.message : "";
  const reasons = details.map((detail) => String(detail.reason ?? "")).join(" ");
  if (/API_KEY_INVALID|API_KEY_EXPIRED/.test(reasons) || /api key (not valid|expired)/i.test(message)) {
    return new ProviderError("auth", "Gemini key rejected", { status, providerWide: true });
  }
  if (/location is not supported/i.test(message)) {
    return new ProviderError("auth", "Gemini not offered in this region", { status, providerWide: true });
  }
  let retryMs = headerRetryMs;
  for (const detail of details) {
    const delay = typeof detail.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay) : null;
    if (delay) retryMs = Math.max(retryMs ?? 0, Math.round(Number(delay[1]) * 1000));
    const violations = Array.isArray(detail.violations) ? (detail.violations as Array<Record<string, unknown>>) : [];
    if (violations.some((violation) => /PerDay/i.test(String(violation.quotaId ?? "")))) retryMs = Math.max(retryMs ?? 0, msUntilPacificMidnight(now));
  }
  return errorForStatus(status, errorDetail(body), retryMs);
}

/** Gemini's daily quotas reset at midnight Pacific time. */
export function msUntilPacificMidnight(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Math.max(60_000, ((24 - get("hour")) * 3600 - get("minute") * 60 - get("second")) * 1000);
}

function textOf(data: GeminiResponse) {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter((part) => part.thought !== true && typeof part.text === "string").map((part) => part.text as string).join("");
  return { text, finish: candidate?.finishReason };
}

function checkFinish(data: GeminiResponse, finish: string | undefined, text: string) {
  if (data.promptFeedback?.blockReason) throw new ProviderError("refused", "Gemini declined the request");
  if (finish && REFUSED_FINISH.has(finish)) throw new ProviderError("refused", "Gemini stopped for safety");
  if (!text.trim()) throw new ProviderError("invalid_response", finish === "MAX_TOKENS" ? "ran out of room before answering" : "empty answer");
}

function usageOf(data: GeminiResponse) {
  const usage = data.usageMetadata;
  return usage ? { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount } : undefined;
}
