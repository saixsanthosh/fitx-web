import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { geminiQuotaPerDay, geminiStream, geminiText, mockFetch, openAiStream, openAiText, providerOf, rateLimited, serverError } from "./support/mock-providers.ts";

const { readAiConfig } = await import("@/lib/ai/config");
const { candidatesFor, canSendMemberData, isFreeModel } = await import("@/lib/ai/registry");
const { createAiRouter, AiUnavailableError, parseJsonText } = await import("@/lib/ai/router");
const { createCooldownStore } = await import("@/lib/ai/cooldown");

const KEYS = { GEMINI_API_KEY: "test-gemini-key", GROQ_API_KEY: "test-groq-key", OPENROUTER_API_KEY: "test-openrouter-key" };
const chatRequest = { task: "chat" as const, system: "You are a test coach.", messages: [{ role: "user" as const, content: "Hi" }], maxOutputTokens: 256, temperature: 0.5 };
const planRequest = { ...chatRequest, task: "meal_plan" as const, json: { name: "plan", schema: { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] } } };
const quiet = () => {};

function router(env: Record<string, string>, route: Parameters<typeof mockFetch>[0], now = () => 1_000_000) {
  const mock = mockFetch(route);
  return { mock, router: createAiRouter({ config: readAiConfig(env), fetch: mock.fetch, cooldowns: createCooldownStore(), now, log: quiet }) };
}

