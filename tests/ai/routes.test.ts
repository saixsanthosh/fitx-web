import "./support/hooks.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeCoachDb } from "./support/fake-coach-db.ts";
import { geminiText, mockFetch, openAiStream, openAiText, providerOf, rateLimited, type MockReply } from "./support/mock-providers.ts";

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

async function events(response: Response) {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown> & { type: string });
}

function seedMember(userId = MEMBER, age = 29) {
  db.rows("profiles").push({ id: userId, age, gender: "female", height: 162, weight: 60, name: "Private Name", email: "private@example.test" });
  db.rows("user_preferences").push({
    user_id: userId, timezone: "Asia/Kolkata", primary_goal: "muscle_gain", activity_level: "moderate", workout_location: "home",
    equipment: ["dumbbell", "bodyweight"], fitness_level: "beginner", session_duration_minutes: 40, workouts_per_week: 3,
    dietary_preferences: ["Vegetarian"], allergies: ["Peanuts"], meals_per_day: 3,
  });
  db.rows("meals").push({ user_id: userId, date: new Date().toISOString().slice(0, 10), meal: "Breakfast", food_name: "Poha", calories: 250, protein: 5, carbs: 45, fat: 6 });
}
function consentTo(userId = MEMBER, share = true) {
  db.rows("ai_coach_consents").push({ user_id: userId, share_personal_data: share, consented_at: new Date().toISOString() });
}
function setKeys(keys: Record<string, string> = KEYS) {
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_COACH_ENABLED"]) delete process.env[name];
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
    assert.equal(((await notSetUp.json()) as { error: { code: string } }).error.code, "not_configured");
    assert.equal(db.usage.length, 0, "nothing taken from today's limit");

    setKeys({ ...KEYS, AI_COACH_ENABLED: "false" });
    const paused = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(((await paused.json()) as { error: { code: string } }).error.code, "paused");

    setKeys();
    db.tables.delete("ai_coach_consents");
    const noConsent = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(noConsent.status, 409);

    db.coachMissing = true;
    const missing = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(missing.status, 503);
    assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "not_available");
    assert.equal(providers.calls.length, 0);
  });

  test("today's limit is enforced before any provider is called", async () => {
    seedMember();
    consentTo();
    db.limits.chat = 0;
    const response = await chat.POST(request("/api/coach/chat", { body: { message: "hi" } }));
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
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
    assert.ok(sent.includes("<fitx_data>") && sent.includes("muscle_gain") && sent.includes("Poha"));
    assert.ok(!sent.includes("Private Name") && !sent.includes("private@example.test") && !sent.includes(MEMBER), "no name, email or account id");
    assert.ok(sent.includes("<member_message>\\nHow am I doing today?\\n</member_message>"));
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
    assert.ok(!sent.includes("Poha") && !sent.includes("muscle_gain"));
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

  test("a crisis message gets FITX's safety note, never a model reply", async () => {
    seedMember();
    consentTo();
    route = () => openAiStream(["should not be called"]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "I want to die, nothing helps" } })));
    assert.deepEqual(stream.map((event) => event.type), ["thread", "message", "done"]);
    const message = (stream[1] as unknown as { message: { role: string; content: string } }).message;
    assert.equal(message.role, "safety");
    assert.match(message.content, /14416/);
    assert.equal(providers.calls.length, 0);
    assert.equal(db.usage.length, 0);
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
    assert.ok(!sent.includes("Poha"));
    assert.equal(db.rows("ai_coach_messages").find((row) => row.role === "user")?.task, "chat", "not upgraded to a plan");
  });
});

