// Bug 84 (workouts-6): Pause session, Resume and Resume workout dropped keyboard focus to the page body. The clock's
// button was disabled while the pause saved (Chrome then drops focus), and the paused banner's button is removed once
// the workout resumes. The page is JSX, which `node --test` cannot render, so the rules are read from its source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");
const clockButton = page.match(/<button ref=\{clockButtonRef\}[\s\S]*?className="[^"]*">/)?.[0] ?? "";
const bannerButton = page.match(/<button type="button" onClick=\{\(\) => void togglePause\("banner"\)\}[\s\S]*?className="[^"]*">/)?.[0] ?? "";

test("neither button is disabled while the pause or resume saves, so focus stays on it; a second press is ignored", () => {
  assert.ok(clockButton && bannerButton, "both buttons are found");
  for (const button of [clockButton, bannerButton]) {
    assert.doesNotMatch(button, /\sdisabled=/);
    assert.match(button, /aria-disabled=\{clockSaving \|\| undefined\}/);
  }
  assert.match(page, /async function togglePause\(from: "clock" \| "banner" = "clock"\) \{\s+if \(!session \|\| !clock \|\| clockSaving\) return;/);
});

test("after Resume workout in the banner, focus moves to the clock's button (now Pause session)", () => {
  assert.match(page, /if \(from === "banner"\) setFocusClock\(\(value\) => value \+ 1\);/);
  assert.match(page, /useEffect\(\(\) => \{ if \(focusClock\) clockButtonRef\.current\?\.focus\(\); \}, \[focusClock\]\);/);
  assert.match(clockButton, /onClick=\{\(\) => void togglePause\(\)\}/, "the clock's own button stays where it is and keeps focus");
});

// Not "Session paused": e2e flow 02 waits for the banner by that text, which must stay unique on the page.
test("screen readers hear the pause and the resume", () => {
  assert.match(page, /setTimerNotice\("Workout paused\. Your training timer and rest are held\."\);/);
  assert.match(page, /setTimerNotice\("Workout resumed\."\);/);
  assert.match(page, /<p role="status" className="sr-only">\{timerNotice\}<\/p>/, "in the live region that is always on the page");
});
