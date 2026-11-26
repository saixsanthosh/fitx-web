// D5 in Profile > Training (release 3 fix round 3a, the same class as review a11y-copy:a11y-home-profile-controls-drop-focus:
// a Profile control that drops keyboard focus to the page). "Older entries" lists typed equipment from an early
// onboarding that matches nothing; each chip's Remove button went with its chip, so focus fell to the page. Focus now
// moves to the next entry's Remove, else the one before it, else (none left, so the list is gone) to Save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterRemoval } from "@/lib/social/focus";

const sections = readFileSync(new URL("../../src/app/(dashboard)/profile/ProfileSections.tsx", import.meta.url), "utf8");
const training = sections.slice(sections.indexOf("export function TrainingSection"), sections.indexOf("// ─── Food"));

test("the entry that takes focus: the next one, else the one before it, else none (Save)", () => {
  const words = ["dumbell", "yoga ball", "skipping"];
  assert.equal(focusAfterRemoval(words, ["dumbell"]), "yoga ball");
  assert.equal(focusAfterRemoval(words, ["yoga ball"]), "skipping");
  assert.equal(focusAfterRemoval(words, ["skipping"]), "yoga ball", "the last one: the one before it");
  assert.equal(focusAfterRemoval(["dumbell"], ["dumbell"]), null, "none left: the list is gone");
});

test("Remove hands focus on after the chip has gone", () => {
  assert.match(training, /const next = focusAfterRemoval\(draft\.unknownEquipment, \[word\]\);\s*set\("unknownEquipment", draft\.unknownEquipment\.filter\(\(item\) => item !== word\)\);\s*requestAnimationFrame\(\(\) => \{/);
  assert.match(training, /next === null \? form\?\.querySelector<HTMLElement>\('button\[type="submit"\]'\) : form\?\.querySelector<HTMLElement>\(`\[data-older-entry="\$\{CSS\.escape\(next\)\}"\]`\)/);
  assert.match(training, /<button type="button" data-older-entry=\{word\} onClick=\{\(\) => removeOlder\(word\)\} aria-label=\{`Remove \$\{word\}`\}/);
  assert.match(training, /<form ref=\{formRef\} noValidate onSubmit=\{\(event\) => void save\(event\)\}>/, "the Training form is the one searched");
  assert.equal([...training.matchAll(/<button\b[^>]*type="submit"/g)].length, 0, "the form's only submit button is EditActions' Save");
  assert.doesNotMatch(readFileSync(new URL("../../src/components/equipment/EquipmentGrid.tsx", import.meta.url), "utf8"), /<button\b(?!\s+type="button")/, "and the equipment grid's buttons submit nothing");
});
