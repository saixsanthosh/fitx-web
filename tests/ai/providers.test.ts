import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { geminiQuotaPerDay, geminiStream, mockFetch, openAiStream, openAiText, rateLimited } from "./support/mock-providers.ts";

const { readAiConfig } = await import("@/lib/ai/config");
const { createAdapters, groqExtras } = await import("@/lib/ai/providers");
const { geminiBody, geminiError, msUntilPacificMidnight, toGeminiSchema } = await import("@/lib/ai/providers/gemini");
const { chatBody } = await import("@/lib/ai/providers/openai-compatible");
const { ProviderError, retryAfterHeader } = await import("@/lib/ai/providers/types");
const { readSseData } = await import("@/lib/ai/providers/sse");

const request = {
  task: "chat" as const,
  system: "System rules",
  messages: [
    { role: "assistant" as const, content: "stray greeting" },
    { role: "user" as const, content: "one" },
    { role: "user" as const, content: "two" },
    { role: "assistant" as const, content: "answer" },
    { role: "user" as const, content: "three" },
  ],
  maxOutputTokens: 300,
  temperature: 0.4,
};
const signal = () => AbortSignal.timeout(5_000);
const adapters = createAdapters(readAiConfig({ GEMINI_API_KEY: "g-key", GROQ_API_KEY: "q-key", OPENROUTER_API_KEY: "o-key", NEXT_PUBLIC_SITE_URL: "https://fitnessx.vercel.app" }));

describe("Gemini adapter", () => {
  test("sends the key in a header, never the URL, with system rules and alternating turns", async () => {
    const mock = mockFetch(() => geminiStream(["Hi", " there"]));
    const pieces: string[] = [];
    const result = await adapters.gemini!.stream({ model: "gemini-3.5-flash-lite", request, signal: signal(), fetch: mock.fetch, onDelta: (text) => pieces.push(text) });
    const call = mock.calls[0];
    assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    assert.ok(!call.url.includes("g-key"));
    assert.equal(call.headers["x-goog-api-key"], "g-key");
    assert.deepEqual(call.body?.systemInstruction, { parts: [{ text: "System rules" }] });
    assert.deepEqual((call.body?.contents as Array<{ role: string }>).map((turn) => turn.role), ["user", "model", "user"]);
    assert.equal((call.body?.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text, "one\n\ntwo");
    assert.equal(result.text, "Hi there");
    assert.deepEqual(pieces, ["Hi", " there"]);
  });

  test("asks for JSON with an upper-case schema for structured tasks", () => {
    const body = geminiBody({ ...request, json: { name: "x", schema: { type: "object", properties: { a: { type: "array", items: { type: "string", enum: ["x"] } } }, required: ["a"] } } });
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseSchema, toGeminiSchema({ type: "object", properties: { a: { type: "array", items: { type: "string", enum: ["x"] } } }, required: ["a"] }));
    assert.deepEqual(toGeminiSchema({ type: "object", properties: { a: { type: "integer" } }, required: ["a"] }), { type: "OBJECT", properties: { a: { type: "INTEGER" } }, propertyOrdering: ["a"], required: ["a"] });
  });

  test("hides thought parts and reports safety stops as refusals", async () => {
    const thoughts = mockFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Answer" }] }, finishReason: "STOP" }] } }));
    assert.equal((await adapters.gemini!.generate({ model: "m", request, signal: signal(), fetch: thoughts.fetch })).text, "Answer");
    const blocked = mockFetch(() => ({ json: { promptFeedback: { blockReason: "SAFETY" } } }));
    await assert.rejects(adapters.gemini!.generate({ model: "m", request, signal: signal(), fetch: blocked.fetch }), (error: unknown) => error instanceof ProviderError && error.kind === "refused");
  });

  test("reads RetryInfo, and waits for the Pacific-midnight reset on a daily quota", () => {
    const now = Date.parse("2026-11-16T20:00:00Z"); // 12:00 in Los Angeles
    const daily = geminiError(429, geminiQuotaPerDay.json, undefined, now);
    assert.equal(daily.kind, "rate_limited");
    assert.equal(daily.retryAfterMs, 12 * 3600 * 1000);
    assert.equal(msUntilPacificMidnight(now), 12 * 3600 * 1000);
    const perMinute = geminiError(429, { error: { status: "RESOURCE_EXHAUSTED", details: [{ retryDelay: "17s" }] } });
    assert.equal(perMinute.retryAfterMs, 17_000);
  });

  test("a rejected key or an unsupported region skips the whole provider", () => {
    const badKey = geminiError(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } });
    assert.equal(badKey.kind, "auth");
    assert.equal(badKey.providerWide, true);
    assert.equal(geminiError(400, { error: { status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } }).providerWide, true);
    assert.equal(geminiError(404, { error: { status: "NOT_FOUND" } }).kind, "unavailable");
  });
});

