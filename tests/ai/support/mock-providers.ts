// Fake AI provider responses for tests. No real provider, key or network is ever used.

export type MockReply = {
  status?: number;
  json?: unknown;
  /** SSE event payloads (each becomes "data: <payload>\n\n"). */
  sse?: string[];
  /** Break the stream with an error after the listed events. */
  breakAfterSse?: boolean;
  headers?: Record<string, string>;
  /** Never answer until the request is aborted. */
  hang?: boolean;
  /** Fail before any response, like a network error. */
  networkError?: boolean;
};

export type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

/** A fetch stand-in: `route` picks a reply for each provider request. */
export function mockFetch(route: (url: string, body: Record<string, unknown> | null, call: number) => MockReply) {
  const calls: Call[] = [];
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ url: input, method: init.method ?? "GET", headers, body });
    const reply = route(input, body, calls.length);
    const signal = init.signal;
    if (reply.networkError) throw new TypeError("fetch failed");
    if (reply.hang) {
      return new Promise<Response>((_, reject) => {
        const fail = () => reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) fail();
        signal?.addEventListener("abort", fail, { once: true });
      });
    }
    const status = reply.status ?? 200;
    if (reply.sse) {
      const encoder = new TextEncoder();
      const events = reply.sse;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          // Like a dropped connection: the chunks already sent arrive, then the stream fails.
          if (reply.breakAfterSse) setTimeout(() => controller.error(new TypeError("terminated")), 5);
          else controller.close();
        },
      });
      return new Response(stream, { status, headers: { "content-type": "text/event-stream", ...reply.headers } });
    }
    return new Response(reply.json === undefined ? "" : JSON.stringify(reply.json), { status, headers: { "content-type": "application/json", ...reply.headers } });
  };
  return { fetch, calls };
}

export const providerOf = (url: string) =>
  url.includes("generativelanguage.googleapis.com") ? "gemini" : url.includes("api.groq.com") ? "groq" : url.includes("openrouter.ai") ? "openrouter" : "other";

export const geminiText = (text: string): MockReply => ({
  json: { candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } },
});

export const geminiStream = (pieces: string[]): MockReply => ({
  sse: pieces.map((text, index) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(index === pieces.length - 1 ? { finishReason: "STOP" } : {}) }] })),
});

export const openAiText = (text: string): MockReply => ({
  json: { choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 30 } },
});

export const openAiStream = (pieces: string[]): MockReply => ({
  sse: [...pieces.map((text) => JSON.stringify({ choices: [{ delta: { content: text } }] })), JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }), "[DONE]"],
});

export const rateLimited = (seconds = 30): MockReply => ({ status: 429, json: { error: { message: "Rate limit reached", type: "tokens", code: "rate_limit_exceeded" } }, headers: { "retry-after": String(seconds) } });

export const geminiQuotaPerDay: MockReply = {
  status: 429,
  json: {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota.",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" },
      ],
    },
  },
};

export const serverError: MockReply = { status: 503, json: { error: { message: "Service unavailable", status: "UNAVAILABLE" } } };
