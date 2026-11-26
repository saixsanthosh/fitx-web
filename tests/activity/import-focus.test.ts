// Release 3 fix round 3e (open item of round 3d's browser re-check, D5): on /activity/import the Import bar showed only
// while a file without a result was waiting on it, so it went as the last file started importing, taking its focused
// "Importing…" button (aria-disabled) with it, and focus fell to the page; once every file had its result nothing
// handed it on. The bar now stays the whole time it imports. Once every file has its result and nothing is left for
// it, it goes and the import's result ("2 imported.", partial results and failures too) takes focus, unless the member
// had moved focus somewhere else meanwhile.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handsFocusOn, type FocusDocument } from "@/lib/activity/focus";
import { importBarShown, summariseResults, type BarFile } from "@/lib/activity/import/plan";

const read = (file: string) => readFileSync(file, "utf8");
const file = (phase: BarFile["phase"], done = false, sport: BarFile["sport"] = "run"): BarFile => ({ phase, done, sport });

describe("the Import bar", () => {
  test("two new files, imported one after the other: shown from the choice to the last result, then gone", () => {
    assert.equal(importBarShown([file("ready"), file("ready")], false), true, "Import 2 activities");
    assert.equal(importBarShown([file("importing"), file("ready")], true), true, "the first file importing");
    // The last file importing: no file is waiting on the bar any more, but it still imports, so it stays.
    assert.equal(importBarShown([file("done", true), file("importing")], true), true, "the second file importing");
    assert.equal(importBarShown([file("done", true), file("importing")], false), false, "what it went by before: the bar went here, with focus on Importing…");
    // Every file has its result: the bar goes (and the result takes focus, below).
    assert.equal(importBarShown([file("done", true), file("done", true)], false), false);
  });

  test("one file: shown while it imports (it used to go as soon as Import was pressed)", () => {
    assert.equal(importBarShown([file("ready")], false), true);
    assert.equal(importBarShown([file("importing")], true), true);
    assert.equal(importBarShown([file("done", true)], false), false);
  });

  test("a file already in FITX keeps the bar, as “Nothing to import yet”, until an import says why it was left out", () => {
    // Its check says "already": it can't be imported, but it is ready with its sport, so the bar waits on it.
    assert.equal(importBarShown([file("ready")], false), true);
    // With a new file beside it: both get their result ("1 imported, 1 already in FITX.").
    assert.equal(importBarShown([file("done", true), file("done", true)], false), false);
  });

  test("a file that can't be read, or isn't a sport FITX records, waits on the bar to say so; one still being read does not", () => {
    assert.equal(importBarShown([file("failed", false, null)], false), true);
    assert.equal(importBarShown([file("unsupported", false, null)], false), true);
    assert.equal(importBarShown([file("reading", false, null)], false), false);
  });

  test("a file whose sport isn't chosen doesn't keep the bar after an import; choosing one brings it back", () => {
    assert.equal(importBarShown([file("done", true), file("ready", false, null)], false), false);
    assert.equal(importBarShown([file("done", true), file("ready", false, "walk")], false), true);
    assert.equal(importBarShown([], false), false);
  });
});

describe("focus once the import is done", () => {
  test("the result takes focus when it fell to the page as the bar went; focus the member moved meanwhile stays", () => {
    const body = { name: "the page" };
    const dropped: FocusDocument = { activeElement: body, body };
    assert.equal(handsFocusOn(dropped, { pressed: true, wentWithFocus: false }), true, "Importing… went with the bar");
    const link: FocusDocument = { activeElement: { name: "Open activity" }, body };
    assert.equal(handsFocusOn(link, { pressed: true, wentWithFocus: false }), false, "the member tabbed to a file's Open activity meanwhile");
    const button = { name: "Import 1 activity" };
    assert.equal(handsFocusOn({ activeElement: button, body }, { pressed: true, wentWithFocus: false }), false, "the bar stayed (a sport chosen meanwhile): focus stays on its button");
  });

  test("an import always has a result to read, partial and failed ones too", () => {
    assert.equal(summariseResults([{ kind: "imported", id: "a" }, { kind: "imported", id: "b" }]), "2 imported.");
    assert.equal(summariseResults([{ kind: "imported", id: "a" }, { kind: "already", id: "b" }]), "1 imported, 1 already in FITX.");
    assert.equal(summariseResults([{ kind: "failed", reason: "You’re offline." }, { kind: "failed", reason: "You’re offline." }]), "2 not imported.");
    assert.equal(summariseResults([]), "Nothing was imported.");
  });

  test("the screen's wiring", () => {
    const screen = read("src/components/activity/ActivityImportScreen.tsx");
    assert.match(screen, /const barShown = importBarShown\(entries\.map\(\(entry\) => \(\{ phase: entry\.phase, done: entry\.result !== null, sport: sportOf\(entry\) \}\)\), importing\);/);
    assert.doesNotMatch(screen, /open && settled/, "the bar no longer goes while it imports");
    // The bar keeps round 3d's offsets (7fe3ddb): 8 px above the privacy banner while that is open.
    assert.match(screen, /\{open && barShown && \(\s+<div data-coach-avoid="" className="sticky bottom-\[max\(5rem,calc\(var\(--fitx-inset-consent,0px\)\+8px\)\)\] z-10 rounded-xl border border-fitx-border bg-fitx-elevated p-3 shadow-lg md:bottom-\[max\(1rem,calc\(var\(--fitx-inset-consent,0px\)\+8px\)\)\]">/);
    // A press that starts an import asks for the hand-off; one that does nothing (Nothing to import yet, Importing…) doesn't.
    assert.match(screen, /if \(!userId \|\| importing \|\| reading \|\| lookupFailed \|\| toImport\.length === 0\) return;\s+const supabase = createClient\(\);\s+if \(!supabase\) return;\s+importPressed\.current = true;\s+setImporting\(true\);/);
    assert.match(screen, /useEffect\(\(\) => \{\s+if \(importing \|\| !importPressed\.current\) return;\s+importPressed\.current = false;\s+if \(handsFocusOn\(document, \{ pressed: true, wentWithFocus: false \}\)\) summaryRef\.current\?\.focus\(\);\s+\}, \[importing\]\);/);
    // The result is focusable (not in the Tab order) and still read out as it changes.
    assert.match(screen, /<p ref=\{summaryRef\} tabIndex=\{-1\} role="status" aria-live="polite"/);
    // The summary is set with the last result and importing ends in the same draw, so the bar goes as the result shows.
    assert.match(screen, /setSummary\(summariseResults\(results\)\);\s+setImporting\(false\);/);
    assert.ok(screen.indexOf("const importPressed = useRef(false);") < screen.indexOf('if (account.status === "loading")'), "before the early returns");
  });
});
