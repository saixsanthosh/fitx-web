// Bug 2 (coach-help-1, BRIEF-3 D8): a few meal plans whose answers failed FITX's format check switched off the coach
// chat for every member, for 30 seconds and then up to 15 minutes. Only real availability failures may count towards
// a model's breaker; an answer that fails the check only sends that task to other models first, briefly, and a chat
// question is still tried while plans keep failing.
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch, openAiStream, openAiText, providerOf, rateLimited, serverError, type MockReply } from "./support/mock-providers.ts";

const { readAiConfig } = await import("@/lib/ai/config");
const { createAiRouter, AiUnavailableError, tryOrder } = await import("@/lib/ai/router");
const { createCooldownStore, failureReach, TASK_RETRY_LATER_MS } = await import("@/lib/ai/cooldown");
const { toCoachError } = await import("@/lib/ai/coach");

type Task = "chat" | "meal_plan" | "workout_plan" | "swap";
const OLLAMA = { OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "fitx-test" };
const GROQ = { GROQ_API_KEY: "test-groq-key" };
const quiet = () => {};
const ask = (task: Task) => ({
  task,
  system: `task:${task}`,
  messages: [{ role: "user" as const, content: "How long should I rest between sets?" }],
  maxOutputTokens: 256,
  temperature: 0.5,
  ...(task === "chat" ? {} : { json: { name: task, schema: { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] } } }),
});
const fits = (value: unknown) => (value && typeof value === "object" && (value as { ok?: unknown }).ok === true ? value : null);
const taskOf = (body: Record<string, unknown> | null) => String((body?.messages as Array<{ content: string }> | undefined)?.[0]?.content ?? "").replace("task:", "") as Task;

/** A router over `env` whose provider answers with `reply(task, model)`, on a clock the test moves. */
function setup(env: Record<string, string>, reply: (task: Task, model: string) => MockReply) {
  let clock = 1_000_000;
  const mock = mockFetch((_url, body) => reply(taskOf(body), String(body?.model ?? "")));
  const router = createAiRouter({ config: readAiConfig(env), fetch: mock.fetch, cooldowns: createCooldownStore(), now: () => clock, log: quiet });
  return {
    mock,
    router,
    tick: (ms: number) => { clock += ms; },
    chat: () => router.stream(ask("chat"), { onDelta: quiet, onReset: quiet }),
    plan: (task: Exclude<Task, "chat"> = "meal_plan") => router.json(ask(task), fits),
  };
}

describe("what a failed attempt means for later requests", () => {
  test("only availability failures reach the model; format failures reach the task; refusals nothing", () => {
    assert.equal(failureReach("timeout"), "model");
    assert.equal(failureReach("unavailable"), "model");
    assert.equal(failureReach("rate_limited"), "model");
    assert.equal(failureReach("invalid_response"), "task");
    assert.equal(failureReach("bad_request"), "task");
    assert.equal(failureReach("refused"), "request");
    assert.equal(failureReach("auth", true), "provider");
    assert.equal(failureReach("invalid_response", true), "provider", "the provider said its key or region is refused");
  });

  test("a model to retry later goes after the others, never out of the list", () => {
    assert.deepEqual(tryOrder(["a", "b", "c"], (name) => name === "a"), ["b", "c", "a"]);
    assert.deepEqual(tryOrder(["a"], () => true), ["a"], "the only model is still tried");
    assert.deepEqual(tryOrder(["a", "b"], () => false), ["a", "b"]);
  });
});

