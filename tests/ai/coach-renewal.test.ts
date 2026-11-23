// D8 L3: members who agreed to the coach under consent version 1 (before 23 November 2026) keep their FITX data away
// from the services that screen never named until they agree again. The coach offers that once, and nothing changes
// until the member says yes: agreeing stores the current version and keeps "Use my FITX data" as it was.
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
const consent = await import("@/app/api/coach/consent/route");
const status = await import("@/app/api/coach/status/route");
const { consentRenewal } = await import("@/lib/ai/status");
const { CONSENT_VERSION, consentOutdated } = await import("@/lib/ai/store");
const { readAiConfig } = await import("@/lib/ai/config");
const { markRenewalSeen, renewalSeen, renewalSeenKey, renewalText } = await import("@/components/coach/renewal");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const TEEN = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const KEYS = { GROQ_API_KEY: "test-groq", CLOUDFLARE_API_TOKEN: "test-cf", CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
const KEY_NAMES = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "AI_COACH_ENABLED", "AI_GEMINI_WITH_MEMBER_DATA", "AI_MISTRAL_WITH_MEMBER_DATA", "AI_CEREBRAS_WITH_MEMBER_DATA"];

function request(path: string, { method = "POST", body, user = MEMBER }: { method?: string; body?: unknown; user?: string } = {}) {
  return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), {
    method,
    headers: {
      host: "fitnessx.vercel.app", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin",
      cookie: `sb-127-auth-token=${db.session(user)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
type Renewal = { version: number; services: string[]; activities: boolean } | null;
const statusOf = async (user = MEMBER) => (await (await status.GET(request("/api/coach/status", { method: "GET", user }))).json()) as { state: string; renewal: Renewal; consent: { shareData: boolean } | null };
const renew = (user = MEMBER) => consent.POST(request("/api/coach/consent", { body: { renew: true }, user }));

function seed(userId: string, age: number) {
  db.rows("profiles").push({ id: userId, age, gender: "female", height: 162, weight: 60 });
  db.rows("user_preferences").push({ user_id: userId, timezone: "Asia/Kolkata", primary_goal: "muscle_gain", activity_level: "moderate", workout_location: "home", equipment: ["dumbbell"], fitness_level: "beginner", workouts_per_week: 3, meals_per_day: 3 });
}
/** A consent row as wave 1 found it: no consent_version (read as 1) unless given. */
function consentTo(userId: string, share: boolean, version?: number) {
  db.rows("ai_coach_consents").push({ user_id: userId, share_personal_data: share, consented_at: "2026-11-20T08:00:00.000Z", ...(version ? { consent_version: version } : {}) });
}
function setKeys(keys: Record<string, string> = KEYS) {
  for (const name of KEY_NAMES) delete process.env[name];
  Object.assign(process.env, keys);
}

before(() => {
  db.addUser(MEMBER, "member@example.test");
  db.addUser(TEEN, "teen@example.test");
});
beforeEach(() => {
  db.reset();
  setKeys();
});
after(async () => {
  await db.stop();
});

describe("what agreeing again would add", () => {
  test("a sharing adult on version 1: the activity totals and the services added since, by name", () => {
    const config = readAiConfig({ ...KEYS, MISTRAL_API_KEY: "m", AI_MISTRAL_WITH_MEMBER_DATA: "true", CEREBRAS_API_KEY: "c" });
    const renewal = consentRenewal(config, { shareData: true, version: 1 }, true);
    assert.equal(renewal?.version, CONSENT_VERSION);
    assert.equal(renewal?.activities, true);
    assert.deepEqual(renewal?.services, ["Cloudflare Workers AI", "Mistral AI"], "Groq was named on version 1; Cerebras stays Questions only without the owner's opt-in");
  });

  test("nothing to offer: Questions only, under 18 or no age, already on the current version", () => {
    const config = readAiConfig(KEYS);
    assert.equal(consentRenewal(config, { shareData: false, version: 1 }, true), null);
    assert.equal(consentRenewal(config, { shareData: true, version: 1 }, false), null);
    assert.equal(consentRenewal(config, { shareData: true, version: CONSENT_VERSION }, true), null);
    assert.equal(consentOutdated({ shareData: true, version: 1 }, true), true);
  });

  test("the prompt says what changes in plain words, and that nothing does without a yes", () => {
    const both = renewalText({ activities: true, services: ["Cloudflare Workers AI", "Mistral AI"] });
    assert.equal(both, "Since you agreed, the coach can also read your walks, runs and rides (totals only, never routes), and Cloudflare Workers AI and Mistral AI were added as AI services for your FITX data. Nothing changes unless you agree to the updated terms.");
    assert.equal(renewalText({ activities: false, services: ["Cloudflare Workers AI"] }), "Since you agreed, Cloudflare Workers AI was added as an AI service for your FITX data. Nothing changes unless you agree to the updated terms.");
    assert.match(renewalText({ activities: true, services: [] }), /^Since you agreed, the coach can also read your walks, runs and rides \(totals only, never routes\)\. Nothing changes/);
  });

  test("the prompt is answered once per device: “Not now” or “Agree” keeps it away", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
    assert.equal(renewalSeen(storage, 2), false);
    markRenewalSeen(storage, 2);
    assert.equal(map.get(renewalSeenKey(2)), "seen");
    assert.equal(renewalSeen(storage, 2), true);
    assert.equal(renewalSeen(storage, 3), false, "a later consent version asks again");
    assert.equal(renewalSeen({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }, 2), false);
  });
});

describe("the coach's status and POST /api/coach/consent { renew: true }", () => {
  test("a version-1 sharing member is offered the update; agreeing stores version 2 and keeps sharing on", async () => {
    seed(MEMBER, 30);
    consentTo(MEMBER, true);
    const before = await statusOf();
    assert.equal(before.state, "ready");
    assert.deepEqual(before.renewal, { version: CONSENT_VERSION, services: ["Cloudflare Workers AI"], activities: true });
    const answer = await renew();
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { consent: { shareData: true, version: CONSENT_VERSION } });
    const row = db.rows("ai_coach_consents")[0];
    assert.equal(row.consent_version, CONSENT_VERSION);
    assert.equal(row.share_personal_data, true, "“Use my FITX data” keeps its setting");
    assert.notEqual(row.consented_at, "2026-11-20T08:00:00.000Z", "the time of agreeing moves to now");
    assert.equal((await statusOf()).renewal, null, "nothing more to offer");
  });

  test("until the member agrees, nothing changes: the status itself writes nothing", async () => {
    seed(MEMBER, 30);
    consentTo(MEMBER, true);
    await statusOf();
    await statusOf();
    const row = db.rows("ai_coach_consents")[0];
    assert.equal(row.consent_version, undefined, "still the version-1 row");
    assert.equal(row.consented_at, "2026-11-20T08:00:00.000Z");
  });

  test("Questions only, an under-18 account or a current consent: no offer, and a renew request stores nothing", async () => {
    seed(MEMBER, 30);
    consentTo(MEMBER, false);
    assert.equal((await statusOf()).renewal, null);
    assert.equal((await renew()).status, 200);
    assert.equal(db.rows("ai_coach_consents")[0].consent_version, undefined, "Questions only: nothing to agree to");

    seed(TEEN, 16);
    consentTo(TEEN, true);
    assert.equal((await statusOf(TEEN)).renewal, null, "under 18: the summary is never sent, so nothing to offer");
    assert.equal((await renew(TEEN)).status, 200);
    assert.equal(db.rows("ai_coach_consents").find((row) => row.user_id === TEEN)?.consent_version, undefined);
  });

  test("with no consent at all there is nothing to renew", async () => {
    seed(MEMBER, 30);
    const answer = await renew();
    assert.equal(answer.status, 400);
    assert.equal(db.rows("ai_coach_consents").length, 0, "a renew never creates a consent without the consent screen");
  });
});

test("the privacy page says this for consents before 23 November 2026", () => {
  const page = readFileSync(new URL("../../src/app/(marketing)/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(page, /If you agreed before 23 November 2026, your FITX data also stays away from Cloudflare Workers AI, Cerebras and Mistral AI, which your consent screen did not name, until you agree again: the AI Coach asks you once, and nothing changes unless you say yes\./);
});
