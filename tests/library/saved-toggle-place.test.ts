// Release 3 fix round 3f (open-3d-library-saved-message-place, open item 2 of round 3d; D5, D6). In the Exercise
// library, a save or unsave that failed put the bookmark back, but said why at the top of "Search and filters", far
// from the card; in the Saved view the unsaved card had left the list (it came back) and focus stayed on the next
// card's bookmark. Now the reason shows in the card whose bookmark was pressed, right under the bookmark, which carries
// it for screen readers, and that bookmark has focus again, unless the member has moved focus elsewhere since. The
// page and the card are JSX, which `node --test` cannot render: the decisions are pure and tried here; the wiring is
// read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookmarkTakesFocusBack, savedToggleProblem } from "@/app/(dashboard)/exercises/_lib/saved-toggle";
import { libraryFocusAfter } from "@/app/(dashboard)/exercises/_lib/library-focus";

const source = (file: string) => readFileSync(file, "utf8");
const page = source("src/app/(dashboard)/exercises/page.tsx");
const card = source("src/components/exercises/discovery/ExerciseResultCard.tsx");
const hooks = source("src/app/(dashboard)/exercises/_lib/use-library.ts");
const toggle = hooks.slice(hooks.indexOf("  const toggle = useCallback("), hooks.indexOf("  }, [saved.store, savedSet, userId]);"));

describe("what the card says", () => {
  test("a failed unsave and a failed save, each in the card it is about", () => {
    assert.equal(savedToggleProblem(true), "This exercise could not be removed from your saved list. Try again.");
    assert.equal(savedToggleProblem(false), "This exercise could not be saved. Try again.");
  });
});

describe("where focus goes when the press failed", () => {
  const body = { tag: "body" };
  const nextBookmark = { tag: "Remove Hammer Curl from saved exercises" };
  const resultsHeading = { tag: "h2#exercise-results" };
  const header = { tag: "a, the app header" };

  test("the Saved view sent focus to the next card's bookmark (or the results heading): the card's own takes it back", () => {
    // Unsaving Barbell Curl in the Saved view, the card left and its neighbour's bookmark took focus (round 3d).
    const sent = libraryFocusAfter({ control: "unsave-card", cards: ["Barbell_Curl", "Hammer_Curl"], id: "Barbell_Curl" });
    assert.deepEqual(sent, { to: "card-save", id: "Hammer_Curl" });
    assert.equal(bookmarkTakesFocusBack({ activeElement: nextBookmark, body }, nextBookmark), true);
    assert.deepEqual(libraryFocusAfter({ control: "unsave-card", cards: ["Barbell_Curl"], id: "Barbell_Curl" }), { to: "results" });
    assert.equal(bookmarkTakesFocusBack({ activeElement: resultsHeading, body }, resultsHeading), true);
  });

  test("focus lost on the way (a click that does not focus, as in Safari): the bookmark takes it", () => {
    assert.equal(bookmarkTakesFocusBack({ activeElement: body, body }, null), true);
    assert.equal(bookmarkTakesFocusBack({ activeElement: null, body }, nextBookmark), true);
  });

  test("the member moved focus elsewhere since, or the bookmark kept it (any other view): nothing moves", () => {
    assert.equal(bookmarkTakesFocusBack({ activeElement: header, body }, nextBookmark), false);
    assert.equal(bookmarkTakesFocusBack({ activeElement: header, body }, null), false);
    const ownBookmark = { tag: "Save Barbell Curl" };
    assert.equal(bookmarkTakesFocusBack({ activeElement: ownBookmark, body }, null), false, "it still has focus");
  });
});

