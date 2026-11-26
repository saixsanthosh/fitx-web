// Release 3 review (a11y-copy): the workout builder's totals line ("6 exercises · 18 sets · ≈ 45 min (estimate)") was a
// polite live region, so a screen reader read it out on every digit typed in a row's Sets, Reps or Rest and on each
// Arrow Up/Down step; and since the builder got its own status line (bug 14), every Remove was said twice, with the
// picker's "N in the plan" a third time. Now the builder's status line alone says what Swap, Remove and a move did,
// and the picker reads out only its matches as a search narrows. The page is JSX, which node --test cannot render:
// the regions are read from the source; the status line's words are tested in builder-focus.test.ts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { removeNotice } from "@/app/(dashboard)/workouts/_lib/builder-rows";

const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
const picker = readFileSync("src/components/workouts/LibraryPicker.tsx", "utf8");
const row = readFileSync("src/components/workouts/BuilderRow.tsx", "utf8");

/** The opening tag of the element that holds `marker`, as written in the source. */
const tagHolding = (text: string, marker: string) => {
  const at = text.indexOf(marker);
  assert.ok(at > 0, marker);
  return text.slice(text.lastIndexOf("<", at), text.indexOf(">", text.lastIndexOf("<", at)) + 1);
};

describe("the builder speaks once per action, and never while the member types", () => {
  test("the totals line is not a live region", () => {
    const summary = tagHolding(page, "{builderSummary.exercises} exercise{");
    assert.match(summary, /^<p className="mb-3 text-xs text-fitx-text-secondary">$/);
    assert.doesNotMatch(summary, /aria-live|role=/);
  });

  test("the rows' number boxes change the plan on every key press, so nothing they change may be live", () => {
    assert.match(row, /type="number"/);
    for (const field of ["target_sets", "reps_min", "reps_max", "rest_seconds"]) assert.match(row, new RegExp(`onUpdate\\("${field}"`), field);
    assert.doesNotMatch(page, /aria-live="polite">\{builderSummary/);
  });

  test("Remove is said once, by the builder's status line, with what is left", () => {
    assert.match(page, /<p role="status" className="sr-only">\{builderNotice\}<\/p>/);
    const remove = page.slice(page.indexOf("function removePreview("), page.indexOf("async function saveEquipment()"));
    assert.match(remove, /setBuilderNotice\(removeNotice\(item\.exercise\.name, preview\.length - 1\)\);/);
    assert.equal(removeNotice("Superman", 4), "Removed Superman. 4 exercises left.");
  });

  test("the picker reads out its matches as a search narrows, not the plan's count", () => {
    const line = picker.slice(picker.lastIndexOf("<p", picker.indexOf("in the plan · ")), picker.indexOf("</p>", picker.indexOf("in the plan · ")) + 4);
    assert.match(line, /^<p className="text-xs text-fitx-text-secondary">\{selected\.size\} in the plan · <span aria-live="polite">\{results\.length\.toLocaleString\(\)\} \{results\.length === 1 \? "match" : "matches"\}<\/span><\/p>$/);
    assert.equal((picker.match(/aria-live/g) ?? []).length, 1);
  });
});
