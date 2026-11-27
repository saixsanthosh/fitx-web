// Release 3 fix round 3d (open item 1 of round 3c, D5): in the Exercise library, controls that go with their own press
// (a filter chip, Clear all, a recent search and its ×, Clear recent, the search box's ×, the no-results buttons and
// suggestions, "Filter by …", a filter section's Clear) dropped keyboard focus to the page body. Where focus goes now is
// one decision (src/app/(dashboard)/exercises/_lib/library-focus.ts), tried here for each control; the page and the
// components carry it out, and their wiring is read from the source (JSX, which `node --test` cannot render). The
// coordinator's decision for phones: focus never moves into the search box after a press (it opens the keyboard).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIBRARY_MARKS, findMarked, libraryFocusAfter, neighbourAfterRemoval, waitsForResults, type LibraryPress } from "@/app/(dashboard)/exercises/_lib/library-focus";

const source = (file: string) => readFileSync(file, "utf8");
const page = source("src/app/(dashboard)/exercises/page.tsx");
const searchField = source("src/components/exercises/discovery/SearchField.tsx");
const activeFilters = source("src/components/exercises/discovery/ActiveFilters.tsx");
const filterPanel = source("src/components/exercises/discovery/FilterPanel.tsx");
const card = source("src/components/exercises/discovery/ExerciseResultCard.tsx");

describe("the neighbour of a removed control", () => {
  test("the next one, else the one before, else none", () => {
    assert.equal(neighbourAfterRemoval(["a", "b", "c"], "b"), "c");
    assert.equal(neighbourAfterRemoval(["a", "b", "c"], "a"), "b");
    assert.equal(neighbourAfterRemoval(["a", "b", "c"], "c"), "b", "the last one hands focus back to the one before");
    assert.equal(neighbourAfterRemoval(["a"], "a"), null, "the only one: the caller's fallback");
    assert.equal(neighbourAfterRemoval(["a", "b"], "x"), null, "not on the list");
    assert.equal(neighbourAfterRemoval([], "x"), null);
  });
});

