// The same mistake as the active workout's Finish and Abandon (release 3 re-check, D5), found elsewhere in Workouts: an
// action that worked took away the part of the page that held focus, and focus fell to the page body. Following a
// programme (the programme list and its Follow sheet give way to the programme card), the first-visit setup's Later
// and Save setup (the setup goes), and the setup's Back on its second step (the first step has no Back). The pages are
// JSX, which `node --test` cannot render, so the wiring is read from their source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stepMoveRemovesButton } from "@/components/workouts/setup-steps";

const source = (file: string) => readFileSync(file, "utf8");
const page = source("src/app/(dashboard)/workouts/page.tsx");
const flow = source("src/components/workouts/WorkoutSetupFlow.tsx");
/** From `start` up to (not including) the first `end` after it. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} is found`);
  return text.slice(from, text.indexOf(end, from));
}

describe("Follow, then Start programme", () => {
  test("once the programme is followed, the Programme heading takes focus, above the card that says the result", () => {
    const enrol = between(page, "async function enrol(", "\n  }\n");
    // A refusal goes back to the sheet, which shows it there and keeps focus on Start programme (never disabled).
    const refused = enrol.indexOf("return result.alreadyActive ?");
    const reloaded = enrol.lastIndexOf("await load();");
    const said = enrol.lastIndexOf("setProgrammeNote({");
    const moved = enrol.indexOf("setProgrammeFocus((value) => value + 1);");
    assert.ok(refused > 0 && reloaded > refused && said > reloaded && moved > said, "after the reload and the card's line");
    assert.match(enrol, /setProgrammeFocus\(\(value\) => value \+ 1\);\n\s+return null;$/);
    assert.match(page, /const heading = programmeFocus \? document\.getElementById\("programme-title"\) : null;/);
    // The heading is the Programme section's own, there before and after the card replaces the list.
    assert.match(page, /<Section title="Programme" id="programme">/);
    assert.match(source("src/components/ui/Section.tsx"), /const headingId = `\$\{id \?\? fallback\}-title`;/);
  });
});

describe("the first-visit setup's Later and Save setup", () => {
  test("Workout setup in the header takes focus when the setup goes, if focus went with it", () => {
    assert.match(page, /const setupButtonRef = useRef<HTMLButtonElement>\(null\);\n\s+const \[setupFocus, setSetupFocus\] = useState\(0\);\n\s+useEffect\(\(\) => \{ if \(setupFocus && focusLost\(document\)\) setupButtonRef\.current\?\.focus\(\); \}, \[setupFocus\]\);/);
    assert.match(page, /\{setup && <button ref=\{setupButtonRef\} type="button" [^>]*onClick=\{\(\) => setSetupOpen\(true\)\} aria-haspopup="dialog">/);
  });

  test("Later moves it; Save setup only when the page's own setup saved (the sheet gives focus back itself)", () => {
    assert.match(between(page, "function laterSetup()", "\n  }\n"), /setSetupLater\(true\);[\s\S]*setSetupFocus\(\(value\) => value \+ 1\);$/);
    assert.match(between(page, "function setupSaved(", "\n  }\n"), /if \(!setupOpen\) setSetupFocus\(\(value\) => value \+ 1\);/);
    // The page's setup shows only while the sheet is closed, so a save with the sheet closed came from it.
    assert.match(page, /\{setup && !setup\.done && !setupLater && !setupOpen && \(/);
    // The setup sheet returns focus to what opened it, Workout setup.
    assert.match(source("src/components/workouts/Sheet.tsx"), /if \(previous\?\.isConnected\) previous\.focus\(\);/);
    // A failed save never reaches onSaved: Save setup stays, with the problem, and keeps focus.
    const save = between(flow, "async function save()", "const toggleKey");
    assert.ok(save.indexOf("if (outcome.error)") > 0 && save.indexOf("if (outcome.error)") < save.indexOf("onSaved({"));
  });
});

describe("the setup's Back on its second step", () => {
  test("only Back from the second step takes its own button away", () => {
    assert.equal(stepMoveRemovesButton(1, -1), true, "the first step has no Back");
    assert.equal(stepMoveRemovesButton(2, -1), false, "Back is still there on the second step");
    assert.equal(stepMoveRemovesButton(3, -1), false);
    assert.equal(stepMoveRemovesButton(0, 1), false, "Next stays where it is");
    assert.equal(stepMoveRemovesButton(2, 1), false, "Next turning into Save setup is the same button");
  });

  test("the step's title then takes focus", () => {
    assert.match(flow, /useEffect\(\(\) => \{ if \(titleFocus\) focusHeading\(document, "workout-setup-title"\); \}, \[titleFocus\]\);/);
    assert.match(flow, /if \(stepMoveRemovesButton\(stepIndex, delta\)\) setTitleFocus\(\(value\) => value \+ 1\);/);
    assert.match(flow, /<h2 id="workout-setup-title" className=\{styles\.title\}>\{STEP_TITLES\[step\]\}<\/h2>/);
    // Why only that move: Back is there from the second step on, and Next / Save setup are one button in one place
    // (React keeps the same element, so focus stays on it).
    assert.match(flow, /\{stepIndex > 0\n\s+\? <button type="button" onClick=\{\(\) => go\(-1\)\}/);
    assert.match(flow, /\{last\n\s+\? <button type="button" onClick=\{\(\) => \{ if \(!saving\) void save\(\); \}\}[^\n]*\n\s+: <button type="button" onClick=\{\(\) => go\(1\)\}/);
  });
});
