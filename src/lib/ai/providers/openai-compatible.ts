import "server-only";
import type { AiRequest, JsonSchema } from "../types";
import { readSseData } from "./sse";
import { ProviderError, errorDetail, errorForStatus, isAbort, retryAfterHeader } from "./types";
import type { ProviderAdapter, ProviderCall, ProviderResult, ProviderStreamCall } from "./types";

/**
 * One adapter for every OpenAI-compatible chat API FITX uses: Groq, OpenRouter (free models only)
 * and, in local development, Ollama's /v1 endpoint. Plain fetch, no SDK.
 */
export type OpenAiCompatibleOptions = {
  id: "groq" | "openrouter" | "ollama";
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Provider-specific body fields, such as Groq's reasoning controls or OpenRouter's data policy. */
  extraBody?: (model: string, request: AiRequest) => Record<string, unknown>;
  /** Whether this model accepts a JSON schema (response_format json_schema); otherwise plain JSON mode is used. */
  jsonSchema?: (model: string) => boolean;
};

type ChatChoice = { message?: { content?: unknown }; delta?: { content?: unknown }; finish_reason?: string | null };
type ChatResponse = {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  error?: { code?: unknown; message?: unknown; metadata?: unknown } | string;
};

export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleOptions): ProviderAdapter {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    id: options.id,
    async generate(call: ProviderCall): Promise<ProviderResult> {
      const response = await send(call, url, options, false);
      let data: ChatResponse;
      try {
        data = (await response.json()) as ChatResponse;
      } catch (error) {
        if (isAbort(error)) throw new ProviderError("timeout", "answer cut off");
        throw new ProviderError("invalid_response", "unreadable answer");
      }
      if (data.error) throw bodyError(data.error);
      const choice = data.choices?.[0];
      const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
      checkFinish(choice?.finish_reason, text);
      return { text, model: call.model, usage: usageOf(data) };
    },
    async stream(call: ProviderStreamCall): Promise<ProviderResult> {
      const response = await send(call, url, options, true);
      if (!response.body) throw new ProviderError("invalid_response", "empty stream");
      let whole = "";
      let finish: string | null | undefined;
      let usage: ProviderResult["usage"];
      try {
        for await (const chunk of readSseData(response.body, call.signal)) {
          if (chunk.trim() === "[DONE]") break;
          let data: ChatResponse;
          try {
            data = JSON.parse(chunk) as ChatResponse;
          } catch {
            throw new ProviderError("invalid_response", "unreadable stream chunk");
          }
          if (data.error) throw bodyError(data.error);
          const choice = data.choices?.[0];
          const piece = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
          if (piece) {
            whole += piece;
            call.onDelta(piece);
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          usage = usageOf(data) ?? usage;
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (isAbort(error)) throw new ProviderError("timeout", "stream stopped");
        throw new ProviderError("unavailable", "stream broke off");
      }
      checkFinish(finish, whole);
      return { text: whole, model: call.model, usage };
    },
  };
}

/** The request body. Exported for tests. */
export function chatBody(model: string, request: AiRequest, stream: boolean, extra?: OpenAiCompatibleOptions["extraBody"], useSchema = false) {
  const responseFormat = request.json
    ? useSchema
      ? { type: "json_schema", json_schema: { name: request.json.name, schema: toJsonSchema(request.json.schema), strict: false } }
      : { type: "json_object" }
    : null;
  return {
    model,
    messages: [{ role: "system", content: request.system }, ...request.messages.map((message) => ({ role: message.role, content: message.content }))],
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
    stream,
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(extra ? extra(model, request) : {}),
  };
}

/** The schema as standard JSON Schema (lower-case types), for response_format json_schema. */
export function toJsonSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.nullable ? [schema.type, "null"] : schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)]));
  if (schema.required) out.required = schema.required;
  return out;
}

async function send(call: ProviderCall, url: string, options: OpenAiCompatibleOptions, stream: boolean) {
  let response: Response;
  try {
    response = await call.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(stream ? { Accept: "text/event-stream" } : {}),
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        ...options.headers,
      },
      body: JSON.stringify(chatBody(call.model, call.request, stream, options.extraBody, options.jsonSchema?.(call.model) ?? false)),
      signal: call.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbort(error)) throw new ProviderError("timeout", "no answer in time");
    throw new ProviderError("unavailable", `could not reach ${options.id}`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw errorForStatus(response.status, errorDetail(body), retryAfterOf(response));
  }
  return response;
}

/** Retry-After, or OpenRouter's X-RateLimit-Reset (epoch milliseconds) on free-model limits. */
function retryAfterOf(response: Response, now = Date.now()) {
  const header = retryAfterHeader(response.headers.get("retry-after"), now);
  if (header !== undefined) return header;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > now) return Math.min(reset - now, 86_400_000);
  return undefined;
}

/** OpenRouter reports upstream failures inside a 200 body or a stream chunk. */
function bodyError(error: NonNullable<ChatResponse["error"]>): ProviderError {
  const code = typeof error === "object" ? Number(error.code) : NaN;
  return errorForStatus(Number.isFinite(code) && code >= 400 ? code : 502, errorDetail({ error }));
}

function checkFinish(finish: string | null | undefined, text: string) {
  if (finish === "content_filter") throw new ProviderError("refused", "provider stopped for safety");
  if (!text.trim()) throw new ProviderError("invalid_response", finish === "length" ? "ran out of room before answering" : "empty answer");
}

function usageOf(data: ChatResponse) {
  const usage = data.usage ?? data.x_groq?.usage;
  return usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : undefined;
}