describe("configuration and the free-only guard", () => {
  test("the kill switch pauses everything without calling a provider", async () => {
    const { mock, router: ai } = router({ ...KEYS, AI_COACH_ENABLED: "false" }, () => openAiText("hi"));
    await assert.rejects(ai.json(planRequest, () => ({})), (error: unknown) => error instanceof AiUnavailableError && error.reason === "disabled");
    assert.equal(mock.calls.length, 0);
  });

  test("no keys means not configured, not a canned answer", async () => {
    const { router: ai } = router({}, () => openAiText("hi"));
    await assert.rejects(ai.stream(chatRequest, { onDelta: quiet, onReset: quiet }), (error: unknown) => error instanceof AiUnavailableError && error.reason === "not_configured");
  });

  test("paid or unknown models are refused unless AI_ALLOW_PAID=true", () => {
    assert.equal(isFreeModel("openrouter", "openai/gpt-4o"), false);
    assert.equal(isFreeModel("openrouter", "meta-llama/llama-3.3-70b-instruct:free"), true);
    assert.equal(isFreeModel("openrouter", "openrouter/free"), true);
    assert.equal(isFreeModel("gemini", "gemini-4-carbon"), false);
    assert.equal(isFreeModel("gemini", "gemini-3.5-flash-lite"), true);
    assert.equal(isFreeModel("groq", "openai/gpt-oss-20b"), true);
    assert.equal(isFreeModel("groq", "some/new-paid-model"), false);

    const paid = { ...KEYS, AI_OPENROUTER_MODELS: "openai/gpt-4o,deepseek/deepseek-chat:free", AI_GEMINI_MODELS: "gemini-4-carbon" };
    const guarded = candidatesFor("chat", readAiConfig(paid)).map((c) => `${c.provider}:${c.model}`);
    assert.ok(!guarded.includes("openrouter:openai/gpt-4o"));
    assert.ok(guarded.includes("openrouter:deepseek/deepseek-chat:free"));
    assert.ok(!guarded.some((name) => name.startsWith("gemini:")));
    const allowed = candidatesFor("chat", readAiConfig({ ...paid, AI_ALLOW_PAID: "true" })).map((c) => `${c.provider}:${c.model}`);
    assert.ok(allowed.includes("openrouter:openai/gpt-4o"));
  });

  test("each task has its own order and providers take turns", () => {
    const config = readAiConfig(KEYS);
    assert.deepEqual(candidatesFor("chat", config).map((c) => `${c.provider}:${c.model}`), [
      "groq:openai/gpt-oss-20b", "gemini:gemini-3.5-flash-lite", "openrouter:openrouter/free", "groq:openai/gpt-oss-120b", "gemini:gemini-3.1-flash-lite",
    ]);
    assert.deepEqual(candidatesFor("meal_plan", config).map((c) => `${c.provider}:${c.model}`), [
      "gemini:gemini-3.6-flash", "groq:openai/gpt-oss-120b", "openrouter:openrouter/free", "gemini:gemini-3.5-flash-lite", "groq:openai/gpt-oss-20b",
    ]);
    // Only providers with a key are used.
    assert.deepEqual(candidatesFor("chat", readAiConfig({ GROQ_API_KEY: "k" })).map((c) => c.provider), ["groq", "groq"]);
  });

  test("requests with the member's FITX data skip Gemini's free tier unless the owner allows it", async () => {
    const config = readAiConfig(KEYS);
    assert.ok(candidatesFor("meal_plan", config, { personalData: true }).every((c) => c.provider !== "gemini"), "people at Google may read free-tier prompts");
    assert.equal(candidatesFor("meal_plan", config, { personalData: true })[0].provider, "groq");
    assert.equal(candidatesFor("chat", config)[1].provider, "gemini", "questions without member data may still go to Gemini");
    const optedIn = readAiConfig({ ...KEYS, AI_GEMINI_WITH_MEMBER_DATA: "true" });
    assert.equal(candidatesFor("meal_plan", optedIn, { personalData: true })[0].provider, "gemini");
    assert.equal(canSendMemberData(readAiConfig({ GEMINI_API_KEY: "g" })), false);
    assert.equal(canSendMemberData(readAiConfig({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })), true);

    // Only Gemini connected: a request with member data is refused as "private", before any call.
    const { mock, router: ai } = router({ GEMINI_API_KEY: "test-gemini-key" }, () => geminiText('{"ok":true}'));
    assert.throws(() => ai.candidates("meal_plan", { personalData: true }), (error: unknown) => error instanceof AiUnavailableError && error.reason === "private");
    await assert.rejects(ai.json({ ...planRequest, personalData: true }, () => ({})), (error: unknown) => error instanceof AiUnavailableError && error.reason === "private");
    assert.equal(mock.calls.length, 0);
    assert.ok((await ai.json(planRequest, (value) => value)).value, "the same request without member data is answered");
  });

  test("a structured request stops trying more models when its time is up", async () => {
    let clock = 1_000_000;
    const { mock, router: ai } = router(KEYS, () => {
      clock += 9_000; // every model takes 9 s and answers badly
      return openAiText("not json");
    }, () => clock);
    await assert.rejects(ai.json({ ...planRequest, personalData: true }, () => null, { deadlineMs: 20_000 }), (error: unknown) => error instanceof AiUnavailableError);
    assert.ok(mock.calls.length < candidatesFor("meal_plan", readAiConfig(KEYS), { personalData: true }).length, `stopped after ${mock.calls.length} calls`);
  });

  test("Ollama is used only for a local URL, and never on Vercel", () => {
    assert.ok(readAiConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2" }).ollama);
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "https://my-tunnel.example.com", OLLAMA_MODEL: "llama3.2" }).ollama, null);
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2", VERCEL_ENV: "production" }).ollama, null);
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2", VERCEL_ENV: "preview" }).ollama, null);
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2", VERCEL: "1" }).ollama, null);
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "http://localhost:11434", OLLAMA_MODEL: "" }).ollama, null, "a model name is required");
    assert.equal(readAiConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2" }).ollama?.baseUrl, "http://127.0.0.1:11434/v1");
  });
});

