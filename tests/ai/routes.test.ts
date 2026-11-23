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
// These tests call one route many times in a row; the burst limits have their own tests (tests/unit/security-limits.test.ts).
const { configureRouteLimitsForTests } = await import("@/lib/security/rate-limit");
configureRouteLimitsForTests({ coachTurn: { limit: 10_000, windowMs: 60_000 } });
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
    minor: boolean;
    ageMissing: boolean;
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

  test("while the coach is not set up or paused, nobody is asked to agree and no consent is stored", async () => {
    seedMember();
    const ask = () => chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals for today" } }));
    const agree = (shareData: boolean) => consent.POST(request("/api/coach/consent", { body: { shareData } }));
    const swapFood = () => swap.POST(request("/api/coach/swap", { body: { actionId: "55555555-5555-4555-8555-555555555555" } }));
    setKeys({});
    for (const answer of [await ask(), await agree(true), await swapFood()]) {
      assert.equal(answer.status, 503);
      assert.equal((await errorOf(answer)).code, "not_configured", "the same answer as /api/coach/status, not consent_required");
    }
    assert.equal(db.rows("ai_coach_consents").length, 0, "no consent without the consent screen that names the AI services");

    setKeys({ ...KEYS, AI_COACH_ENABLED: "false" });
    for (const answer of [await ask(), await agree(true), await swapFood()]) assert.equal((await errorOf(answer)).code, "paused");
    assert.equal(db.rows("ai_coach_consents").length, 0);

    setKeys();
    assert.equal((await statusOf()).state, "consent", "once a service is set up, the member sees the consent screen first");
    assert.equal((await ask()).status, 409, "and the coach asks for consent");

    // Agreeing again after the profile lost its age: while not set up, the honest state, not the consent request.
    consentTo(MEMBER, true);
    db.rows("profiles")[0].age = null;
    setKeys({});
    assert.equal((await errorOf(await ask())).code, "not_configured");

    // A member who already agreed can still change sharing in Coach settings while the coach is not set up.
    db.rows("profiles")[0].age = 29;
    const changed = await agree(false);
    assert.equal(changed.status, 200);
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, false);
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

describe("POST /api/coach/chat and /api/coach/swap: bursts", () => {
  test("a burst over the per-minute limit is 429 before the quota or any provider is touched", async () => {
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["Fine."]) : { status: 500 });
    configureRouteLimitsForTests({ coachTurn: { limit: 2, windowMs: 60_000 } });
    try {
      for (let i = 0; i < 2; i += 1) assert.equal((await chat.POST(request("/api/coach/chat", { body: { message: `hi ${i}` } }))).status, 200);
      const calls = providers.calls.length;
      const limited = await chat.POST(request("/api/coach/chat", { body: { message: "one more" } }));
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
      assert.match((await errorOf(limited)).message, /sending messages quickly/);
      const swapped = await swap.POST(request("/api/coach/swap", { body: { actionId: "3b241101-e2bb-4255-8caf-4136c566a962" } }));
      assert.equal(swapped.status, 429, "swaps share the same burst limit");
      assert.equal(providers.calls.length, calls);
    } finally {
      configureRouteLimitsForTests({ coachTurn: { limit: 10_000, windowMs: 60_000 } });
    }
  });

  test("bodies that are too large, not JSON or not sent as JSON are refused as invalid", async () => {
    seedMember();
    consentTo();
    const tooLarge = await chat.POST(request("/api/coach/chat", { body: { message: "x".repeat(20_000) } }));
    assert.equal(tooLarge.status, 400);
    const asText = new NextRequest(new URL("/api/coach/chat", SITE), {
      method: "POST",
      headers: { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin", cookie: `sb-127-auth-token=${db.session(MEMBER)}`, "content-type": "text/plain" },
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal((await chat.POST(asText)).status, 400);
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

  test("after “Use my FITX data” is switched off, replies written from the member's data are not sent again", async () => {
    seedMember();
    consentTo();
    const answer = (text: string) => (url: string) => (providerOf(url) === "groq" ? openAiStream([text]) : { status: 500 });
    route = answer("You logged Poha, 250 kcal so far.");
    const first = await events(await chat.POST(request("/api/coach/chat", { body: { message: "How am I doing today?" } })));
    const threadId = (first[0] as unknown as { threadId: string }).threadId;
    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: false } }))).status, 200);

    route = answer("Creatine is well studied.");
    await events(await chat.POST(request("/api/coach/chat", { body: { threadId, message: "Is creatine safe?" } })));
    const questionsOnly = JSON.stringify(providers.calls.at(-1)?.body);
    assert.ok(questionsOnly.includes("Is creatine safe?"), "the question goes");
    assert.ok(questionsOnly.includes("chose not to share"));
    assert.ok(!questionsOnly.includes("250 kcal so far") && !questionsOnly.includes("How am I doing today?"), "the conversation from before the switch does not");
    assert.equal(db.rows("ai_coach_messages").length, 4, "the conversation itself is kept");

    route = answer("Keep it up.");
    await events(await chat.POST(request("/api/coach/chat", { body: { threadId, message: "And tomorrow?" } })));
    const later = JSON.stringify(providers.calls.at(-1)?.body);
    assert.ok(later.includes("Is creatine safe?") && later.includes("Creatine is well studied."), "messages after the switch still give context");
    assert.ok(!later.includes("250 kcal so far"));

    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    route = answer("Here is your week.");
    await events(await chat.POST(request("/api/coach/chat", { body: { threadId, message: "How was my week?" } })));
    const shared = JSON.stringify(providers.calls.at(-1)?.body);
    assert.ok(shared.includes("<fitx_data>") && shared.includes("250 kcal so far"), "switched back on, the summary and the whole recent conversation go");
  });

  test("an account whose profile turns under 18 is asked again, and nothing from before goes out", async () => {
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["You logged 250 kcal so far."]) : { status: 500 });
    const first = await events(await chat.POST(request("/api/coach/chat", { body: { message: "How am I doing today?" } })));
    const threadId = threadOf(first);
    providers.calls.length = 0;

    db.rows("profiles")[0].age = 16; // corrected in Profile
    const view = await statusOf();
    assert.equal(view.state, "consent", "the under-18 consent screen again");
    assert.equal(view.minor, true);
    const blocked = await chat.POST(request("/api/coach/chat", { body: { threadId, message: "And tomorrow?" } }));
    assert.equal(blocked.status, 409);
    const error = await errorOf(blocked);
    assert.equal(error.code, "consent_required");
    assert.match(error.message, /under 18/);
    assert.equal(providers.calls.length, 0, "nothing was sent");

    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, false, "under 18: questions only");
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["Sleep and regular meals help."]) : { status: 500 });
    await events(await chat.POST(request("/api/coach/chat", { body: { threadId, message: "How can I recover better?" } })));
    const sent = JSON.stringify(providers.calls.at(-1)?.body);
    assert.ok(sent.includes("How can I recover better?") && sent.includes("under 18"));
    assert.ok(!sent.includes("250 kcal so far") && !sent.includes("How am I doing today?"), "nothing from before the age change");
  });

  test("an account whose age is removed in Profile shares nothing and gets no plans until it adds one", async () => {
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["You logged 250 kcal so far."]) : { status: 500 });
    const first = await events(await chat.POST(request("/api/coach/chat", { body: { message: "How am I doing today?" } })));
    const threadId = threadOf(first);
    providers.calls.length = 0;

    db.rows("profiles")[0].age = null; // "or leave it empty" in Profile
    const view = await statusOf();
    assert.equal(view.state, "consent", "asked again, like an age corrected to under 18");
    assert.deepEqual([view.minor, view.ageMissing], [false, true]);
    const blocked = await chat.POST(request("/api/coach/chat", { body: { threadId, message: "And tomorrow?" } }));
    assert.equal(blocked.status, 409);
    const error = await errorOf(blocked);
    assert.equal(error.code, "consent_required");
    assert.match(error.message, /no longer has your age/);
    assert.equal(providers.calls.length, 0, "nothing was sent");

    // Whatever the request asks, the consent route stores "Questions only".
    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, false);
    const ready = await statusOf();
    assert.deepEqual([ready.state, ready.consent?.shareData, ready.ageMissing], ["ready", false, true]);
    const plan = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } }));
    assert.equal(plan.status, 409);
    assert.match((await errorOf(plan)).message, /Add your age in Profile/);
    route = (url) => (providerOf(url) === "groq" ? openAiStream(["Sleep and regular meals help."]) : { status: 500 });
    await events(await chat.POST(request("/api/coach/chat", { body: { threadId, message: "How can I recover better?" } })));
    const sent = JSON.stringify(providers.calls.at(-1)?.body);
    assert.ok(sent.includes("How can I recover better?") && sent.includes("chose not to share"));
    assert.ok(!sent.includes("Upma") && !sent.includes("weight_kg") && !sent.includes("250 kcal so far"), "no summary, and nothing from before");

    // With an adult age again, the member can turn sharing back on.
    db.rows("profiles")[0].age = 29;
    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, true);
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
    // What the consent route stores for an under-18 account, whatever it asked for.
    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true }, user: TEEN }))).status, 200);
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

  test("for 30 days after the note, a “Questions only” chat carries the care rule and never goes to Gemini", async () => {
    seedMember();
    consentTo(MEMBER, false);
    await events(await chat.POST(request("/api/coach/chat", { body: { message: "I make myself throw up after meals" } })));
    // Groq is down and Gemini would answer next, if it were asked at all.
    route = (url) => (providerOf(url) === "gemini" ? geminiStream(["From Gemini."]) : providerOf(url) === "openrouter" ? openAiStream(["Gentle answer."]) : { status: 500 });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "What helps me sleep better?" } })));
    assert.equal(messageOf(stream)?.message.content, "Gentle answer.");
    assert.ok(providers.calls.length > 0 && providers.calls.every((call) => providerOf(call.url) !== "gemini"), "Gemini got nothing");
    const system = systemOf(providers.calls.at(-1));
    assert.match(system, /can be a sign of an eating disorder/, "the care rule goes, as the privacy page says");
    assert.match(system, /chose not to share/, "and no summary");

    // With only Gemini connected, the coach says why it can't answer instead of sending the note there.
    setKeys({ GEMINI_API_KEY: "test-gemini" });
    providers.calls.length = 0;
    const blocked = await chat.POST(request("/api/coach/chat", { body: { message: "And what about stretching?" } }));
    assert.equal(blocked.status, 409);
    assert.match((await errorOf(blocked)).message, /For 30 days after FITX's note about eating, FITX sends your questions only to AI services that don't let people read them/);
    assert.equal(providers.calls.length, 0);
  });

  test("an eating-disorder note typed into a swap request starts the same 30 days", async () => {
    const plan = planOf(await makePlan())!;
    const rice = plan.meals[1].items.find((item) => item.name === "Rice")!;
    providers.calls.length = 0;
    const refused = await swap.POST(request("/api/coach/swap", { body: { actionId: rice.actionId, note: "I make myself throw up after meals" } }));
    assert.equal(refused.status, 422);
    assert.match((await errorOf(refused)).message, /For the next 30 days FITX Coach won't make meal plans or swaps/);
    assert.equal(providers.calls.length, 0, "the note never reached a model");
    assert.deepEqual(db.rows("ai_coach_safety_notes").map((row) => row.topic), ["eating_disorder"]);
    const asked = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } }));
    assert.equal(asked.status, 409, "as the note says");
    assert.match((await errorOf(asked)).message, /30 days/);
    assert.equal((await swap.POST(request("/api/coach/swap", { body: { actionId: rice.actionId, note: null } }))).status, 409);
  });

  test("deleting the conversation with the eating-disorder note doesn't end the 30 days; “Delete my coach data” does", async () => {
    seedMember();
    consentTo();
    const noted = await events(await chat.POST(request("/api/coach/chat", { body: { message: "I make myself throw up after meals" } })));
    assert.equal(messageOf(noted)?.message.role, "safety");
    const kept = db.rows("ai_coach_safety_notes");
    assert.deepEqual(kept.map((row) => [row.user_id, row.topic]), [[MEMBER, "eating_disorder"]]);
    // The fake database adds id and timestamps to every row; the app writes only these.
    assert.deepEqual(Object.keys(kept[0]).filter((key) => !["id", "created_at", "updated_at"].includes(key)).sort(), ["topic", "user_id"], "the topic and the time, not the member's words");
    assert.ok(!JSON.stringify(kept).includes("throw up"));

    assert.equal((await threadRoute.DELETE(request(`/api/coach/threads/${threadOf(noted)}`, { method: "DELETE" }), params(threadOf(noted)))).status, 200);
    assert.equal(db.rows("ai_coach_messages").length, 0, "the conversation and FITX's note in it are gone");
    route = groqJson(MEAL_PLAN);
    const asked = await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } }));
    assert.equal(asked.status, 409, "still no meal plans");
    assert.match((await errorOf(asked)).message, /30 days/);
    assert.equal(providers.calls.length, 0);

    assert.equal((await data.DELETE(request("/api/coach/data", { method: "DELETE" }))).status, 200);
    assert.equal(db.rows("ai_coach_safety_notes").length, 0, "removed with the rest of the coach data");
    consentTo();
    const planned = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan" } })));
    assert.ok(planOf(planned), "plans again after the member deleted their coach data");
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

