import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { COACH_SWITCH_CACHE_KEY, cachedCoachSwitch, coachOnIn, loadCoachSwitch, resetCoachSwitch } = await import("@/lib/shell/coach-switch");

// Wave 1 added AI services (Cloudflare Workers AI, Cerebras, Mistral) and the FITX Admin switch now hides the coach
// button: version-1 consents never send member data to a service their consent screen did not name, and a
// switched-off coach is shown as paused, never as a ready coach whose every message fails.

describe("consent versions and the AI services they named", () => {
  test("Coach settings tells a version-1 member that later-added services get only “Questions only”", async () => {
    const { providerNotices } = await import("@/lib/ai/status");
    const { readAiConfig } = await import("@/lib/ai/config");
    const config = readAiConfig({ GROQ_API_KEY: "q", CLOUDFLARE_API_TOKEN: "cf", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" });
    const v1 = Object.fromEntries(providerNotices(config, 1).map((notice) => [notice.id, notice.dataUse]));
    assert.match(v1.cloudflare, /^Added after you agreed .*only “Questions only” requests, never the summary of your FITX data/);
    assert.doesNotMatch(v1.groq, /Questions only/, "Groq was on the version-1 consent screen");
    const v2 = Object.fromEntries(providerNotices(config, 2).map((notice) => [notice.id, notice.dataUse]));
    assert.doesNotMatch(v2.cloudflare, /Questions only/);
    assert.deepEqual(providerNotices(config), providerNotices(config, 2), "the consent screen (no consent yet) shows the current terms");
  });

  test("every coach request with member data carries the consent version, so later-added services are skipped", () => {
    const coach = readFileSync(new URL("../../src/lib/ai/coach.ts", import.meta.url), "utf8");
    const requests = coach.match(/personalData: [^,\n]+,\n\s*consentVersion: (?:state\.consentVersion|consent\.version),/g) ?? [];
    assert.equal(requests.length, coach.match(/^\s*personalData: [^,\n]+,$/gm)?.length, "each request object names consentVersion after personalData");
    assert.equal(requests.length, 4, "chat, meal plan, workout and swap");
    assert.equal(coach.match(/planOrThrow\(deps\.router, [^)]*consent\.version/g)?.length, 2, "the up-front check uses it too");
  });
});

describe("the FITX Admin AI coach switch in the browser", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  };

  test("on unless the saved features say ai_coach: false, as the server's gate reads them", () => {
    assert.equal(coachOnIn({ ai_coach: false }), false);
    assert.equal(coachOnIn({ ai_coach: true }), true);
    assert.equal(coachOnIn({ activity: false }), true);
    assert.equal(coachOnIn(null), true, "no row: the defaults (everything on)");
    assert.equal(coachOnIn("nonsense"), true);
  });

  test("a fresh read refreshes the device cache; a failed one keeps the last answer", async () => {
    resetCoachSwitch();
    const storage = memory();
    assert.equal(await loadCoachSwitch(async () => ({ features: { ai_coach: false }, error: null }), storage, 1_000), false);
    assert.equal(storage.map.get(COACH_SWITCH_CACHE_KEY), "off");
    assert.equal(cachedCoachSwitch(storage), false, "the button stays hidden on the next load before the answer");
    assert.equal(await loadCoachSwitch(async () => ({ features: { ai_coach: true }, error: null }), storage, 30_000), false, "read at most once a minute");
    assert.equal(await loadCoachSwitch(async () => ({ features: { ai_coach: true }, error: null }), storage, 62_000), true);
    assert.equal(storage.map.get(COACH_SWITCH_CACHE_KEY), "on");
    resetCoachSwitch();
    const off = memory({ [COACH_SWITCH_CACHE_KEY]: "off" });
    assert.equal(await loadCoachSwitch(async () => ({ features: null, error: { code: "PGRST205" } }), off, 1_000), false);
    resetCoachSwitch();
    assert.equal(await loadCoachSwitch(async () => { throw new Error("offline"); }, memory(), 1_000), true, "unknown means on, as the gate fails open");
    assert.equal(cachedCoachSwitch({ getItem: () => { throw new Error("blocked"); }, setItem() {} }), true);
    resetCoachSwitch();
  });

  test("the floating button hides while the switch is off", () => {
    const launcher = readFileSync(new URL("../../src/components/layout/CoachLauncher.tsx", import.meta.url), "utf8");
    assert.match(launcher, /const hidden = enabled !== true \|\| coachOn !== true \|\|/);
    assert.match(launcher, /loadCoachSwitch\(\)/);
  });

  test("the gate's 503 reads as the coach being switched off, not “Something went wrong”", async () => {
    const { errorFrom, SWITCHED_OFF_MESSAGE } = await import("@/components/coach/coach-client");
    const gate = await errorFrom(new Response(JSON.stringify({ error: "feature_unavailable" }), { status: 503 }));
    assert.equal(gate.code, "paused", "the coach page and panel then show the paused coach");
    assert.equal(gate.message, SWITCHED_OFF_MESSAGE);
    assert.match(SWITCHED_OFF_MESSAGE, /switched off/);
    const coach = await errorFrom(new Response(JSON.stringify({ error: { code: "quota", message: "Used up.", retryAt: "2026-11-24T00:00:00Z" } }), { status: 429 }));
    assert.deepEqual([coach.code, coach.message, coach.retryAt], ["quota", "Used up.", "2026-11-24T00:00:00Z"]);
    const other = await errorFrom(new Response("<html>", { status: 502 }));
    assert.deepEqual([other.code, other.message], ["failed", "Something went wrong. Please try again."]);
    assert.equal((await errorFrom(new Response(JSON.stringify({ error: "something_else" }), { status: 500 }))).code, "failed");
  });
});
