// Bug 23 (coach-help-2): during the 30 days after FITX's eating-disorder note the coach still offered "Plan my meals"
// (the starter chip and the composer's mode) and refused only after the member asked. The status now says whether the
// care period is on, and the page offers no meal plans, swaps or food suggestions while it lasts.
import "./support/hooks.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeCoachDb } from "./support/fake-coach-db.ts";

const db = await new FakeCoachDb().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = db.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { configureRouteLimitsForTests } = await import("@/lib/security/rate-limit");
configureRouteLimitsForTests({ coachTurn: { limit: 10_000, windowMs: 60_000 } });
const chat = await import("@/app/api/coach/chat/route");
const status = await import("@/app/api/coach/status/route");
const { capabilityStarters, generalPrompts } = await import("@/lib/ai/capabilities");
const { composerModes, modeFor } = await import("@/components/coach/composer-rules");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const source = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

function request(path: string, { method = "POST", body }: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), {
    method,
    headers: {
      host: "fitnessx.vercel.app",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      cookie: `sb-127-auth-token=${db.session(MEMBER)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const statusOf = async () => (await (await status.GET(request("/api/coach/status", { method: "GET" }))).json()) as { state: string; careMode: boolean };

function seedMember(share: boolean) {
  db.rows("profiles").push({ id: MEMBER, age: 29, gender: "female", height: 162, weight: 60 });
  db.rows("user_preferences").push({ user_id: MEMBER, timezone: "Asia/Kolkata", primary_goal: "fat_loss", activity_level: "moderate" });
  db.rows("ai_coach_consents").push({ user_id: MEMBER, share_personal_data: share, consented_at: new Date().toISOString() });
}

before(() => db.addUser(MEMBER, "member@example.test"));
beforeEach(() => {
  db.reset();
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_COACH_ENABLED"]) delete process.env[name];
  process.env.GROQ_API_KEY = "test-groq";
});
after(() => db.stop());

describe("the status says when the 30 days are on", () => {
  test("from FITX's note on, with “Use my FITX data” or “Questions only”, until 30 days have passed", async () => {
    for (const share of [true, false]) {
      db.reset();
      seedMember(share);
      assert.equal((await statusOf()).careMode, false);
      const noted = await chat.POST(request("/api/coach/chat", { body: { message: "I make myself throw up after meals" } }));
      assert.match(await noted.text(), /"role":"safety"/);
      const now = await statusOf();
      assert.deepEqual([now.state, now.careMode], ["ready", true], `share=${share}`);
    }
    db.rows("ai_coach_safety_notes")[0].created_at = new Date(Date.now() - 31 * 86_400_000).toISOString();
    db.rows("ai_coach_messages").length = 0;
    assert.equal((await statusOf()).careMode, false, "after the 30 days");
  });
});

describe("while the 30 days last, the page offers no meal plans or food prompts", () => {
  test("the coach's jobs leave out meal plans, and the progress and catch-up starters leave out food and targets", () => {
    const care = capabilityStarters({ sharesData: true, careMode: true });
    assert.deepEqual(care.map((starter) => starter.id), ["workout_plan", "exercise_help", "progress", "motivation", "recovery", "adjust"]);
    for (const starter of care) assert.doesNotMatch(starter.text, /\bfood\b|meal|calorie|weight|targets?\b/i, starter.id);
    assert.deepEqual(capabilityStarters({ sharesData: false, careMode: true }).map((starter) => starter.id), ["exercise_help", "motivation", "recovery", "adjust"]);
    assert.ok(capabilityStarters({ sharesData: true }).some((starter) => starter.id === "meal_plan"), "offered again afterwards");
  });

  test("the general suggestions leave out food, for adults and under-18 accounts", () => {
    assert.deepEqual(generalPrompts({ minor: false, careMode: true }).map((prompt) => prompt.context), ["Training", "Warm-up"]);
    assert.deepEqual(generalPrompts({ minor: true, careMode: true }).map((prompt) => prompt.context), ["Strength", "Recovery"]);
    assert.equal(generalPrompts({ minor: false }).length, 4);
  });

  test("the composer doesn't offer Plan my meals, and no starter can pick it", () => {
    assert.deepEqual(composerModes({ plansAllowed: true, mealPlansPaused: true }), { chat: "on", meal_plan: "hidden", workout_plan: "on" });
    assert.deepEqual(composerModes({ plansAllowed: true, mealPlansPaused: false }), { chat: "on", meal_plan: "on", workout_plan: "on" });
    assert.deepEqual(composerModes({ plansAllowed: false, mealPlansPaused: false }), { chat: "on", meal_plan: "off", workout_plan: "off" });
    assert.equal(modeFor("meal_plan", { plansAllowed: true, mealPlansPaused: true }), "chat");
    assert.equal(modeFor("workout_plan", { plansAllowed: true, mealPlansPaused: true }), "workout_plan", "the note is about food: workouts stay");
    assert.equal(modeFor("meal_plan", { plansAllowed: false, mealPlansPaused: false }), "chat");
  });

  test("the page uses it: the composer, the starters, swaps, and the note arriving mid-conversation", () => {
    const app = source("components/coach/CoachApp.tsx");
    assert.match(app, /mealPlansPaused=\{status\.careMode\}/);
    assert.match(app, /capabilityStarters\(\{ sharesData: plansAllowed, careMode: status\.careMode \}\)/);
    assert.match(app, /generalPrompts\(\{ minor: status\.minor, careMode: status\.careMode \}\)/);
    assert.match(app, /canSwap: plansAllowed && !status\.careMode/);
    assert.match(app, /setMode\(modeFor\(prompt\.mode, \{ plansAllowed, mealPlansPaused: status\.careMode \}\)\)/);
    assert.match(app, /event\.message\.role === "safety" && event\.message\.data\?\.safety === "eating_disorder"\) startCarePeriod\(\)/);
    assert.match(source("components/coach/Composer.tsx"), /MODES\.filter\(\(\{ id \}\) => offered\[id\] !== "hidden"\)/);
    // A safety-note read that fails is treated as the 30 days: the page fails closed, as the coach's own check does.
    assert.match(source("lib/ai/status.ts"), /careMode: care !== false/);
  });
});
