// Release 3 fix round 3d, the same mistake as open-3c-try-again-d5 (D5, D6): on /workouts/programme a "Show earlier
// weeks" whose load failed replaced the whole page with "Programme unavailable", so the button went, keyboard focus
// fell to the page body, and the reason was nowhere near what the member pressed. Now the page keeps what it shows: the
// reason goes beside the button (role="alert", and the button carries it), and the button stays, with focus. A first
// load or Try again that fails still shows the unavailable state. The page is JSX, which `node --test` cannot render,
// so its wiring is read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(dashboard)/workouts/programme/page.tsx", "utf8");
const load = page.slice(page.indexOf("  const load = useCallback("), page.indexOf("  }, [todayKey]);") + 18);
const showEarlier = page.slice(page.indexOf("  async function showEarlier() {"), page.indexOf("\n  }\n", page.indexOf("  async function showEarlier() {")) + 4);

describe("a failed Show earlier weeks keeps the page and says why beside the button", () => {
  test("every failure of the load goes through one place: the unavailable state, or beside the button for earlier weeks", () => {
    // Since round 3f the load says how it ended ("ready", "none" or "failed"), not only whether it failed.
    assert.match(load, /const load = useCallback\(async \(backTo\?: string\): Promise<LoadOutcome> => \{/);
    assert.match(load, /const fail = \(text: string, earlier = text\): LoadOutcome => \{\n\s+if \(backTo\) setEarlierError\(earlier\);\n\s+else \{ setMessage\(text\); setState\("error"\); \}\n\s+return "failed";\n\s+\};/);
    assert.equal(load.match(/return fail\(/g)?.length, 5, "no Supabase, signed out, the enrolment, its days, the programme");
    assert.equal(load.match(/setState\("error"\)/g)?.length, 1, "only fail() sets the unavailable state");
    assert.match(load, /setState\("ready"\);\n\s+return "ready";\n\s+\}, \[todayKey\]\);/);
    assert.match(load, /if \(!current\.enrolment\) \{ setState\("none"\); return "none"; \}/);
  });

  test("the connection failures say so for earlier weeks; the others keep their own words", () => {
    assert.match(load, /const offline = "Earlier weeks couldn’t be loaded\. Check your connection and try again\.";/);
    assert.match(load, /if \(current\.error\) return fail\("Your programme couldn’t be loaded\. Check your connection and try again\.", offline\);/);
    assert.match(load, /if \(plans\.error\) return fail\("Your programme days couldn’t be loaded\. Check your connection and try again\.", offline\);/);
    assert.match(load, /if \(!user\) return fail\("Sign in to see your programme\."\);/);
  });

  test("Show earlier weeks clears the old reason, and hands focus to a week only when the weeks loaded", () => {
    assert.match(showEarlier, /setLoadingEarlier\(true\);\n\s+setEarlierError\(""\);\n\s+const outcome = await load\(mondayOf\(addDays\(loaded\.fromKey, -7 \* WEEKS_BACK\)\)\);\n\s+setLoadingEarlier\(false\);/);
    assert.match(showEarlier, /if \(outcome === "ready"\) setWeekFocus\(\(current\) => \(\{ shown, seq: \(current\?\.seq \?\? 0\) \+ 1 \}\)\);/);
  });

  test("the reason shows right under the button, which carries it; the button is never disabled while it loads", () => {
    assert.match(page, /\{canGoBack && <button type="button" onClick=\{\(\) => void showEarlier\(\)\} aria-disabled=\{loadingEarlier \|\| undefined\} aria-describedby=\{earlierError \? "programme-earlier-problem" : undefined\} className="[^"]+">\{loadingEarlier \? "Loading…" : "Show earlier weeks"\}<\/button>\}\n\s+\{canGoBack && earlierError && <p id="programme-earlier-problem" role="alert" className="[^"]+">\{earlierError\}<\/p>\}/);
    assert.doesNotMatch(page, /onClick=\{\(\) => void showEarlier\(\)\}[^\n]*\sdisabled=/, "aria-disabled only: a disabled button drops focus");
  });
});