describe("meal plans, Add to My Food Plan and swaps", () => {
  async function makePlan() {
    seedMember();
    consentTo();
    route = (url) => (providerOf(url) === "gemini" ? geminiText(JSON.stringify(MEAL_PLAN)) : providerOf(url) === "other" ? { json: { products: [] } } : { status: 500 });
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan my meals", mode: "meal_plan", budget: "₹200" } })));
    return stream;
  }

  test("a plan is checked against the member's allergies and FITX's food data before it is shown", async () => {
    const stream = await makePlan();
    assert.deepEqual(stream.map((event) => event.type).filter((type) => type !== "status"), ["thread", "task", "message", "done"]);
    const { message, actions: proposed } = stream.find((event) => event.type === "message") as unknown as { message: { data: { plan: { meals: Array<{ items: Array<{ name: string; basis: string; actionId: string; portion: string }>; actionId: string | null }>; checks: string[]; budget: string; target: { calories: number } } } }; actions: Array<{ kind: string }> };
    const plan = message.data.plan;
    const names = plan.meals.flatMap((meal) => meal.items.map((item) => item.name));
    assert.ok(!names.includes("Peanut chutney"), "the peanut item is removed");
    assert.ok(plan.checks.some((check) => check.includes("Peanut chutney") && check.includes("allergy")));
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
    assert.equal(proposed.filter((action) => action.kind === "food").length, 5);
    assert.equal(proposed.filter((action) => action.kind === "meal").length, 2);
    assert.equal(db.rows("ai_coach_actions").length, 7);
    const sent = JSON.stringify(providers.calls.find((call) => providerOf(call.url) === "gemini")?.body);
    assert.ok(sent.includes("responseSchema") && sent.includes("₹200"));
  });

  test("Add to My Food Plan creates exactly one custom food, idempotently, and never logs a meal", async () => {
    const stream = await makePlan();
    const plan = (stream.find((event) => event.type === "message") as unknown as { message: { data: { plan: { meals: Array<{ items: Array<{ actionId: string }> }> } } } }).message.data.plan;
    const actionId = plan.meals[0].items[0].actionId;
    const mealsBefore = db.rows("meals").length;
    const first = await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" } }), params(actionId));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: "applied", kind: "food", refId: db.rows("custom_foods")[0].id, already: false });
    const second = await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" } }), params(actionId));
    assert.equal(((await second.json()) as { already: boolean }).already, true);
    assert.equal(db.rows("custom_foods").length, 1);
    assert.equal(db.rows("custom_foods")[0].name, "Idli");
    assert.equal(db.rows("custom_foods")[0].serving_grams, 114);
    assert.equal(db.rows("meals").length, mealsBefore, "no meal logged");
    // Another site cannot press the button for the member.
    assert.equal((await actions.POST(request(`/api/coach/actions/${actionId}`, { body: { op: "apply" }, site: "cross-site" }), params(actionId))).status, 403);
  });

  test("Can't afford this? proposes a checked swap with similar calories and protein", async () => {
    const stream = await makePlan();
    const plan = (stream.find((event) => event.type === "message") as unknown as { message: { data: { plan: { meals: Array<{ items: Array<{ actionId: string; name: string; calories: number }> }> } } } }).message.data.plan;
    const rice = plan.meals[1].items.find((item) => item.name === "Rice")!;
    route = (url) =>
      providerOf(url) === "gemini"
        ? geminiText(JSON.stringify({ options: [
            { name: "Peanut rice", search: "peanut rice", quantity: 200, unit: "g", grams: 200, calories: 300, protein: 8, carbs: 50, fat: 9, cost: "low", why: "Cheap." },
            { name: "Broken wheat upma", search: "upma", quantity: 250, unit: "g", grams: 250, calories: 218, protein: 5, carbs: 35, fat: 6.6, cost: "low", why: "Cheaper than rice where you live." },
          ] }))
        : { status: 500 };
    const response = await swap.POST(request("/api/coach/swap", { body: { actionId: rice.actionId, note: "Rice is expensive this week" } }));
    assert.equal(response.status, 200);
    const result = (await response.json()) as { swap: { replaces: string; item: { name: string; calories: number; actionId: string }; note: string }; quota: { used: number } };
    assert.equal(result.swap.replaces, rice.actionId);
    assert.equal(result.swap.item.name, "Broken wheat upma", "the peanut option is filtered out");
    assert.ok(Math.abs(result.swap.item.calories - rice.calories) <= rice.calories * 0.2);
    assert.ok(db.rows("ai_coach_actions").some((row) => row.id === result.swap.item.actionId && (row.payload as { swap?: unknown }).swap));
    assert.match(JSON.stringify(providers.calls.at(-1)?.body), /Rice is expensive this week/);
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
    route = (url) =>
      providerOf(url) === "gemini"
        ? geminiText(JSON.stringify({ title: "Home full body", summary: "Balanced.", exercises: [
            { id: "goblet_squat", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 },
            { id: "barbell_squat", sets: 5, reps_min: 5, reps_max: 5, rest_seconds: 180 },
            { id: "push_up", sets: 3, reps_min: 8, reps_max: 15, rest_seconds: 60 },
            { id: "invented_move", sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 60 },
          ], tips: ["Warm up for 5 minutes."] }))
        : { status: 500 };
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Plan a workout", mode: "workout_plan" } })));
    const { message } = stream.find((event) => event.type === "message") as unknown as { message: { data: { plan: { exercises: Array<{ exerciseId: string }>; actionId: string } } } };
    assert.deepEqual(message.data.plan.exercises.map((exercise) => exercise.exerciseId), ["goblet_squat", "push_up"]);
    const prompt = JSON.stringify(providers.calls[0].body);
    assert.ok(!prompt.includes("barbell_squat |"), "exercises needing missing equipment are never offered");
    const applied = await actions.POST(request(`/api/coach/actions/${message.data.plan.actionId}`, { body: { op: "apply" } }), params(message.data.plan.actionId));
    assert.equal(((await applied.json()) as { kind: string }).kind, "workout_plan");
    assert.equal(db.rows("workout_plans").length, 1);
  });

  test("status, consent, history and 'delete my coach data'", async () => {
    seedMember();
    const before = (await (await status.GET(request("/api/coach/status", { method: "GET" }))).json()) as { state: string; providers: Array<{ name: string }>; sharedSummary: string[] };
    assert.equal(before.state, "consent");
    assert.deepEqual(before.providers.map((provider) => provider.name), ["Google Gemini", "Groq", "OpenRouter"]);
    assert.ok(before.sharedSummary.some((line) => line.includes("peanuts")));

    assert.equal((await consent.POST(request("/api/coach/consent", { body: { shareData: true } }))).status, 200);
    route = () => openAiStream(["Hi!"]);
    const stream = await events(await chat.POST(request("/api/coach/chat", { body: { message: "Hello coach" } })));
    const threadId = (stream[0] as unknown as { threadId: string }).threadId;

    const view = (await (await threadRoute.GET(request(`/api/coach/threads/${threadId}`, { method: "GET" }), params(threadId))).json()) as { messages: Array<{ role: string }> };
    assert.deepEqual(view.messages.map((message) => message.role), ["user", "assistant"]);
    const ready = (await (await status.GET(request("/api/coach/status", { method: "GET" }))).json()) as { state: string; threads: unknown[]; quotas: Array<{ kind: string; used: number }> };
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

  test("an under-18 member cannot switch data sharing on", async () => {
    seedMember(TEEN, 15);
    await consent.POST(request("/api/coach/consent", { body: { shareData: true }, user: TEEN }));
    assert.equal(db.rows("ai_coach_consents")[0].share_personal_data, false);
  });

  test("before the migration the status says 'not available yet'", async () => {
    seedMember();
    db.coachMissing = true;
    const body = (await (await status.GET(request("/api/coach/status", { method: "GET" }))).json()) as { state: string };
    assert.equal(body.state, "not_available");
  });
});

// Keeps this file's providers mocked even if another test file changed fetch.
test("no real provider was called", () => {
  assert.ok(providers.calls.every((call) => !call.headers.authorization || /test-/.test(call.headers.authorization)));
  assert.equal(openAiText("x").json !== undefined, true);
});