describe("OpenAI-compatible adapter (Groq, OpenRouter, Ollama)", () => {
  test("Groq: bearer key, short reasoning for gpt-oss chat, reasoning hidden", async () => {
    const mock = mockFetch(() => openAiStream(["Hey", "!"]));
    const result = await adapters.groq!.stream({ model: "openai/gpt-oss-20b", request, signal: signal(), fetch: mock.fetch, onDelta: () => {} });
    const call = mock.calls[0];
    assert.equal(call.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(call.headers.authorization, "Bearer q-key");
    assert.equal(call.body?.reasoning_effort, "low");
    assert.equal(call.body?.include_reasoning, false);
    assert.equal(call.body?.stream, true);
    assert.deepEqual((call.body?.messages as Array<{ role: string }>)[0], { role: "system", content: "System rules" });
    assert.equal(result.text, "Hey!");
    assert.deepEqual(groqExtras("llama-3.3-70b-versatile", request), {});
    assert.equal(groqExtras("openai/gpt-oss-120b", { ...request, task: "meal_plan" }).reasoning_effort, "medium");
  });

  test("OpenRouter: identifies the app and only uses providers that do not collect prompts", async () => {
    const mock = mockFetch(() => openAiText('{"ok":true}'));
    await adapters.openrouter!.generate({ model: "openrouter/free", request: { ...request, json: { name: "x", schema: { type: "object" } } }, signal: signal(), fetch: mock.fetch });
    const call = mock.calls[0];
    assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(call.headers["http-referer"], "https://fitnessx.vercel.app");
    assert.equal(call.headers["x-title"], "FITX");
    assert.deepEqual(call.body?.provider, { data_collection: "deny" });
    assert.deepEqual(call.body?.response_format, { type: "json_object" });
  });

  test("errors inside a 200 body or a stream chunk are classified", async () => {
    const inBody = mockFetch(() => ({ json: { error: { code: 429, message: "free model limit" } } }));
    await assert.rejects(adapters.openrouter!.generate({ model: "openrouter/free", request, signal: signal(), fetch: inBody.fetch }), (error: unknown) => error instanceof ProviderError && error.kind === "rate_limited");
    const inStream = mockFetch(() => ({ sse: [JSON.stringify({ error: { code: 502, message: "upstream" } })] }));
    await assert.rejects(adapters.openrouter!.stream({ model: "openrouter/free", request, signal: signal(), fetch: inStream.fetch, onDelta: () => {} }), (error: unknown) => error instanceof ProviderError && error.kind === "unavailable");
    const limited = mockFetch(() => rateLimited(12));
    await assert.rejects(adapters.groq!.generate({ model: "openai/gpt-oss-20b", request, signal: signal(), fetch: limited.fetch }), (error: unknown) => error instanceof ProviderError && error.retryAfterMs === 12_000);
    const unauthorized = mockFetch(() => ({ status: 401, json: { error: { message: "Invalid API Key" } } }));
    await assert.rejects(adapters.groq!.generate({ model: "openai/gpt-oss-20b", request, signal: signal(), fetch: unauthorized.fetch }), (error: unknown) => error instanceof ProviderError && error.providerWide);
  });

  test("an empty or cut-off answer is invalid, not a reply", async () => {
    const empty = mockFetch(() => ({ json: { choices: [{ message: { content: "" }, finish_reason: "length" }] } }));
    await assert.rejects(adapters.groq!.generate({ model: "openai/gpt-oss-20b", request, signal: signal(), fetch: empty.fetch }), (error: unknown) => error instanceof ProviderError && error.kind === "invalid_response");
  });

  test("request body", () => {
    const body = chatBody("m", request, false);
    assert.equal(body.max_tokens, 300);
    assert.equal(body.temperature, 0.4);
    assert.equal("response_format" in body, false);
  });
});

describe("shared parsing", () => {
  test("SSE: comments, multi-line data and CRLF", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\r\n\r\ndata: one\r\n\r\ndata: a"));
        controller.enqueue(encoder.encode("\ndata: b\n\nevent: x\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const event of readSseData(stream)) events.push(event);
    assert.deepEqual(events, ["one", "a\nb", "[DONE]"]);
  });

  test("Retry-After as seconds or a date", () => {
    assert.equal(retryAfterHeader("30"), 30_000);
    assert.equal(retryAfterHeader("Mon, 16 Nov 2026 20:01:00 GMT", Date.parse("2026-11-16T20:00:00Z")), 60_000);
    assert.equal(retryAfterHeader(null), undefined);
  });
});
