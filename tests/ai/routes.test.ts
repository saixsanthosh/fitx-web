import "./support/hooks.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeCoachDb } from "./support/fake-coach-db.ts";
import { geminiStream, geminiText, mockFetch, openAiStream, openAiText, providerOf, rateLimited, type MockReply } from "./support/mock-providers.ts";

const db = await new FakeCoachDb().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = db.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;
delete process.env.USDA_API_KEY;
const KEYS = { GEMINI_API_KEY: "test-gemini", GROQ_API_KEY: "test-groq", OPENROUTER_API_KEY: "test-openrouter" };

// Provider and food-data hosts answer from mocks; the fake database is reached for real.
let route: (url: string, body: Record<string, unknown> | null) => MockReply = () => ({ status: 500 });
const providers = mockFetch((url, body) => route(url, body));
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|openfoodfacts\.org|api\.nal\.usda\.gov/.test(url)) return providers.fetch(url, init);
  return realFetch(input, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const chat = await import("@/app/api/coach/chat/route");
const swap = await import("@/app/api/coach/swap/route");
const actions = await import("@/app/api/coach/actions/[id]/route");
const consent = await import("@/app/api/coach/consent/route");
const data = await import("@/app/api/coach/data/route");
const status = await import("@/app/api/coach/status/route");
const threadRoute = await import("@/app/api/coach/threads/[id]/route");
const { sharedCooldowns } = await import("@/lib/ai/cooldown");
const { runCoachTurn } = await import("@/lib/ai/coach");
const { readAiConfig } = await import("@/lib/ai/config");
const { buildCatalogue } = await import("@/lib/ai/food-catalogue");
const { createClient } = await import("@supabase/supabase-js");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const TEEN = "22222222-2222-4222-8222-222222222222";
const SITE = "https://fitnessx.vercel.app";

function request(path: string, { method = "POST", body, user = MEMBER, site = "same-origin" }: { method?: string; body?: unknown; user?: string | null; site?: string } = {}) {
  return new NextRequest(new URL(path, SITE), {
    method,
    headers: {
      host: "fitnessx.vercel.app",
      "x-forwarded-proto": "https",
      "sec-fetch-site": site,
      ...(user ? { cookie: `sb-127-auth-token=${db.session(user)}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Stream = Array<Record<string, unknown> & { type: string }>;
async function events(response: Response): Promise<Stream> {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown> & { type: string });
}
async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}
type MessageEvent = { message: { id: string; role: string; content: string; data: { notes?: string[]; plan?: unknown } | null }; actions: Array<{ id: string; kind: string }> };
const messageOf = (stream: Stream) => stream.find((event) => event.type === "message") as unknown as MessageEvent | undefined;
type MealPlanView = {
  meals: Array<{ name: string; items: Array<{ name: string; basis: string; actionId: string; portion: string; calories: number }>; actionId: string | null }>;
  checks: string[];
  budget: string;
  target: { calories: number };
  totals: { calories: number };
};
const planOf = (stream: Stream) => messageOf(stream)?.message.data?.plan as MealPlanView | undefined;
const systemOf = (call: { body: Record<string, unknown> | null } | undefined) => String((call?.body?.messages as Array<{ content: string }> | undefined)?.[0]?.content ?? "");
const threadOf = (stream: Stream) => (stream[0] as unknown as { threadId: string }).threadId;
const statusOf = async (user = MEMBER) =>
  (await (await status.GET(request("/api/coach/status", { method: "GET", user }))).json()) as {
    state: string;
    consent: { shareData: boolean } | null;
    threads: unknown[];
    quotas: Array<{ kind: string; used: number }>;
    providers: Array<{ id: string; name: string; dataUse: string }>;
    sharedSummary: string[];
    memberDataAvailable: boolean;
  };

/** Groq answers every structured request with `value`; food lookups find nothing. */
const groqJson = (value: unknown) => (url: string): MockReply =>
  providerOf(url) === "groq" ? openAiText(JSON.stringify(value)) : providerOf(url) === "other" ? { json: { products: [] } } : { status: 500 };

function seedMember(userId = MEMBER, age = 29) {
  db.rows("profiles").push({ id: userId, age, gender: "female", height: 162, weight: 60, name: "Private Name", email: "private@example.test" });
  db.rows("user_preferences").push({
    user_id: userId, timezone: "Asia/Kolkata", primary_goal: "muscle_gain", activity_level: "moderate", workout_location: "home",
    equipment: ["dumbbell", "bodyweight"], fitness_level: "beginner", session_duration_minutes: 40, workouts_per_week: 3,
    dietary_preferences: ["Vegetarian"], allergies: ["Peanuts"], meals_per_day: 3,
  });
  db.rows("meals").push({ user_id: userId, date: new Date().toISOString().slice(0, 10), meal: "Breakfast", food_name: "Upma", calories: 250, protein: 5, carbs: 45, fat: 6 });
}
function consentTo(userId = MEMBER, share = true) {
  db.rows("ai_coach_consents").push({ user_id: userId, share_personal_data: share, consented_at: new Date().toISOString() });
}
function setKeys(keys: Record<string, string> = KEYS) {
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_COACH_ENABLED", "AI_GEMINI_WITH_MEMBER_DATA"]) delete process.env[name];
  Object.assign(process.env, keys);
}

const MEAL_PLAN = {
  title: "High-protein vegetarian day",
  summary: "Built around foods you already eat.",
  meals: [
    { name: "Breakfast", items: [
      { name: "Idli", search: "idli", quantity: 3, unit: "piece", grams: 114, calories: 146, protein: 7, carbs: 28, fat: 0.4, cost: "low", brand: "", note: "" },
      { name: "Sambar", search: "sambar", quantity: 1, unit: "cup", grams: 248, calories: 213, protein: 11, carbs: 29, fat: 7, cost: "low", brand: "", note: "" },
      { name: "Peanut chutney", search: "peanut chutney", quantity: 2, unit: "tbsp", grams: 30, calories: 150, protein: 6, carbs: 5, fat: 12, cost: "low", brand: "", note: "" },
    ] },
    { name: "Lunch", items: [
      { name: "Rice", search: "cooked white rice", quantity: 200, unit: "g", grams: 200, calories: 260, protein: 5, carbs: 56, fat: 0.6, cost: "low", brand: "", note: "" },
      { name: "Dal", search: "dal", quantity: 1, unit: "katori", grams: 180, calories: 260, protein: 15, carbs: 34, fat: 8, cost: "low", brand: "", note: "" },
      { name: "Ragi mudde", search: "ragi mudde", quantity: 1, unit: "piece", grams: 150, calories: 170, protein: 4, carbs: 36, fat: 1, cost: "low", brand: "", note: "" },
    ] },
  ],
  tips: ["Soak the dal overnight."],
};

before(() => {
  db.addUser(MEMBER, "member@example.test");
  db.addUser(TEEN, "teen@example.test");
});
beforeEach(() => {
  db.reset();
  sharedCooldowns.clear();
  providers.calls.length = 0;
  setKeys();
  route = () => ({ status: 500 });
});
after(async () => {
  globalThis.fetch = realFetch;
  await db.stop();
});

describe("POST /api/coach/chat: the gate", () => {
  test("refuses other sites, signed-out visitors and bad bodies", async () => {
    assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: "hi" }, site: "cross-site" }))).status, 403);
    assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: "hi" }, user: null }))).status, 401);
    assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: "" } }))).status, 400);
    assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: "x".repeat(2001) } }))).status, 400);
    assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: "hi", threadId: "not-a-uuid" } }))).status, 400);
    assert.equal(providers.calls.length, 0);
  });

  test("honest states: not set up, paused, not migrated, no consent", async () => {
    seedMember();
    setKeys({});
    consentTo();
    const notSetUp = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(notSetUp.status, 503);
    assert.equal((await errorOf(notSetUp)).code, "not_configured");
    assert.equal(db.usage.length, 0, "nothing taken from the limit");

    setKeys({ ...KEYS, AI_COACH_ENABLED: "false" });
    const paused = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal((await errorOf(paused)).code, "paused");

    setKeys();
    db.tables.delete("ai_coach_consents");
    const noConsent = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(noConsent.status, 409);

    db.coachMissing = true;
    const missing = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(missing.status, 503);
    assert.equal((await errorOf(missing)).code, "not_available");
    assert.equal(providers.calls.length, 0);
  });

  test("the limit is enforced before any provider is called", async () => {
    seedMember();
    consentTo();
    db.limits.chat = 0;
    const response = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    assert.match((await errorOf(response)).message, /for the last 24 hours/);
    assert.equal(providers.calls.length, 0);
  });
});

describe("POST /api/coach/chat: answers", () => {
  test("streams a reply grounded in the member's data, without their name, email or ids", async () => {
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["You logged ", "250 kcal so far."]) : { status: 500 });
    const response = await chat.POST(request("/api/coach/chat", { body: { message: "How am I doing today?" } }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
    assert.equal(response.headers.get("cache-control"), "private, no-store, no-transform");
    const stream = await events(response);
    assert.deepEqual(stream.map((event) => event.type), ["thread", "delta", "delta", "message", "done"]);
    const message = (stream[3] as unknown as { message: { role: string; content: string; provider: string } }).message;
    assert.equal(message.role, "assistant");
    assert.equal(message.content, "You logged 250 kcal so far.");
    assert.equal(message.provider, "Groq");
    assert.deepEqual((stream[4] as unknown as { quota: { used: number; limit: number } }).quota.used, 1);

    const sent = JSON.stringify(providers.calls[0].body);
    assert.ok(sent.includes("<fitx_data>") && sent.includes("muscle_gain") && sent.includes("Upma"));
    assert.ok(!sent.includes("Private Name") && !sent.includes("private@example.test") && !sent.includes(MEMBER), "no name, email or account id");
    assert.ok(sent.includes("<member_message>\\nHow am I doing today?\\n</member_message>"));
    // The member's own words are requests to follow, within the safety rules (not text to ignore).
    assert.match(systemOf(providers.calls[0]), /<member_message>, <member_request> and <member_note> is the member's own request: follow it/);
    assert.equal(db.rows("ai_coach_messages").length, 2);
    assert.equal(db.rows("ai_coach_threads")[0].title, "How am I doing today?");
  });

  test("members who chose 'questions only' send no FITX data", async () => {
    seedMember();
    consentTo(MEMBER, false);
    route = () => openAiStream(["General answer."]);
    await events(await chat.POST(request("/api/coach/chat", { body: { message: "Is creatine safe?" } })));
    const sent = JSON.stringify(providers.calls[0].body);
    assert.ok(sent.includes("chose not to share"));
    assert.ok(!sent.includes("Upma") && !sent.includes("muscle_gain"));
  });

  test("with only Gemini connected, “Use my FITX data” says why it can't answer, and “Questions only” still works", async () => {
    setKeys({ GEMINI_API_KEY: "test-gemini" });
    seedMember();
    consentTo();
    const personal = await chat.POST(request("/api/coach/chat", { body: { message: "How am I doing?" } }));
    assert.equal(personal.status, 409);
    const error = await errorOf(personal);
    assert.equal(error.code, "plans_unavailable");
    assert.match(error.message, /only sends your data to AI services that don't let people read it/);
    assert.equal(providers.calls.length, 0, "member data never went to Gemini's free tier");
    assert.equal(db.usage.length, 0);

    const view = await statusOf();
    assert.equal(view.memberDataAvailable, false);
    assert.match(view.providers[0].dataUse, /only “Questions only” requests/);
    assert.match(view.providers[0].dataUse, /people at Google may read them/);

    db.rows("ai_coach_consents")[0].share_personal_data = false;
    route = (url) => (providerOf(url) === "gemini" ? geminiStream(["Creatine is well studied."]) : { status: 500 });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Is creatine safe?" } })));
    assert.equal(messageOf(stream)?.message.content, "Creatine is well studied.");
    assert.ok(!JSON.stringify(providers.calls[0].body).includes("Upma"));
  });

  test("at capacity: an honest error, the request does not count and no half conversation is kept", async () => {
    seedMember();
    consentTo();
    route = () => rateLimited(90);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "hi" } })));
    assert.deepEqual(stream.map((event) => event.type), ["thread", "error"]);
    const error = stream[1] as unknown as { code: string; retryAt: string };
    assert.equal(error.code, "at_capacity");
    assert.ok(Date.parse(error.retryAt) > Date.now());
    assert.equal(db.rows("ai_coach_threads").length, 0);
    assert.equal(db.rows("ai_coach_messages").length, 0);
    assert.ok(db.usage.every((event) => event.released), "handed back");
  });

  test("a crisis message gets FITX's safety note, never a model reply, and never reaches a model later", async () => {
    seedMember();
    consentTo();
    route = () => openAiStream(["Protein and carbs after training help."]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "I want to die, nothing helps" } })));
    assert.deepEqual(stream.map((event) => event.type), ["thread", "message", "done"]);
    const note = messageOf(stream)!.message;
    assert.equal(note.role, "safety");
    assert.match(note.content, /14416/);
    assert.equal(providers.calls.length, 0);
    assert.equal(db.usage.length, 0);

    // The next message in the same conversation goes to a model without the stopped one or FITX's note.
    await events(await chat.POST(request("/api/coach/chat", { body: { message: "What should I eat after training?", threadId: threadOf(stream) } })));
    const messages = providers.calls[0].body?.messages as Array<{ role: string; content: string }>;
    const history = JSON.stringify(messages.slice(1));
    assert.ok(history.includes("What should I eat after training?"));
    assert.ok(!history.includes("want to die"), "the stopped message is not sent");
    assert.ok(!history.includes("You deserve support"), "FITX's safety note is not sent");
  });

  test("a crisis message in Hindi or Hinglish gets the same safety note", async () => {
    seedMember();
    consentTo();
    route = () => openAiStream(["should not be called"]);
    for (const message of ["mujhe marna hai, kuch theek nahi", "मैं मरना चाहता हूँ"]) {
      const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message } })));
      assert.equal(messageOf(stream)?.message.role, "safety", message);
    }
    assert.equal(providers.calls.length, 0);
  });

  test("members under 18: no plans, and the coach is told to use teen rules without their data", async () => {
    seedMember(TEEN, 16);
    consentTo(TEEN, true);
    const plan = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" }, user: TEEN }));
    assert.equal(plan.status, 409);
    route = () => openAiStream(["Eat regular meals."]);
    await events(await chat.POST(request("/api/coach/chat", { body: { message: "Make me a diet plan to lose weight" }, user: TEEN })));
    const sent = JSON.stringify(providers.calls[0].body);
    assert.ok(sent.includes("under 18"));
    assert.ok(!sent.includes("Upma"));
    assert.equal(db.rows("ai_coach_messages").find((row) => row.role === "user")?.task, "chat", "not upgraded to a plan");
  });

  test("a question that only looks like a plan request is still answered once the plan limit is used up", async () => {
    seedMember();
    consentTo();
    db.limits.plan = 0;
    route = () => openAiStream(["Dal, rice and curd make an easy day."]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "What should I eat today?" } })));
    assert.ok(!stream.some((event) => event.type === "task"), "answered as a question");
    assert.equal(messageOf(stream)?.message.content, "Dal, rice and curd make an easy day.");
    assert.equal(db.usage.filter((event) => event.kind === "chat").length, 1, "from the message limit");
    const asked = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } }));
    assert.equal(asked.status, 429);
    assert.match((await errorOf(asked)).message, /plans for the last 24 hours/);
  });
});

describe("meal plans, Add to My Food Plan and swaps", () => {
  async function makePlan(plan: unknown = MEAL_PLAN) {
    seedMember();
    consentTo();
    route = groqJson(plan);
    return events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan", budget: "₹200" } })));
  }

  test("a plan is checked against the member's allergies and FITX's food data before it is shown", async () => {
    const stream = await makePlan();
    assert.deepEqual(stream.map((event) => event.type).filter((type) => type !== "status"), ["thread", "task", "message", "done"]);
    const proposed = messageOf(stream)!.actions;
    const plan = planOf(stream)!;
    const names = plan.meals.flatMap((meal) => meal.items.map((item) => item.name));
    assert.ok(!names.includes("Peanut chutney"), "the peanut item is removed");
    assert.ok(plan.checks.some((check) => check.includes("Peanut chutney") && check.includes("allergy")));
    assert.ok(plan.checks.some((check) => /checks food names against your allergies, not full recipes\. Check ingredients and labels for peanuts/.test(check)));
    const idli = plan.meals[0].items.find((item) => item.name === "Idli")!;
    assert.equal(idli.basis, "database");
    assert.equal(idli.portion, "3 pieces (114 g)");
    const ragi = plan.meals[1].items.find((item) => item.name === "Ragi mudde")!;
    assert.equal(ragi.basis, "ai_estimate");
    assert.ok(plan.checks.some((check) => check.includes("estimate")));
    assert.equal(plan.budget, "₹200");
    const proteinNote = plan.checks.find((check) => check.startsWith("Protein comes to about"));
    assert.ok(proteinNote, "an honest protein note when the plan falls short");
    assert.ok(!/eggs|chicken|fish/.test(proteinNote), "suggestions respect the vegetarian diet");
    assert.ok(plan.target.calories > 1200);
    assert.ok(plan.totals.calories >= 1200, "never under the member's minimum");
    assert.equal(proposed.filter((action) => action.kind === "food").length, 5);
    assert.equal(proposed.filter((action) => action.kind === "meal").length, 2);
    assert.equal(db.rows("ai_coach_actions").length, 7);
    assert.ok(JSON.stringify(providers.calls.find((call) => providerOf(call.url) === "groq")?.body).includes("₹200"));
  });

  test("plans carry the member's data, so they skip Gemini's free tier, and Groq gets the plan's JSON schema", async () => {
    assert.ok(planOf(await makePlan()));
    assert.equal(providers.calls.filter((call) => providerOf(call.url) === "gemini").length, 0, "no member data goes to Gemini's free tier");
    const groq = providers.calls.find((call) => providerOf(call.url) === "groq")!;
    assert.equal(groq.body?.model, "openai/gpt-oss-120b");
    const format = groq.body?.response_format as { type: string; json_schema: { name: string; schema: { properties: Record<string, unknown> } } };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.name, "meal_plan");
    assert.ok("meals" in format.json_schema.schema.properties);
    const system = systemOf(groq);
    assert.match(system, /Reply with only one JSON object in exactly this shape/, "models without schema support still see the shape");
    assert.match(system, /is the member's own request: follow it/);
  });

  test("the owner can let Gemini answer plans (AI_GEMINI_WITH_MEMBER_DATA=true), and then it gets its response schema", async () => {
    setKeys({ ...KEYS, AI_GEMINI_WITH_MEMBER_DATA: "true" });
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "gemini" ? geminiText(JSON.stringify(MEAL_PLAN)) : { status: 500 });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } })));
    assert.ok(planOf(stream));
    assert.ok(JSON.stringify(providers.calls.find((call) => providerOf(call.url) === "gemini")?.body).includes("responseSchema"));
    const gemini = (await statusOf()).providers.find((provider) => provider.id === "gemini")!;
    assert.doesNotMatch(gemini.dataUse, /Questions only/);
    assert.match(gemini.dataUse, /people at Google may read them/);
  });

  test("Add to My Food Plan creates exactly one custom food with its value basis, idempotently, and never logs a meal", async () => {
    const plan = planOf(await makePlan())!;
    const actionId = plan.meals[0].items[0].actionId;
    const mealsBefore = db.rows("meals").length;
    const first = await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" } }), params(actionId));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: "applied", kind: "food", refId: db.rows("custom_foods")[0].id, already: false });
    const second = await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" } }), params(actionId));
    assert.equal(((await second.json()) as { already: boolean }).already, true);
    const row = db.rows("custom_foods")[0];
    assert.equal(db.rows("custom_foods").length, 1);
    assert.equal(row.name, "Idli");
    assert.equal(row.serving_grams, 114);
    assert.equal(row.value_basis, "recipe_calculated", "USDA FNDDS values, in Nutrition v2's words");
    assert.equal(row.source_ref, "2708346");
    assert.equal(db.rows("meals").length, mealsBefore, "no meal logged");
    // Archived in Nutrition: pressing the button again adds it back.
    row.archived_at = new Date().toISOString();
    const again = await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" } }), params(actionId));
    assert.equal(((await again.json()) as { already: boolean }).already, false);
    assert.equal(db.rows("custom_foods").length, 2);
    // Another site cannot press the button for the member.
    assert.equal((await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" }, site: "cross-site" }), params(actionId))).status, 403);
  });

  test("Can't afford this? proposes a checked swap with similar calories and protein", async () => {
    const plan = planOf(await makePlan())!;
    const rice = plan.meals[1].items.find((item) => item.name === "Rice")!;
    route = groqJson({ options: [
      { name: "Peanut rice", search: "peanut rice", quantity: 200, unit: "g", grams: 200, calories: 300, protein: 8, carbs: 50, fat: 9, cost: "low", why: "Cheap." },
      { name: "Broken wheat upma", search: "upma", quantity: 250, unit: "g", grams: 250, calories: 218, protein: 5, carbs: 35, fat: 6.6, cost: "low", why: "Cheaper than rice where you live." },
    ] });
    const response = await swap.POST(request("/api/coach/swap", { body: { actionId: rice.actionId, note: "Rice is expensive this week" } }));
    assert.equal(response.status, 200);
    const result = (await response.json()) as { swap: { replaces: string; item: { name: string; calories: number; actionId: string }; note: string }; quota: { used: number } };
    assert.equal(result.swap.replaces, rice.actionId);
    assert.equal(result.swap.item.name, "Broken wheat upma", "the peanut option is filtered out");
    assert.ok(Math.abs(result.swap.item.calories - rice.calories) <= rice.calories * 0.2);
    assert.ok(db.rows("ai_coach_actions").some((row) => row.id === result.swap.item.actionId && (row.payload as { swap?: unknown }).swap));
    assert.match(JSON.stringify(providers.calls.at(-1)?.body), /Rice is expensive this week/);
    assert.equal(providers.calls.filter((call) => providerOf(call.url) === "gemini").length, 0);
  });

  test("a day under the member's minimum is never shown: FITX says so, and saves nothing", async () => {
    const item = (name: string, search: string, quantity: number, grams: number, calories: number, protein: number, carbs: number, fat: number) =>
      ({ name, search, quantity, unit: "piece", grams, calories, protein, carbs, fat, cost: "low", brand: "", note: "" });
    // Counted foods only (pieces can't be resized): about 950 kcal against a 1,200 kcal minimum.
    const low = { title: "Light day", summary: "Small meals.", tips: [], meals: [
      { name: "Breakfast", items: [item("Idli", "idli", 4, 152, 195, 9, 38, 0.5)] },
      { name: "Lunch", items: [item("Roti", "roti", 3, 120, 360, 12, 60, 9)] },
      { name: "Snack", items: [item("Banana", "banana", 2, 236, 210, 2.6, 54, 0.8)] },
      { name: "Dinner", items: [item("Apple", "apple", 2, 364, 190, 1, 50, 0.6)] },
    ] };
    const stream = await makePlan(low);
    const error = stream.find((event) => event.type === "error") as unknown as { code: string; message: string } | undefined;
    assert.equal(error?.code, "failed");
    assert.match(error.message, /under the 1,200 kcal FITX plans for at least\. Nothing was saved/);
    assert.equal(db.rows("ai_coach_actions").length, 0);
    assert.equal(db.rows("ai_coach_threads").length, 0);
    assert.ok(db.usage.every((event) => event.released), "the plan is handed back");
  });

  test("after FITX's eating-disorder note, meal plans and swaps pause and calorie numbers stay out of the prompt", async () => {
    const plan = planOf(await makePlan())!;
    const rice = plan.meals[1].items.find((item) => item.name === "Rice")!;
    providers.calls.length = 0;
    const noted = await events(await chat.POST(request("/api/coach/chat", { body: { message: "I make myself throw up after meals" } })));
    assert.equal(messageOf(noted)?.message.role, "safety");
    assert.match(messageOf(noted)!.message.content, /For the next 30 days FITX Coach won't make meal plans or swaps/);
    assert.equal(providers.calls.length, 0);

    const asked = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } }));
    assert.equal(asked.status, 409);
    const error = await errorOf(asked);
    assert.equal(error.code, "plans_unavailable");
    assert.match(error.message, /30 days/);
    const swapped = await swap.POST(request("/api/coach/swap", { body: { actionId: rice.actionId, note: null } }));
    assert.equal(swapped.status, 409);

    route = () => openAiStream(["Regular meals and rest help."]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "What should I eat today?" } })));
    assert.ok(!stream.some((event) => event.type === "task"), "answered gently as a question, not as a plan");
    const system = systemOf(providers.calls.at(-1));
    assert.match(system, /can be a sign of an eating disorder/);
    assert.doesNotMatch(system, /daily_targets|average_per_logged_day|weight_trend|by_day/);
    assert.doesNotMatch(system, /you averaged 1,850 kcal/);
    // Workouts are still offered: the note is about food.
    assert.equal(db.usage.filter((event) => event.kind === "plan" && !event.released).length, 1, "only the first plan counted");
  });

  test("pregnancy or a medical condition stops FITX making plans, with the reason", async () => {
    seedMember();
    consentTo();
    route = () => openAiStream(["Walking is usually fine."]);
    const first = await events(await chat.POST(request("/api/coach/chat", { body: { message: "I'm pregnant. Is walking OK?" } })));
    assert.ok(messageOf(first)?.message.data?.notes?.some((note) => /midwife/.test(note)), "FITX's own reminder under the reply");
    const workout = await chat.POST(request("/api/coach/chat", { body: { message: "Plan a workout", mode: "workout_plan", threadId: threadOf(first) } }));
    assert.equal(workout.status, 409);
    assert.match((await errorOf(workout)).message, /doctor or midwife/);
    const kidney = await chat.POST(request("/api/coach/chat", { body: { message: "I have kidney disease. Plan my meals.", mode: "meal_plan" } }));
    assert.equal(kidney.status, 409);
    assert.match((await errorOf(kidney)).message, /registered dietitian/);
    assert.equal(db.usage.filter((event) => event.kind === "plan").length, 0, "nothing taken from the plan limit");
  });
});

describe("workouts, history, consent and deleting data", () => {
  test("workout suggestions only use exercise-library ids that fit the member's equipment", async () => {
    seedMember();
    consentTo();
    const library = [
      ["push_up", "Push-Up", "chest", ["bodyweight"], ["home", "gym"]],
      ["goblet_squat", "Goblet Squat", "quadriceps", ["dumbbell"], ["home", "gym"]],
      ["dumbbell_row", "Dumbbell Row", "back", ["dumbbell"], ["home", "gym"]],
      ["plank", "Plank", "core", ["bodyweight"], ["home", "gym"]],
      ["glute_bridge", "Glute Bridge", "glutes", ["bodyweight"], ["home", "gym"]],
      ["barbell_squat", "Barbell Squat", "quadriceps", ["barbell", "rack"], ["gym"]],
    ].map(([id, name, primary_muscle, equipment, locations]) => ({ id, name, primary_muscle, equipment, locations, difficulty: "beginner", is_active: true }));
    db.rows("exercise_library").push(...library);
    route = groqJson({ title: "Home full body", summary: "Balanced.", exercises: [
      { id: "goblet_squat", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 },
      { id: "barbell_squat", sets: 5, reps_min: 5, reps_max: 5, rest_seconds: 180 },
      { id: "push_up", sets: 3, reps_min: 8, reps_max: 15, rest_seconds: 60 },
      { id: "invented_move", sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 60 },
    ], tips: ["Warm up for 5 minutes."] });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan a workout", mode: "workout_plan" } })));
    const plan = messageOf(stream)!.message.data?.plan as { exercises: Array<{ exerciseId: string }>; actionId: string };
    assert.deepEqual(plan.exercises.map((exercise) => exercise.exerciseId), ["goblet_squat", "push_up"]);
    const prompt = systemOf(providers.calls.find((call) => providerOf(call.url) === "groq"));
    assert.ok(!prompt.includes("barbell_squat |"), "exercises needing missing equipment are never offered");
    const applied = await actions.POST(request(`/api/coach/actions/${plan.actionId}`, { body: { op: "apply" } }), params(plan.actionId));
    assert.equal(((await applied.json()) as { kind: string }).kind, "workout_plan");
    assert.equal(db.rows("workout_plans").length, 1);
  });

  test("an outdoor member gets exercises from Workouts' catalogue: outdoor counts as home, as Workouts does", async () => {
    seedMember();
    Object.assign(db.rows("user_preferences")[0], { workout_location: "outdoor", equipment: ["bodyweight"] });
    consentTo();
    // Curated catalogue rows (Workouts' clean-up): required equipment, and only home and gym as places.
    const curated = [
      ["push_up", "Push-Up", "chest", "chest", [], "reps"],
      ["bodyweight_squat", "Bodyweight Squat", "quadriceps", "quadriceps", [], "reps"],
      ["glute_bridge", "Glute Bridge", "glutes", "glutes", [], "reps"],
      ["plank", "Plank", "abdominals", "core", [], "time"],
      ["inverted_row", "Inverted Row", "lats", "back", ["pull_up_bar"], "reps"],
      ["barbell_back_squat", "Barbell Back Squat", "quadriceps", "quadriceps", ["barbell", "squat_rack"], "reps"],
    ].map(([id, name, primary_muscle, muscle_group, required_equipment, prescription_type]) => ({
      id, name, primary_muscle, muscle_group, required_equipment, prescription_type, category: "strength", mechanic: "compound",
      locations: ["home", "gym"], equipment: [], difficulty: "beginner", is_active: true, catalog_version: 1,
    }));
    db.rows("exercise_library").push(...curated);
    route = groqJson({ title: "Park session", summary: "Bodyweight only.", exercises: [
      { id: "push_up", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 60 },
      { id: "bodyweight_squat", sets: 3, reps_min: 12, reps_max: 15, rest_seconds: 60 },
      { id: "plank", sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 45, hold_seconds: 0 },
      { id: "barbell_back_squat", sets: 5, reps_min: 5, reps_max: 5, rest_seconds: 180 },
    ], tips: [] });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan a workout", mode: "workout_plan" } })));
    const plan = messageOf(stream)?.message.data?.plan as { location: string; exercises: Array<{ exerciseId: string; holdSeconds: number | null; equipment: string[] }> } | undefined;
    assert.ok(plan, "no “too few exercises” error");
    assert.deepEqual(plan.exercises.map((exercise) => exercise.exerciseId), ["push_up", "bodyweight_squat", "plank"]);
    assert.equal(plan.exercises[2].holdSeconds, 30, "a timed exercise keeps a hold time");
    assert.equal(plan.location, "outdoor");
    const prompt = systemOf(providers.calls.find((call) => providerOf(call.url) === "groq"));
    assert.ok(!prompt.includes("inverted_row |") && !prompt.includes("barbell_back_squat |"));
  });

  test("status, consent, history and 'delete my coach data'", async () => {
    seedMember();
    const before = await statusOf();
    assert.equal(before.state, "consent");
    assert.deepEqual(before.providers.map((provider) => provider.name), ["Google Gemini", "Groq", "OpenRouter"]);
    assert.ok(before.sharedSummary.some((line) => line.includes("peanuts")));
    assert.equal(before.memberDataAvailable, true);

    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    route = () => openAiStream(["Hi!"]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Hello coach" } })));
    const threadId = threadOf(stream);

    const view = (await (await threadRoute.GET(request(`/api/coach/threads/${threadId}`, { method: "GET" }), params(threadId))).json()) as { messages: Array<{ role: string }> };
    assert.deepEqual(view.messages.map((message) => message.role), ["user", "assistant"]);
    const ready = await statusOf();
    assert.equal(ready.state, "ready");
    assert.equal(ready.threads.length, 1);
    assert.equal(ready.quotas.find((quota) => quota.kind === "chat")?.used, 1);

    const deleted = await data.DELETE(request("/api/coach/data", { method: "DELETE" }));
    assert.equal(deleted.status, 200);
    assert.equal(db.rows("ai_coach_threads").length, 0);
    assert.equal(db.rows("ai_coach_messages").length, 0);
    assert.equal(db.rows("ai_coach_consents").length, 0);
    assert.equal((await threadRoute.GET(request(`/api/coach/threads/${threadId}`, { method: "GET" }), params(threadId))).status, 404);
  });

  test("while the coach is paused or has no key, a member who used it still gets their settings and can delete their data", async () => {
    seedMember();
    consentTo();
    db.rows("ai_coach_threads").push({ id: "33333333-3333-4333-8333-333333333333", user_id: MEMBER, title: "Old chat", created_at: db.now(), updated_at: db.now() });
    setKeys({ ...KEYS, AI_COACH_ENABLED: "false" });
    const paused = await statusOf();
    assert.equal(paused.state, "paused");
    assert.equal(paused.consent?.shareData, true);
    assert.equal(paused.threads.length, 1);
    setKeys({});
    const notSetUp = await statusOf();
    assert.equal(notSetUp.state, "not_configured");
    assert.ok(notSetUp.consent);
    assert.equal((await data.DELETE(request("/api/coach/data", { method: "DELETE" }))).status, 200);
    const afterDelete = await statusOf();
    assert.equal(afterDelete.consent, null);
    assert.equal(afterDelete.threads.length, 0);
    assert.equal(providers.calls.length, 0);
  });

  test("reopening a long conversation shows its newest 200 messages, oldest first", async () => {
    seedMember();
    consentTo();
    const threadId = "44444444-4444-4444-8444-444444444444";
    db.rows("ai_coach_threads").push({ id: threadId, user_id: MEMBER, title: "Long", created_at: db.now(), updated_at: db.now() });
    for (let index = 0; index < 205; index += 1) {
      db.rows("ai_coach_messages").push({ id: crypto.randomUUID(), user_id: MEMBER, thread_id: threadId, role: index % 2 ? "assistant" : "user", task: "chat", content: `Message ${index}`, data: null, provider: null, created_at: db.now() });
    }
    const view = (await (await threadRoute.GET(request(`/api/coach/threads/${threadId}`, { method: "GET" }), params(threadId))).json()) as { messages: Array<{ content: string }> };
    assert.equal(view.messages.length, 200);
    assert.equal(view.messages[0].content, "Message 5");
    assert.equal(view.messages.at(-1)?.content, "Message 204");
  });

  test("untimed To-Dos on the planner count in the coming week", async () => {
    seedMember();
    consentTo();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    db.rows("planner_events").push(
      { user_id: MEMBER, event_type: "task", status: "scheduled", starts_at: null, local_date: tomorrow, title: "Buy oats" },
      { user_id: MEMBER, event_type: "workout", status: "scheduled", starts_at: `${tomorrow}T12:30:00Z`, local_date: tomorrow, title: "Legs" },
    );
    route = () => openAiStream(["A busy week."]);
    await events(await chat.POST(request("/api/coach/chat", { body: { message: "What's coming up this week?" } })));
    const block = systemOf(providers.calls[0]).match(/<fitx_data>\n([\s\S]*?)\n<\/fitx_data>/)?.[1] ?? "{}";
    assert.deepEqual((JSON.parse(block) as { next_7_days: unknown }).next_7_days, { planned_workouts: 1, other_events: 1 });
  });

  test("an under-18 member cannot switch data sharing on", async () => {
    seedMember(TEEN, 15);
    await consent.POST(request("/api/coach/consent", { body: { shareData: true }, user: TEEN }));
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, false);
  });

  test("before the migration the status says 'not available yet'", async () => {
    seedMember();
    db.coachMissing = true;
    assert.equal((await statusOf()).state, "not_available");
  });
});

describe("time limits (the route may run for 60 seconds)", () => {
  const staples = JSON.parse(readFileSync(new URL("../../src/data/fitx-staples.json", import.meta.url), "utf8"));
  const foundation = JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8"));
  const catalogue = buildCatalogue(staples, foundation);
  const BRANDED = { ...MEAL_PLAN, meals: [...MEAL_PLAN.meals, { name: "Snack", items: [
    { name: "Spiced buttermilk", search: "buttermilk", quantity: 200, unit: "ml", grams: 200, calories: 30, protein: 2, carbs: 3, fat: 1, cost: "low", brand: "Amul", note: "" },
  ] }] };

  /** A database client signed in as the member, for calling the coach without the HTTP route. */
  function memberDb() {
    const cookie = db.session(MEMBER);
    const session = JSON.parse(Buffer.from(cookie.slice("base64-".length), "base64url").toString()) as { access_token: string };
    return createClient(db.url, "test-anon-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } });
  }

  /** One meal-plan turn where the model takes `modelMs`; returns the model's budget and how many live lookups ran. */
  async function planTurn(modelMs: number) {
    let now = 1_000_000;
    const budgets: number[] = [];
    let lookups = 0;
    const router = {
      candidates: () => [{ provider: "groq", model: "openai/gpt-oss-120b" }],
      stream: async () => {
        throw new Error("not used");
      },
      json: async (_request: unknown, parse: (value: unknown) => unknown, options: { deadlineMs?: number } = {}) => {
        budgets.push(options.deadlineMs ?? Number.NaN);
        now += modelMs;
        return { value: parse(BRANDED), provider: "groq", model: "openai/gpt-oss-120b", attempts: [] };
      },
    };
    const live = {
      openFoodFacts: async () => {
        lookups += 1;
        return [];
      },
      usda: async () => {
        lookups += 1;
        return [];
      },
    };
    const emitted: string[] = [];
    await runCoachTurn(
      { db: memberDb() as never, userId: MEMBER, config: readAiConfig(KEYS), router: router as never, catalogue: () => catalogue, live, clock: () => now },
      { threadId: null, message: "Plan my meals", mode: "meal_plan", budgetNote: null },
      (event) => emitted.push(event.type),
    );
    return { budgets, lookups, emitted };
  }

  test("the model gets what is left of 45 seconds, and live food lookups are skipped when time is short", async () => {
    seedMember();
    consentTo();
    const quick = await planTurn(1_000);
    assert.ok(quick.budgets[0] >= 15_000 && quick.budgets[0] <= 45_000, `model budget ${quick.budgets[0]} ms`);
    assert.ok(quick.lookups > 0, "with time left, the packaged food is looked up");
    assert.ok(quick.emitted.includes("message"));
    const slow = await planTurn(40_000);
    assert.equal(slow.lookups, 0, "with under 12 seconds left, FITX uses only its own food data");
    assert.ok(slow.emitted.includes("message"), "the plan is still shown");
  });
});

// Keeps this file's providers mocked even if another test file changed fetch.
test("no real provider was called", () => {
  assert.ok(providers.calls.every((call) => !call.headers.authorization || /test-/.test(call.headers.authorization)));
  assert.equal(openAiText("x").json !== undefined, true);
});