describe("fallback", () => {
  test("moves on after a 429 and leaves that model alone for the Retry-After time", async () => {
    let clock = 1_000_000;
    const { mock, router: ai } = router(KEYS, (url) => (providerOf(url) === "groq" ? rateLimited(30) : geminiStream(["Hello", " there"])), () => clock);
    const pieces: string[] = [];
    const result = await ai.stream(chatRequest, { onDelta: (text) => pieces.push(text), onReset: quiet });
    assert.equal(result.provider, "gemini");
    assert.equal(result.text, "Hello there");
    assert.deepEqual(pieces, ["Hello", " there"]);
    assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["rate_limited", "ok"]);

    const before = mock.calls.length;
    await ai.stream(chatRequest, { onDelta: quiet, onReset: quiet });
    assert.equal(providerOf(mock.calls[before].url), "gemini", "the rate-limited Groq model is skipped");

    clock += 31_000;
    const after = mock.calls.length;
    await ai.stream(chatRequest, { onDelta: quiet, onReset: quiet });
    assert.equal(providerOf(mock.calls[after].url), "groq", "tried again once Retry-After has passed");
  });

  test("moves on after a 5xx, a network error and a timeout", async () => {
    const { router: ai } = router(KEYS, (url, body) => {
      if (providerOf(url) === "gemini" && String(url).includes("gemini-3.6-flash")) return serverError;
      if (providerOf(url) === "groq" && body?.model === "openai/gpt-oss-120b") return { networkError: true };
      if (providerOf(url) === "openrouter") return { hang: true };
      return geminiText('{"ok": true}');
    });
    const result = await ai.json(planRequest, (value) => (value && typeof value === "object" && (value as { ok?: boolean }).ok ? value : null), { attemptTimeoutMs: 300 });
    assert.equal(result.provider, "gemini");
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["unavailable", "unavailable", "timeout", "ok"]);
  });

  test("moves on when a structured answer is not valid JSON or does not fit", async () => {
    const { router: ai } = router(KEYS, (url, body) => {
      if (String(url).includes("gemini-3.6-flash")) return geminiText("Sure! Here is your plan: breakfast...");
      if (body?.model === "openai/gpt-oss-120b") return openAiText('{"something": "else"}');
      return openAiText('```json\n{"ok": true}\n```');
    });
    const result = await ai.json(planRequest, (value) => ((value as { ok?: boolean }).ok === true ? value : null));
    assert.equal(result.provider, "openrouter");
    assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["invalid_response", "invalid_response", "ok"]);
  });

  test("says 'at capacity' with a retry time when nothing answers, and never invents a reply", async () => {
    const { router: ai } = router(KEYS, (url) => (providerOf(url) === "gemini" ? geminiQuotaPerDay : rateLimited(120)));
    await assert.rejects(ai.stream(chatRequest, { onDelta: quiet, onReset: quiet }), (error: unknown) => {
      assert.ok(error instanceof AiUnavailableError);
      assert.equal(error.reason, "at_capacity");
      assert.equal(error.retryAt, 1_000_000 + 120_000, "the earliest model to come back");
      assert.equal(error.attempts.length, 5);
      return true;
    });
  });

  test("a refusal from every provider is reported as refused", async () => {
    const { router: ai } = router({ GEMINI_API_KEY: "k" }, () => ({ json: { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] } }));
    await assert.rejects(ai.json(planRequest, () => ({})), (error: unknown) => error instanceof AiUnavailableError && error.reason === "refused");
  });

  test("a stream that breaks mid-answer is reset and answered by the next model", async () => {
    const { router: ai } = router(KEYS, (url) =>
      providerOf(url) === "groq" ? { ...openAiStream(["Half an ans"]), breakAfterSse: true, sse: [JSON.stringify({ choices: [{ delta: { content: "Half an ans" } }] })] } : geminiStream(["A full answer."]),
    );
    const events: string[] = [];
    const result = await ai.stream(chatRequest, { onDelta: (text) => events.push(`delta:${text}`), onReset: () => events.push("reset") });
    assert.deepEqual(events, ["delta:Half an ans", "reset", "delta:A full answer."]);
    assert.equal(result.text, "A full answer.");
  });

  test("the member leaving stops the request instead of trying more providers", async () => {
    const controller = new AbortController();
    const { mock, router: ai } = router(KEYS, () => ({ hang: true }));
    const pending = ai.stream(chatRequest, { onDelta: quiet, onReset: quiet, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending);
    assert.equal(mock.calls.length, 1);
  });
});

describe("JSON replies", () => {
  test("reads fenced or wrapped JSON", () => {
    assert.deepEqual(parseJsonText('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonText('Here you go: {"a":1} enjoy'), { a: 1 });
    assert.throws(() => parseJsonText("no json here"));
  });
});
