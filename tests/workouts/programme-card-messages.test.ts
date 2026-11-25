// The same mistakes as bugs 11 and 84, on the programme card: Pause, Resume programme and Finish programme were
// disabled while saving (Chrome then drops focus), Pause and Resume replace each other without handing focus on, and
// what they did (or why they did not work) was said at the top of the page, far from the card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const card = readFileSync("src/components/workouts/ProgrammeCard.tsx", "utf8");
const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");

test("Pause, Resume programme and Finish programme stay focusable while busy, and ignore a press meanwhile", () => {
  for (const name of ["Resume programme", "Pause", "Finish programme"]) {
    const button = card.match(new RegExp(`<button[^\\n]*?>(?:<[^>]+>)*${name}</button>`))?.[0] ?? "";
    assert.ok(button, `${name} is found`);
    assert.doesNotMatch(button, /\sdisabled=/, name);
    assert.match(button, /aria-disabled=/, name);
  }
});

test("Pause hands focus to Resume programme once paused, and back", () => {
  assert.match(card, /handoff\.current = "resume"; onPause\(\);/);
  assert.match(card, /handoff\.current = "pause"; onResume\(\);/);
  assert.match(card, /const target = handoff\.current === "resume" && paused \? resumeRef\.current : handoff\.current === "pause" && !paused \? pauseRef\.current : null;/);
});

test("the card says what a programme action did, or why it did not work, beside its buttons", () => {
  assert.match(card, /\{note\?\.tone === "error" && <p role="alert"/);
  assert.match(card, /<p role="status" className=\{note\?\.tone === "info"/);
  for (const action of ["paused", "resumed", "finished", "left"]) assert.match(page, new RegExp(`setProgrammeNote\\(\\{ tone: "error", text: "The programme couldn’t be ${action}`), action);
  assert.match(page, /setProgrammeNote\(\{ tone: "info", text: "Programme paused\./);
  assert.match(page, /note=\{programmeNote\}/);
});
