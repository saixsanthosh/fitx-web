// D5 on Profile (release 3 fix round 3a; reviews integration:R3X-3 and a11y-copy:a11y-home-profile-controls-drop-focus).
// A button disabled while its action works loses keyboard focus in Chrome: Profile's "Try again" was disabled={retrying},
// so a keyboard press dropped focus to the page and a retry that failed again left it there, undoing what e079491
// (home-1) meant by keeping the error box on screen. Profile's busy buttons now stay focusable (aria-disabled) and ignore
// a press meanwhile; when the control that had focus is gone, focus goes to the next sensible one (profile-focus.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterRetry, type ProfileStatus } from "@/app/(dashboard)/profile/profile-focus";

const read = (file: string) => readFileSync(new URL(`../../src/app/(dashboard)/profile/${file}`, import.meta.url), "utf8");

/** Each <button …> opening tag in a file (braces skipped as a whole, so arrow functions don't end it early). */
function buttons(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/<button\b/g)) {
    let depth = 0;
    for (let index = match.index ?? 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        found.push(text.slice(match.index, index + 1));
        break;
      }
    }
  }
  return found;
}

describe("focusAfterRetry: where focus goes once Try again has finished, if the button it was on has gone", () => {
  test("the profile's heading once the profile has loaded", () => {
    assert.equal(focusAfterRetry("ready"), "heading");
  });

  test("the alert's own control when the alert changed: Sign in for an ended session, or a new Try again", () => {
    assert.equal(focusAfterRetry("signed_out"), "action");
    assert.equal(focusAfterRetry("error"), "action");
  });

  test("nothing yet while Profile is still loading (its next state decides), and nothing when there is nothing to press", () => {
    assert.equal(focusAfterRetry("loading"), "wait");
    assert.equal(focusAfterRetry("unavailable"), "none");
  });

  test("every page state has an answer", () => {
    const states: ProfileStatus[] = ["loading", "ready", "signed_out", "unavailable", "error"];
    for (const state of states) assert.ok(["heading", "action", "wait", "none"].includes(focusAfterRetry(state)), state);
  });
});

describe("Profile's Try again", () => {
  const view = read("ProfileView.tsx");
  const retryButton = buttons(view).find((tag) => tag.includes("retry()")) ?? "";

  test("stays focusable while it retries (aria-disabled, never disabled), and a second press does nothing", () => {
    assert.match(retryButton, /onClick=\{\(\) => void retry\(\)\} aria-disabled=\{retrying \|\| undefined\}/);
    assert.doesNotMatch(retryButton.replace(/aria-disabled=\{[^}]*\}/g, ""), /\bdisabled=/);
    assert.match(retryButton, /aria-disabled:opacity-60/, "it still looks busy");
    assert.match(view, /async function retry\(\) \{\s*if \(retrying\) return;\s*retryFocus\.current = true;\s*setRetrying\(true\);\s*try \{\s*await reload\(\);\s*\} finally \{\s*setRetrying\(false\);\s*\}/);
    assert.match(view, /\{retrying \? "Trying again…" : "Try again"\}/, "the label still says it is trying");
  });

  test("when the alert gives way, focus goes where focusAfterRetry says, only if it was lost", () => {
    assert.match(view, /if \(!retryFocus\.current \|\| retrying\) return;\s*const target = focusAfterRetry\(status\);\s*if \(target === "wait"\) return;\s*retryFocus\.current = false;/);
    assert.match(view, /const active = document\.activeElement;\s*if \(active && active !== document\.body\) return;/, "focus the member moved elsewhere stays there");
    assert.match(view, /target === "heading" \? document\.getElementById\("profile-name-title"\)\s*: target === "action" \? alertBox\.current\?\.querySelector<HTMLElement>\("a, button"\)/);
    assert.match(view, /\}, \[status, retrying\]\);/);
    assert.match(view, /<div ref=\{alertBox\} role="alert"/);
    // The heading takes focus from script only: it is no Tab stop.
    assert.match(view, /<h1 id="profile-name-title" tabIndex=\{-1\} className="[^"]*\boutline-none\b/);
  });
});