describe("answers that fail FITX's format check", () => {
  test("never stop a chat question or another member's workout, however many plans fail", async () => {
    const coach = setup(OLLAMA, (task) => (task === "chat" ? openAiStream(["Rest 1 to 2 minutes."]) : openAiText("Here is your plan: breakfast, lunch…")));
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await assert.rejects(coach.plan(), (error: unknown) => error instanceof AiUnavailableError && error.reason === "unusable");
      coach.tick(5_000);
    }
    const before = coach.mock.calls.length;
    const answer = await coach.chat();
    assert.equal(answer.text, "Rest 1 to 2 minutes.");
    assert.deepEqual(answer.attempts.map((attempt) => attempt.outcome), ["ok"], "the chat was tried, not skipped");
    assert.equal(coach.mock.calls.length, before + 1);
    // Another member, another task: tried at once (the model fails its check again, but it was asked).
    await assert.rejects(coach.plan("workout_plan"), (error: unknown) => error instanceof AiUnavailableError && error.reason === "unusable");
    assert.equal(coach.mock.calls.length, before + 2);
  });

  test("the same task tries the only model again: a failed check never blocks a plan either", async () => {
    let good = false;
    const coach = setup(OLLAMA, () => (good ? openAiText('{"ok": true}') : openAiText('{"something": "else"}')));
    for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(coach.plan());
    good = true;
    const result = await coach.plan();
    assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["ok"]);
  });

  test("with two models, only that task asks the other one first, and only for a short while", async () => {
    // Groq only: plans try gpt-oss-120b, then gpt-oss-20b; chat tries gpt-oss-20b, then gpt-oss-120b.
    const coach = setup(GROQ, (task, model) => {
      if (task === "chat") return openAiStream([`chat from ${model}`]);
      return model === "openai/gpt-oss-120b" ? openAiText("not json") : openAiText('{"ok": true}');
    });
    const first = await coach.plan();
    assert.deepEqual(first.attempts.map((attempt) => `${attempt.model}:${attempt.outcome}`), ["openai/gpt-oss-120b:invalid_response", "openai/gpt-oss-20b:ok"]);
    const second = await coach.plan();
    assert.deepEqual(second.attempts.map((attempt) => attempt.model), ["openai/gpt-oss-20b"], "the model that failed the check is asked after the other one");
    const swap = await coach.router.json(ask("swap"), fits);
    assert.equal(swap.attempts[0].model, "openai/gpt-oss-120b", "another task keeps its own order");
    coach.tick(TASK_RETRY_LATER_MS + 1);
    const later = await coach.plan();
    assert.equal(later.attempts[0].model, "openai/gpt-oss-120b", "after a short while it is first again");
  });

  test("a refusal leaves no trace for the next request", async () => {
    let refuse = true;
    const coach = setup(GROQ, () => (refuse ? { json: { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }] } } : openAiText('{"ok": true}')));
    await assert.rejects(coach.plan(), (error: unknown) => error instanceof AiUnavailableError && error.reason === "refused");
    refuse = false;
    const next = await coach.plan();
    assert.equal(next.attempts[0].model, "openai/gpt-oss-120b");
  });

  test("the coach says the answers failed its checks, with nothing to wait for, not that the services are busy", () => {
    const coachError = toCoachError(new AiUnavailableError("unusable", []));
    assert.equal(coachError.code, "at_capacity");
    assert.match(coachError.message, /answered, but their answers didn't pass FITX's checks/);
    assert.doesNotMatch(coachError.message, /busy/);
    assert.equal(coachError.retryAt, undefined);
  });
});

describe("availability failures", () => {
  test("still open the breaker after 3 in a row, and it doubles while they go on", async () => {
    const coach = setup(OLLAMA, () => serverError);
    for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(coach.plan());
    const calls = coach.mock.calls.length;
    await assert.rejects(coach.plan(), (error: unknown) => {
      assert.ok(error instanceof AiUnavailableError && error.reason === "at_capacity");
      assert.deepEqual(error.attempts.map((attempt) => attempt.outcome), ["skipped"]);
      assert.equal(error.retryAt, 1_000_000 + 30_000, "30 seconds after the third failure");
      return true;
    });
    assert.equal(coach.mock.calls.length, calls, "not asked while the breaker is open");
    coach.tick(30_001);
    await assert.rejects(coach.plan(), (error: unknown) => error instanceof AiUnavailableError && error.retryAt === 1_000_000 + 30_001 + 60_000);
  });

  test("while plans keep timing out or failing, one chat question is still tried, and waits only if it fails too", async () => {
    let chatWorks = true;
    const coach = setup(OLLAMA, (task) => (task === "chat" ? (chatWorks ? openAiStream(["Rest 1 to 2 minutes."]) : serverError) : serverError));
    for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(coach.plan());
    await assert.rejects(coach.plan(), (error: unknown) => error instanceof AiUnavailableError && error.attempts[0].outcome === "skipped");
    // The chat had not failed: it is tried, it answers, and that answer closes the breaker for everyone.
    const answer = await coach.chat();
    assert.equal(answer.text, "Rest 1 to 2 minutes.");
    const reopened = await coach.plan().catch((error: unknown) => error as InstanceType<typeof AiUnavailableError>);
    assert.equal(reopened.attempts[0].outcome, "unavailable", "plans are tried again after the model answered");

    // A provider that is really down: the chat's one try fails, and then the chat waits like the plans.
    chatWorks = false;
    for (let attempt = 0; attempt < 2; attempt += 1) await assert.rejects(coach.plan());
    const calls = coach.mock.calls.length;
    await assert.rejects(coach.chat(), (error: unknown) => error instanceof AiUnavailableError && error.attempts[0].outcome === "unavailable");
    assert.equal(coach.mock.calls.length, calls + 1);
    await assert.rejects(coach.chat(), (error: unknown) => error instanceof AiUnavailableError && error.attempts[0].outcome === "skipped");
    assert.equal(coach.mock.calls.length, calls + 1, "the second chat is not sent to a model that is down");
  });

  test("a provider's own wait (Retry-After) holds for every task", async () => {
    const coach = setup(GROQ, (task, model) => (model === "openai/gpt-oss-120b" ? rateLimited(45) : task === "chat" ? openAiStream(["From the other model."]) : openAiText('{"ok": true}')));
    await coach.plan();
    const answer = await coach.chat();
    assert.deepEqual(answer.attempts.map((attempt) => attempt.model), ["openai/gpt-oss-20b"]);
    const swap = await coach.router.json(ask("swap"), fits);
    assert.deepEqual(swap.attempts.map((attempt) => `${attempt.model}:${attempt.outcome}`), ["openai/gpt-oss-120b:skipped", "openai/gpt-oss-20b:ok"]);
    assert.ok(coach.mock.calls.every((call) => providerOf(call.url) === "groq"));
  });
});