describe("the saved list's toggle reports what became of each press", () => {
  test("a failure is undone and its reason returned; the page-wide message is only about reading the list", () => {
    assert.match(toggle, /const toggle = useCallback\(async \(exerciseId: string\): Promise<SavedToggle> => \{/);
    assert.match(toggle, /if \(!userId \|\| pending\.current\.has\(exerciseId\)\) return \{ status: "ignored" \};/);
    assert.match(toggle, /if \(!error\) return \{ status: "done" \};/);
    assert.match(toggle, /setSaved\(\(current\) => \(\{ \.\.\.current, ids: withExerciseSaved\(current\.ids, exerciseId, wasSaved\) \}\)\);\n\s+return \{ status: "failed", message: savedToggleProblem\(wasSaved\) \};/);
    assert.doesNotMatch(toggle, /problem:/, "a press neither sets nor clears the page-wide message");
    assert.match(hooks, /problem: result\.error \? "Your saved exercises could not be loaded from your account\. Showing the ones on this device\." : "",/);
  });

  test("a request that throws counts as a failure, so the bookmark is never left wrong", () => {
    assert.match(toggle, /await setExerciseSaved\(createClient\(\), userId, saved\.store, exerciseId, !wasSaved\)\.catch\(\(caught: unknown\) => \(\{ error: caught \?\? new Error\("save failed"\) \}\)\);/);
  });
});

describe("the card shows its own reason, under its bookmark", () => {
  test("a role=alert message first in the card's text, named by the bookmark; nothing without a problem", () => {
    assert.match(card, /saveProblem\?: string \| null;/);
    assert.match(card, /const problemId = useId\(\);/);
    assert.match(card, /aria-describedby=\{saveProblem \? problemId : undefined\}/);
    const body = card.slice(card.indexOf('<div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-3.5">'));
    assert.match(body, /^<div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-3\.5">\n\s+\{\/\*[\s\S]*?\*\/\}\n\s+\{saveProblem && <p id=\{problemId\} role="alert" className="relative z-10 [^"]*text-fitx-danger">\{saveProblem\}<\/p>\}\n\s+<h3 /);
  });
});

describe("the page: the reason goes to the card that was pressed, and focus back to its bookmark", () => {
  test("each list's cards know which list they are in; only the pressed one shows the reason", () => {
    assert.match(page, /const renderCard = \(item: RankedExercise, index = 0, place: CardPlace = "results"\) => \(/);
    assert.match(page, /saveProblem=\{saveProblem\?\.id === item\.exercise\.id && saveProblem\.place === place \? saveProblem\.message : null\}/);
    assert.match(page, /<div ref=\{recentGrid\} className="[^"]+">\{recentMatches\.map\(\(item, index\) => renderCard\(item, index, "recent"\)\)\}<\/div>/);
    assert.match(page, /\{renderCard\(item, index\)\}/, "the results grid: the default place");
  });

  test("a press clears the last reason, keeps where it sent focus, and a failure is shown with a new number", () => {
    assert.match(page, /const focusAfter = \(press: LibraryPress\): LibraryFocus => \{\n\s+const target = libraryFocusAfter\(press\);\n\s+setLibraryFocus\(\(current\) => \(\{ target, seq: \(current\?\.seq \?\? 0\) \+ 1 \}\)\);\n\s+return target;\n\s+\};/);
    assert.match(page, /void toggle\(id\)\.then\(\(outcome\) => \{\n\s+if \(outcome\.status !== "failed"\) return;\n\s+saveProblemSeq\.current \+= 1;\n\s+setSaveProblem\(\{ id, place, message: outcome\.message, movedTo, seq: saveProblemSeq\.current \}\);/);
  });

  test("once shown, the card's bookmark takes focus back from where the press sent it (once per failure)", () => {
    const effect = page.slice(page.indexOf("    if (!saveProblem || saveProblem.seq === handledSaveProblem.current) return;"), page.indexOf("  }, [saveProblem]);"));
    assert.ok(effect.length > 0);
    assert.match(effect, /handledSaveProblem\.current = saveProblem\.seq;/);
    assert.match(effect, /const bookmark = bookmarkIn\(place === "recent" \? recentGrid\.current : resultsGrid\.current, id\);/);
    assert.match(effect, /const sentTo = movedTo\?\.to === "results" \? document\.getElementById\(RESULTS_TITLE\) : movedTo\?\.to === "card-save" \? bookmarkIn\(resultsGrid\.current, movedTo\.id\) : null;/);
    assert.match(effect, /if \(bookmark && bookmarkTakesFocusBack\(document, sentTo\)\) bookmark\.focus\(\);/);
    assert.match(page, /function bookmarkIn\(grid: ParentNode \| null, id: string\): HTMLElement \| null \{\n\s+return findMarked\(grid\?\.querySelectorAll<HTMLElement>\(`\[\$\{LIBRARY_MARKS\.card\}\]`\) \?\? \[\], LIBRARY_MARKS\.card, id\)\?\.querySelector<HTMLElement>\("button\[aria-pressed\]"\) \?\? null;/);
  });

  test("the top of Search and filters says only that the saved list could not be read", () => {
    assert.match(page, /\{saved\.problem && <p role="alert" className="fitx-alert fitx-alert-danger m-0">\{saved\.problem\}<\/p>\}/);
    assert.doesNotMatch(page + hooks, /That exercise could not be/, "the old page-wide wording is gone");
  });
});
