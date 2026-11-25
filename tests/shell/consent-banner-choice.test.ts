// The privacy banner reads and saves the analytics choice with the cookie page's helpers (bug 24; shell edit 4 asked
// by the home stream, reports-3/home.md): one key, one event and one storage rule for both, where the banner kept its
// own copies of each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSENT_KEY, bannerChoice, browserStorage, readChoice } from "@/lib/home/cookie-choice";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null };
}
const blocked = { getItem: () => { throw new Error("SecurityError"); } };

test("the banner asks only while nothing is saved, and never where nothing could be saved (as before)", () => {
  assert.equal(bannerChoice("none"), null, "the banner shows");
  assert.equal(bannerChoice("essential"), "essential");
  assert.equal(bannerChoice("all"), "all");
  assert.equal(bannerChoice("blocked"), "essential", "storage refused: analytics stay off, and no banner on every page");
  assert.equal(bannerChoice(readChoice(memoryStorage())), null);
  assert.equal(bannerChoice(readChoice(memoryStorage({ [CONSENT_KEY]: "yes please" }))), null, "junk is no choice");
  assert.equal(bannerChoice(readChoice(memoryStorage({ [CONSENT_KEY]: "all" }))), "all");
  assert.equal(bannerChoice(readChoice(blocked)), "essential");
  assert.equal(browserStorage(), null, "no window here: storage that can't be read");
  assert.equal(bannerChoice(readChoice(browserStorage())), "essential");
});

test("the banner keeps no copy of the key, the event or the storage rules; the cookie page's box shares the accessor", () => {
  const banner = source("src/components/layout/AnalyticsConsent.tsx");
  assert.match(banner, /import \{ CONSENT_EVENT, bannerChoice, browserStorage, readChoice, saveChoice, type ConsentChoice \} from "@\/lib\/home\/cookie-choice";/);
  assert.doesNotMatch(banner, /fitx-cookie-consent|localStorage/);
  assert.match(banner, /if \(!saveChoice\(browserStorage\(\), value\)\) return;\s*window\.dispatchEvent\(new Event\(CONSENT_EVENT\)\);/);
  assert.match(banner, /if \(readChoice\(browserStorage\(\)\) !== "all"\) return null;/, "analytics are sent only with Allow analytics");
  assert.match(banner, /window\.addEventListener\(CONSENT_EVENT, onChange\);/);
  assert.match(banner, /return bannerChoice\(readChoice\(browserStorage\(\)\)\);/);
  const box = source("src/components/layout/CookiePreferences.tsx");
  assert.doesNotMatch(box, /function browserStorage/);
  assert.match(box, /browserStorage, confirmationFor/);
});