describe("where focus goes after each control that goes with its press", () => {
  const chips = ["muscle:chest", "uses:barbell", "doable:"];
  const recent = ["bench press", "squat", "“curl”"];
  const cards = ["Barbell_Curl", "Hammer_Curl"];

  test("a filter chip: its neighbour; the last chip: the results heading (the results change)", () => {
    assert.deepEqual(libraryFocusAfter({ control: "remove-chip", chips, id: "uses:barbell" }), { to: "chip", id: "doable:" });
    assert.deepEqual(libraryFocusAfter({ control: "remove-chip", chips, id: "doable:" }), { to: "chip", id: "uses:barbell" });
    assert.deepEqual(libraryFocusAfter({ control: "remove-chip", chips: ["muscle:chest"], id: "muscle:chest" }), { to: "results" });
  });

  test("a recent search's ×: its neighbour; the last one: the Filters button, which stays where it was", () => {
    assert.deepEqual(libraryFocusAfter({ control: "forget-recent", recent, term: "bench press" }), { to: "recent", term: "squat" });
    assert.deepEqual(libraryFocusAfter({ control: "forget-recent", recent, term: "“curl”" }), { to: "recent", term: "squat" });
    assert.deepEqual(libraryFocusAfter({ control: "forget-recent", recent: ["squat"], term: "squat" }), { to: "filters" });
  });

  test("a card unsaved in the Saved view leaves the list: the next card's bookmark, else the results heading", () => {
    assert.deepEqual(libraryFocusAfter({ control: "unsave-card", cards, id: "Barbell_Curl" }), { to: "card-save", id: "Hammer_Curl" });
    assert.deepEqual(libraryFocusAfter({ control: "unsave-card", cards: ["Barbell_Curl"], id: "Barbell_Curl" }), { to: "results" });
  });

  test("Clear all, Clear recent, the search box's ×, a recent search run again, the no-results buttons and suggestions and 'Filter by …': the results heading", () => {
    const toResults: LibraryPress["control"][] = ["clear-all", "clear-recent", "clear-search", "pick-recent", "show-all", "clear-search-and-filters", "relax", "spelling", "word-filter"];
    for (const control of toResults) assert.deepEqual(libraryFocusAfter({ control } as LibraryPress), { to: "results" }, control);
  });

  test("only the results heading waits for the new results (it says the new count); a neighbour is already there", () => {
    assert.equal(waitsForResults({ to: "results" }), true);
    for (const target of [{ to: "chip", id: "a" }, { to: "recent", term: "a" }, { to: "filters" }, { to: "card-save", id: "a" }] as const) assert.equal(waitsForResults(target), false);
  });

  test("never the search box: no target is the box, and nothing in the library focuses it", () => {
    const helper = source("src/app/(dashboard)/exercises/_lib/library-focus.ts");
    assert.doesNotMatch(helper.slice(helper.indexOf("export type LibraryFocus")), /search(box|-box|Field)|"input"/i);
    assert.doesNotMatch(searchField, /\.focus\(|ref=/, "the search field never takes focus by script");
    assert.doesNotMatch(page, /searchbox|type="search"/);
  });

  test("a marked control is found by its exact value, whatever the member typed (never built into a selector)", () => {
    const node = (value: string) => ({ getAttribute: (name: string) => (name === LIBRARY_MARKS.recent ? value : null) });
    const nodes = [node("bench press"), node("a\"] b"), node("squat")];
    assert.equal(findMarked(nodes, LIBRARY_MARKS.recent, "a\"] b"), nodes[1]);
    assert.equal(findMarked(nodes, LIBRARY_MARKS.recent, "bench"), null);
    assert.equal(findMarked([], LIBRARY_MARKS.recent, "x"), null);
  });
});

describe("the controls are marked and report their press", () => {
  test("the search box's × has its own callback (typing the box empty is not a press), and each recent search's × is marked", () => {
    assert.match(searchField, /<button type="button" aria-label="Clear the search" onClick=\{onClear\}/);
    assert.match(searchField, /aria-label=\{`Remove “\$\{term\}” from recent searches`\} data-recent-forget=\{term\}/);
    assert.equal(LIBRARY_MARKS.recent, "data-recent-forget");
  });

  test("each filter chip is marked with its id; each result card with its exercise", () => {
    assert.match(activeFilters, /aria-label=\{`Remove filter: \$\{chip\.kind\} \$\{chip\.label\}`\}\n\s+data-filter-chip=\{chip\.id\}/);
    assert.equal(LIBRARY_MARKS.chip, "data-filter-chip");
    assert.match(card, /<article style=\{style\} data-exercise-card=\{exercise\.id\} /);
    assert.equal(LIBRARY_MARKS.card, "data-exercise-card");
  });

  test("a filter section's Clear hands focus to that section's first option once the section is cleared", () => {
    assert.match(filterPanel, /const cleared = useRef\(false\);\n\s+useEffect\(\(\) => \{\n\s+if \(!cleared\.current \|\| count > 0\) return;\n\s+cleared\.current = false;\n\s+if \(focusLost\(document\)\) options\.current\?\.querySelector<HTMLElement>\("button"\)\?\.focus\(\);\n\s+\}, \[count\]\);/);
    assert.match(filterPanel, /onClick=\{\(\) => \{ cleared\.current = true; onClear\(\); \}\} aria-label=\{`Clear \$\{title\.toLowerCase\(\)\}`\}/);
    assert.match(filterPanel, /<div ref=\{options\} className="flex flex-wrap gap-2">\{children\}<\/div>/);
  });
});

describe("the library page carries the decision out", () => {
  const press = (control: string) => new RegExp(`focusAfter\\(\\{ control: "${control}"`);

  test("every control reports its press, with what its neighbour needs", () => {
    assert.match(page, /onClear=\{\(\) => \{ update\(\{ q: "" \}\); focusAfter\(\{ control: "clear-search" \}\); \}\}/);
    assert.match(page, /onPickRecent=\{\(term\) => \{ update\(\{ q: term \}\); if \(userId\) setRecentSearches\(rememberSearch\(userId, term\)\); focusAfter\(\{ control: "pick-recent" \}\); \}\}/);
    assert.match(page, /onForgetRecent=\{\(term\) => \{ if \(!userId\) return; focusAfter\(\{ control: "forget-recent", recent: recentSearches, term \}\); setRecentSearches\(forgetSearch\(userId, term\)\); \}\}/);
    assert.match(page, /onClearRecent=\{\(\) => \{ if \(!userId\) return; setRecentSearches\(clearRecentSearches\(userId\)\); focusAfter\(\{ control: "clear-recent" \}\); \}\}/);
    assert.match(page, /focusAfter\(\{ control: "remove-chip", chips: chipItems\.map\(\(item\) => item\.id\), id \}\);\n\s+navigate\(withoutChip\(state, chip\)\);/);
    assert.match(page, /onClearAll=\{\(\) => \{ navigate\(withoutFilters\(state\)\); focusAfter\(\{ control: "clear-all" \}\); \}\}/);
    assert.equal(page.match(/clearLabel="Show all exercises" onClear=\{\(\) => \{ update\(\{ saved: false \}\); focusAfter\(\{ control: "show-all" \}\); \}\}/g)?.length, 2);
    assert.match(page, /onClear=\{\(\) => \{ navigate\(\{ \.\.\.withoutFilters\(state\), q: "" \}\); focusAfter\(\{ control: "clear-search-and-filters" \}\); \}\}/);
    assert.match(page, /onSpelling=\{\(text\) => \{ update\(\{ q: text \}\); focusAfter\(\{ control: "spelling" \}\); \}\}/);
    assert.match(page, /navigate\(facet === "environment" && haveKeys \? \{ \.\.\.next, have: \[\.\.\.haveKeys\] \} : next\);\n\s+focusAfter\(\{ control: "relax" \}\);/);
    assert.match(page, /onClick=\{\(\) => \{ navigate\(wordFilter\.next\); focusAfter\(\{ control: "word-filter" \}\); \}\}/);
    // Round 3f: the press keeps where it sent focus, for a failed unsave to bring it back (saved-toggle-place.test.ts).
    assert.match(page, /const movedTo = view\.saved && savedSet\.has\(id\) \? focusAfter\(\{ control: "unsave-card", cards: visible\.map\(\(entry\) => entry\.exercise\.id\), id \}\) : null;\n\s+setSaveProblem\(null\);\n\s+void toggle\(id\)\.then\(/);
    for (const control of ["clear-search", "pick-recent", "forget-recent", "clear-recent", "remove-chip", "clear-all", "show-all", "clear-search-and-filters", "spelling", "relax", "word-filter", "unsave-card"]) assert.match(page, press(control), control);
  });

  test("once the page has changed: the results heading after the new results show; else the neighbour, if focus was lost", () => {
    const effect = page.slice(page.indexOf("    if (!libraryFocus || libraryFocus.seq === handledLibraryFocus.current) return;"), page.indexOf("  }, [libraryFocus, updating, result, catalogue.status]);"));
    assert.ok(effect.length > 0);
    assert.match(effect, /if \(waitsForResults\(target\) && \(updating \|\| \(!result && catalogue\.status !== "error"\)\)\) return;\n\s+handledLibraryFocus\.current = libraryFocus\.seq;/);
    assert.match(effect, /if \(target\.to === "results"\) \{ focusHeading\(document, RESULTS_TITLE, \{ keepScroll: true \}\); return; \}\n\s+if \(!focusLost\(document\)\) return;/);
    assert.match(effect, /target\.to === "filters" \? filtersButton\.current/);
    assert.match(effect, /target\.to === "chip" \? marked\(document, LIBRARY_MARKS\.chip, target\.id\)/);
    assert.match(effect, /target\.to === "recent" \? marked\(document, LIBRARY_MARKS\.recent, target\.term\)/);
    assert.match(effect, /marked\(resultsGrid\.current, LIBRARY_MARKS\.card, target\.id\)\?\.querySelector<HTMLElement>\("button\[aria-pressed\]"\)/);
    assert.match(page, /<button ref=\{filtersButton\} type="button" aria-expanded=\{filtersOpen\} aria-controls="exercise-filters"/);
    assert.match(page, /<div key=\{filterKey\} ref=\{resultsGrid\} className=/);
    // focusHeading moves nothing when the member has put focus somewhere that is still there (tests/workouts).
  });

  test("'Show more exercises' keeps focus while there is more; once it goes, the first card it brought takes focus", () => {
    assert.match(page, /setMoreFocus\(\(current\) => \(\{ shown: visible\.map\(\(item\) => item\.exercise\.id\), seq: \(current\?\.seq \?\? 0\) \+ 1 \}\)\);\n\s+setLimit\(\{ key: viewKey, count: shownCount \+ PAGE_SIZE \}\);/);
    assert.match(page, /const target = focusAfterShowMore\(\{ more: ids\.length < result\.items\.length, shown: moreFocus\.shown, added: addedIds\(moreFocus\.shown, ids\) \}\);\n\s+if \(!target \|\| target === "button" \|\| !focusLost\(document\)\) return;/);
    assert.match(page, /LIBRARY_MARKS\.card, target\)\?\.querySelector<HTMLElement>\("h3 a"\)\?\.focus\(\);/);
    assert.match(card, /<h3 className="[^"]+">\n\s+\{\/\*[^]*?\*\/\}\n\s+<Link href=\{href\} onClick=\{onOpen\}/, "the card's one Tab stop to open it is the link in its h3");
  });

  test("'Use my saved list' goes with its press, as Save as my list does: Edit list takes focus, else 'Only show what I can do'", () => {
    assert.match(page, /onClick=\{\(\) => \{ update\(\{ have: null \}\); setListSaved\(\(value\) => value \+ 1\); \}\}/);
    assert.match(page, /useEffect\(\(\) => \{ if \(listSaved && focusLost\(document\)\) \(editListLink\.current \?\? doableSwitch\.current\)\?\.focus\(\); \}, \[listSaved\]\);/);
    assert.match(page, /<button ref=\{doableSwitch\} type="button" role="switch"/);
  });
});