describe("GET /api/coach/status: providers and quick prompts", () => {
  type Prompt = { id: string; source: string; context: string; text: string; mode: string };
  const promptsOf = async () => ((await (await status.GET(request("/api/coach/status", { method: "GET" }))).json()) as { quickPrompts: Prompt[] }).quickPrompts;
  const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  test("names each connected service without a key, a URL or a model setting", async () => {
    setKeys({ ...KEYS, OLLAMA_BASE_URL: "https://ollama.private-owner.example", OLLAMA_MODEL: "llama3.2" });
    try {
      seedMember();
      const response = await status.GET(request("/api/coach/status", { method: "GET" }));
      const text = await response.text();
      const body = JSON.parse(text) as { providers: Array<{ id: string; name: string }> };
      assert.deepEqual(body.providers.map((provider) => provider.id), ["gemini", "groq", "openrouter", "ollama"]);
      assert.equal(body.providers.find((provider) => provider.id === "ollama")?.name, "Ollama (FITX's own server)");
      for (const secret of [...Object.values(KEYS), "private-owner", "llama3.2", "/v1", "https://"]) assert.ok(!text.includes(secret), `the status never carries ${secret}`);
    } finally {
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.OLLAMA_MODEL;
    }
  });

  test("the FITX Admin switch off reports “paused”, keeping the coach's data controls", async () => {
    const { resetPlatformSettingsCache } = await import("@/lib/platform/gate");
    seedMember();
    consentTo(MEMBER, true);
    resetPlatformSettingsCache();
    db.rows("platform_settings").push({ id: 1, features: { ai_coach: false }, maintenance: null, site: {} });
    try {
      const paused = await statusOf();
      assert.equal(paused.state, "paused", "the panel shows the paused coach, not a ready one whose every message fails");
      assert.equal(paused.consent?.shareData, true, "Coach settings still has the member's consent");
      assert.deepEqual(paused.quotas, []);
    } finally {
      resetPlatformSettingsCache();
    }
    db.rows("platform_settings").length = 0;
    assert.equal((await statusOf()).state, "ready", "switched back on, the coach is ready again");
    resetPlatformSettingsCache();
  });

  test("a version-1 consent names services added since as “Questions only”", async () => {
    setKeys({ ...KEYS, CLOUDFLARE_API_TOKEN: "test-cf", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" });
    try {
      seedMember();
      consentTo(MEMBER, true);
      const notices = (await statusOf()).providers;
      assert.match(notices.find((provider) => provider.id === "cloudflare")?.dataUse ?? "", /^Added after you agreed/);
      assert.doesNotMatch(notices.find((provider) => provider.id === "groq")?.dataUse ?? "", /Questions only/);
      db.rows("ai_coach_consents")[0].consent_version = 2;
      assert.doesNotMatch((await statusOf()).providers.find((provider) => provider.id === "cloudflare")?.dataUse ?? "", /Added after/);
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
    }
  });

  test("with “Use my FITX data”, prompts come from today's food, training, activity and goals", async () => {
    seedMember();
    db.rows("meals").length = 0;
    db.rows("meals").push({ user_id: MEMBER, date: istToday(), meal: "Breakfast", food_name: "Upma", calories: 250, protein: 5, carbs: 45, fat: 6 });
    db.rows("workout_sessions").push({ user_id: MEMBER, name: "Upper strength", status: "completed", started_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    db.rows("activities").push({ user_id: MEMBER, sport: "run", distance_m: 5200, started_at: new Date(Date.now() - 86_400_000).toISOString() });
    consentTo(MEMBER, true);
    const prompts = await promptsOf();
    assert.deepEqual(prompts.map((prompt) => prompt.source), ["food", "training", "activity", "setup"]);
    const [food, training, activity] = prompts;
    assert.match(food.context, /^Today · 250 of [\d,]+ kcal$/);
    assert.match(food.text, /^I have about [\d,]+ kcal and \d+ g protein left today\. What should I eat\?$/);
    assert.equal(training.text, "Plan my next workout after “Upper strength”.");
    assert.equal(training.mode, "workout_plan");
    assert.equal(activity.text, "I ran 5.2 km this week. How should I fit it around my training?");
    assert.ok(!JSON.stringify(prompts).includes("Private Name") && !JSON.stringify(prompts).includes("@"), "no name or email");
  });

  test("an unknown calorie value is never counted as 0", async () => {
    seedMember();
    db.rows("meals").length = 0;
    db.rows("meals").push({ user_id: MEMBER, date: istToday(), meal: "Lunch", food_name: "Packaged wrap", calories: null, protein: null, carbs: null, fat: 12 });
    consentTo(MEMBER, true);
    const [food] = await promptsOf();
    assert.equal(food.context, "Today · 1 food logged");
    assert.equal(food.text, "What should I eat for the rest of today?");
  });

  test("an automatic goal's stored 0 is not its progress; a long-term goal logged by hand shows its total", async () => {
    seedMember();
    db.rows("goals").push(
      { user_id: MEMBER, title: "4 workouts a week", category: "consistency", metric: "workouts_completed", period: "weekly", status: "active", target_value: 4, current_value: 0, unit: "workouts", due_on: "2026-12-01" },
      { user_id: MEMBER, title: "Read 10 books", category: "personal", metric: "manual", period: "long_term", status: "active", target_value: 10, current_value: 3, unit: "books", due_on: "2027-06-01" },
    );
    consentTo(MEMBER, true);
    const goal = (await promptsOf()).find((prompt) => prompt.source === "goal")!;
    assert.equal(goal.context, "Goal · active", "never “0 of 4 workouts”");
    assert.equal(goal.text, "How do I reach my goal “4 workouts a week” by 1 Dec?");
    db.rows("goals").splice(0, 1);
    assert.equal((await promptsOf()).find((prompt) => prompt.source === "goal")?.context, "Goal · 3 of 10 books");
  });

  test("for 30 days after the eating-disorder note, no prompt is about food, calories or weight", async () => {
    seedMember();
    db.rows("meals").length = 0;
    db.rows("meals").push({ user_id: MEMBER, date: istToday(), meal: "Breakfast", food_name: "Upma", calories: 250, protein: 5, carbs: 45, fat: 6 });
    db.rows("goals").push(
      { user_id: MEMBER, title: "Reach 55 kg", category: "body", metric: "body_weight_kg", period: "long_term", status: "active", target_value: 55, current_value: 0, unit: "kg", due_on: "2026-12-01" },
      { user_id: MEMBER, title: "Read 10 books", category: "personal", metric: "manual", period: "long_term", status: "active", target_value: 10, current_value: 3, unit: "books", due_on: "2027-06-01" },
    );
    db.rows("ai_coach_safety_notes").push({ id: "33333333-3333-4333-8333-333333333333", user_id: MEMBER, topic: "eating_disorder", created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    consentTo(MEMBER, true);
    const prompts = await promptsOf();
    const all = JSON.stringify(prompts);
    assert.ok(prompts.length > 0, "training and setup prompts stay");
    assert.ok(prompts.every((prompt) => prompt.source !== "food" && prompt.id !== "food-answers" && prompt.mode !== "meal_plan"), all);
    assert.doesNotMatch(all, /kcal|calorie|protein|55 kg|Reach 55|\d+ of \d+/i);
    assert.equal(prompts.find((prompt) => prompt.source === "goal")?.context, "Goal · active", "a goal names no number in those 30 days");

    // After the 30 days the food prompts come back.
    db.rows("ai_coach_safety_notes")[0].created_at = new Date(Date.now() - 31 * 86_400_000).toISOString();
    assert.equal((await promptsOf())[0].source, "food");
  });

  test("Questions only and under-18 accounts get no prompts built from their data", async () => {
    seedMember();
    consentTo(MEMBER, false);
    assert.deepEqual(await promptsOf(), []);
    db.reset();
    seedMember(MEMBER, 16);
    consentTo(MEMBER, true);
    assert.deepEqual(await promptsOf(), []);
  });
});
