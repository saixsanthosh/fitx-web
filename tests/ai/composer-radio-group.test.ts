// Bug 87 (coach-help-7): the coach composer's "What do you want?" was announced as a radio group but ignored the arrow
// keys, and each option was its own Tab stop. It is now a real radio group: one Tab stop, arrows move and select.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPOSER_MODES, nextMode, radioTabStop } from "@/components/coach/composer-rules";

const composer = readFileSync(new URL("../../src/components/coach/Composer.tsx", import.meta.url), "utf8");
const all = [...COMPOSER_MODES];

describe("the composer's radio group (bug 87)", () => {
  test("the arrow keys move to the next or previous choice and wrap round; Home and End go to the ends", () => {
    assert.equal(nextMode("chat", "ArrowRight", all), "meal_plan");
    assert.equal(nextMode("meal_plan", "ArrowDown", all), "workout_plan");
    assert.equal(nextMode("workout_plan", "ArrowRight", all), "chat");
    assert.equal(nextMode("chat", "ArrowLeft", all), "workout_plan");
    assert.equal(nextMode("workout_plan", "ArrowUp", all), "meal_plan");
    assert.equal(nextMode("meal_plan", "Home", all), "chat");
    assert.equal(nextMode("chat", "End", all), "workout_plan");
    assert.equal(nextMode("chat", "Tab", all), null, "Tab leaves the group");
    assert.equal(nextMode("chat", "a", all), null);
  });

  test("choices that can't be chosen are skipped; with only Ask there is nowhere to go", () => {
    assert.equal(nextMode("chat", "ArrowRight", ["chat", "workout_plan"]), "workout_plan", "Plan my meals hidden in the care period");
    assert.equal(nextMode("chat", "ArrowRight", ["chat"]), "chat");
    assert.equal(nextMode("chat", "ArrowRight", []), null, "while an answer is coming");
  });

  test("the group is one Tab stop: the chosen mode, or the first that can be chosen", () => {
    assert.equal(radioTabStop("meal_plan", all), "meal_plan");
    assert.equal(radioTabStop("meal_plan", ["chat", "workout_plan"]), "chat");
    assert.equal(radioTabStop("chat", []), null);
  });

  test("the component uses them: roving tabindex, arrow keys that select and move focus", () => {
    assert.match(composer, /<div role="radiogroup" aria-label="What do you want\?" onKeyDown=\{onRadioKey\}/);
    assert.match(composer, /tabIndex=\{id === tabStop \? 0 : -1\}/);
    assert.match(composer, /const next = focused \? nextMode\(focused, event\.key, choosable\) : null;/);
    assert.match(composer, /if \(next !== mode\) onMode\(next\);\n\s+radios\.current\.get\(next\)\?\.focus\(\);/);
    assert.match(composer, /role="radio"\n\s+data-mode=\{id\}\n\s+aria-checked=\{mode === id\}/);
  });
});
