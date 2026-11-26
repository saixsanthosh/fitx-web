// The same mistake as open-3a-onboarding-save-timeout (fix round 3c), in setup's load: when setup opens, and after Try
// again, it loads the member's details with no time limit, so a request that never answered (a stalled connection, a
// server that hangs) left "Loading your profile…" up until the page was reloaded, and one that broke off left it up for
// good. Now the load ends at its limit with setup's alert and Try again, and whatever it brings back later is dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETUP_TIME_LIMIT_MS, loadWithinLimit } from "@/lib/onboarding/time-limit";

const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** The effect that loads the member's details. */
const effect = flow.slice(flow.indexOf("useEffect(() => {\n    let live = true;"), flow.indexOf("}, [router, reload]);"));

test("a load that never answers ends at its limit, not before", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ended: boolean | null = null;
  void loadWithinLimit(() => never()).then((value) => { ended = value; });
  t.mock.timers.tick(SETUP_TIME_LIMIT_MS.load - 1);
  await turn();
  assert.equal(ended, null, "still waiting a moment before the limit");
  t.mock.timers.tick(1);
  await turn();
  assert.equal(ended, false, "out of time");
  assert.equal(SETUP_TIME_LIMIT_MS.load, 20_000);
});

test("a load that ends in time counts, whatever it found; one that breaks off does not", async () => {
  assert.equal(await loadWithinLimit(async () => undefined), true, "it showed setup, the alert, or went on to sign-in or Home");
  assert.equal(await loadWithinLimit(async () => { throw new Error("broke off"); }), false, "never Loading… for good");
  assert.equal(await loadWithinLimit(() => { throw new Error("broke off at once"); }), false);
});

test("setup's load runs within the limit; past it, the alert with Try again, and the late answer is dropped", () => {
  assert.ok(effect.length > 0, "the load effect was found");
  assert.match(effect, /const ended = await loadWithinLimit\(async \(\) => \{/);
  assert.match(effect, /\}\);\s*if \(!ended && live\) \{\s*live = false;\s*setPhase\("load_failed"\);\s*\}\s*\}\)\(\);/, "out of time: the alert");
  // Each answer is used only while the load is still wanted, so nothing arrives after the alert or after Try again.
  for (const step of [
    "await supabase.auth.getUser();",
    "await loadUserContext(supabase, { id: auth.user.id, email: auth.user.email ?? null });",
    "await ensureProfileRow(supabase, auth.user.id);",
  ]) {
    const at = effect.indexOf(step);
    assert.ok(at >= 0, `${step} is in the load`);
    assert.match(effect.slice(at + step.length), /^\s*if \(!live\) return;/, `${step} is followed by the check`);
  }
  assert.match(flow, /\}\)\(\);\s*return \(\) => \{\s*live = false;\s*\};\s*\}, \[router, reload\]\);/, "leaving the page or Try again drops it too");
});

test("the alert it ends with is the load's own, and Try again starts a new load", () => {
  assert.match(flow, /if \(phase === "load_failed" \|\| !form \|\| !context\) \{/);
  assert.match(flow, /<span id="onboarding-load-failed">We couldn’t load your details, so setup is paused to keep them safe\.<\/span>/);
  assert.match(flow, /onClick=\{\(\) => \{ retried\.current = true; setPhase\("loading"\); setReload\(\(count\) => count \+ 1\); \}\}/);
});
