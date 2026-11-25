// The cookie page's "Change your analytics choice" (bug 24): it wrote fitx-cookie-consent but never read it back, so
// "Allow analytics" always looked chosen and a press gave no feedback (src/lib/home/cookie-choice.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHOICES, CONSENT_EVENT, CONSENT_KEY, confirmationFor, currentChoiceText, isPressed, readChoice, saveChoice } from "@/lib/home/cookie-choice";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}
const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };

describe("reading the saved choice back", () => {
  test("the banner's and the page's key, and the two choices in the page's order", () => {
    assert.equal(CONSENT_KEY, "fitx-cookie-consent");
    assert.equal(CONSENT_EVENT, "fitx-cookie-consent-change");
    assert.deepEqual(CHOICES.map((choice) => choice.label), ["Essential only", "Allow analytics"]);
  });

  test("essential, all, nothing yet, junk and blocked storage", () => {
    assert.equal(readChoice(memoryStorage({ [CONSENT_KEY]: "essential" })), "essential");
    assert.equal(readChoice(memoryStorage({ [CONSENT_KEY]: "all" })), "all");
    assert.equal(readChoice(memoryStorage()), "none");
    assert.equal(readChoice(memoryStorage({ [CONSENT_KEY]: "yes please" })), "none");
    assert.equal(readChoice(blocked), "blocked");
    assert.equal(readChoice(null), "blocked");
  });

  test("only the saved choice is pressed; nothing is pressed before a choice, and nothing claims a state before the browser is read", () => {
    assert.deepEqual(CHOICES.map(({ value }) => isPressed("essential", value)), [true, false], "a member who declined doesn't see Allow analytics chosen");
    assert.deepEqual(CHOICES.map(({ value }) => isPressed("all", value)), [false, true]);
    assert.deepEqual(CHOICES.map(({ value }) => isPressed("none", value)), [false, false]);
    assert.deepEqual(CHOICES.map(({ value }) => isPressed("pending", value)), [undefined, undefined]);
  });

  test("a line says which choice this browser has, every state differently", () => {
    const lines = (["essential", "all", "none", "blocked"] as const).map(currentChoiceText);
    assert.equal(new Set(lines).size, 4);
    assert.equal(currentChoiceText("essential"), "Your choice on this browser: essential only, so analytics are off.");
    assert.equal(currentChoiceText("all"), "Your choice on this browser: analytics allowed.");
    assert.equal(currentChoiceText("pending"), "");
  });
});

describe("saving and confirming", () => {
  test("a press is saved and confirmed; a refused save says analytics stay off", () => {
    const storage = memoryStorage();
    assert.equal(saveChoice(storage, "essential"), true);
    assert.equal(storage.data.get(CONSENT_KEY), "essential");
    assert.equal(confirmationFor("essential", { choice: "essential", saved: true }), "Saved. Analytics are off for this browser.");
    assert.equal(confirmationFor("all", { choice: "all", saved: true }), "Saved. Anonymous page analytics are on for this browser.");
    assert.equal(saveChoice(blocked, "all"), false);
    assert.equal(saveChoice(null, "all"), false);
    assert.equal(confirmationFor("blocked", { choice: "all", saved: false }), "Your choice couldn’t be saved on this browser, so analytics stay off.");
  });

  test("the confirmation goes once the choice changes elsewhere (the banner or another tab)", () => {
    assert.equal(confirmationFor("all", { choice: "essential", saved: true }), "");
    assert.equal(confirmationFor("essential", null), "");
  });
});

describe("the page's box uses it", () => {
  const box = readFileSync(new URL("../../src/components/layout/CookiePreferences.tsx", import.meta.url), "utf8");

  test("reads the stored choice, follows changes, and shows the pressed state", () => {
    assert.match(box, /useSyncExternalStore\(subscribe, readStored, notReadYet\)/);
    assert.match(box, /window\.addEventListener\(CONSENT_EVENT, onChange\);\s*window\.addEventListener\("storage", onChange\);/);
    assert.match(box, /aria-pressed=\{pressed\}/);
    assert.match(box, /<p role="status" aria-live="polite"[^>]*>\{confirmationFor\(stored, last\)\}<\/p>/);
    assert.doesNotMatch(box, /fitx-button-quiet/, "no fixed quiet/filled pair whatever is stored");
  });
});
