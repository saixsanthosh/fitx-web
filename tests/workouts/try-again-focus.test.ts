// Release 3 fix round 3d (open item 2 of round 3c, D5): "Try again" after a failed load swapped the message, button and
// all, for a loading state, so keyboard focus fell to the page body and was still there when the reload ended. Once it
// ends, focus now goes to the heading of what loaded (the page's or the block's), or to the new Try again when it failed
// again, which carries its message (aria-describedby); only after a press of Try again, and only when focus was lost.
// The pages are JSX, which `node --test` cannot render, so their wiring is read from the source; the helper is tried
// on a stand-in page.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusControl } from "@/lib/workouts/focus-heading";
import { focusAfterReload, retryFocusTarget } from "@/lib/workouts/retry-focus";

const source = (file: string) => readFileSync(file, "utf8");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type StandIn = { tabIndex: number; focus(options?: { preventScroll?: boolean }): void; matches(selector: string): boolean; scrollIntoView(options?: { block?: "nearest" }): void };
/** A stand-in element: its tabIndex when focus() was asked, whether scrolling was prevented, and each scrollIntoView. */
function element(tabIndex: number, focusVisible = true) {
  const focusedAt: number[] = [];
  const preventScroll: Array<boolean | undefined> = [];
  const scrolled: Array<string | undefined> = [];
  const node: StandIn = {
    tabIndex,
    focus: (options) => { focusedAt.push(node.tabIndex); preventScroll.push(options?.preventScroll); },
    matches: () => focusVisible,
    scrollIntoView: (options) => { scrolled.push(options?.block); },
  };
  return { node, focusedAt, preventScroll, scrolled };
}
const body = { tag: "body" };
const page = (nodes: Record<string, StandIn>, activeElement: unknown = body) => ({ activeElement, body, getElementById: (id: string) => nodes[id] ?? null });

describe("where focus goes once a reload started by Try again ends", () => {
  test("nowhere while it still loads; the heading when it loaded; the new Try again when it failed again", () => {
    assert.equal(retryFocusTarget("loading"), null);
    assert.equal(retryFocusTarget("ready"), "heading");
    assert.equal(retryFocusTarget("failed"), "retry");
  });

  test("loaded: the heading takes focus, made focusable by script only (tabIndex -1, not a Tab stop)", () => {
    const heading = element(0);
    const retry = element(0);
    assert.equal(focusAfterReload(page({ title: heading.node, again: retry.node }), "ready", { heading: "title", retry: "again" }), true);
    assert.deepEqual(heading.focusedAt, [-1]);
    assert.deepEqual(retry.focusedAt, []);
  });

  test("failed again: the new Try again takes focus and stays a Tab stop (its tabIndex is left alone)", () => {
    const heading = element(0);
    const retry = element(0);
    assert.equal(focusAfterReload(page({ title: heading.node, again: retry.node }), "failed", { heading: "title", retry: "again" }), true);
    assert.deepEqual(retry.focusedAt, [0]);
    assert.equal(retry.node.tabIndex, 0);
    assert.deepEqual(heading.focusedAt, []);
  });

  test("failed, but the page kept what it had and has no Try again of its own: the heading", () => {
    const heading = element(0);
    assert.equal(focusAfterReload(page({ title: heading.node }), "failed", { heading: "title", retry: "again" }), true);
    assert.deepEqual(heading.focusedAt, [-1]);
  });

  test("still loading, focus moved elsewhere by the member, or nothing to focus: nothing moves", () => {
    const heading = element(0);
    const retry = element(0);
    const nodes = { title: heading.node, again: retry.node };
    assert.equal(focusAfterReload(page(nodes), "loading", { heading: "title", retry: "again" }), false);
    assert.equal(focusAfterReload(page(nodes, { tag: "a" }), "ready", { heading: "title", retry: "again" }), false);
    assert.equal(focusAfterReload(page(nodes, { tag: "a" }), "failed", { heading: "title", retry: "again" }), false);
    assert.equal(focusAfterReload(page({}), "ready", { heading: "title", retry: "again" }), false);
    assert.deepEqual([heading.focusedAt, retry.focusedAt], [[], []]);
  });

  test("keepScroll: a touch or mouse member's page stays put; after a key press the target is scrolled into view", () => {
    const pointer = element(0, false);
    focusAfterReload(page({ again: pointer.node }), "failed", { heading: "title", retry: "again" }, { keepScroll: true });
    assert.deepEqual([pointer.preventScroll, pointer.scrolled], [[true], []]);
    const keyboard = element(0, true);
    focusAfterReload(page({ title: keyboard.node }), "ready", { heading: "title", retry: "again" }, { keepScroll: true });
    assert.deepEqual([keyboard.preventScroll, keyboard.scrolled], [[true], ["nearest"]]);
    // Without keepScroll the browser's own focus scroll is used.
    const plain = element(0);
    assert.equal(focusControl(page({ again: plain.node }), "again"), true);
    assert.deepEqual([plain.preventScroll, plain.scrolled], [[undefined], []]);
  });
});

describe("useRetryFocus", () => {
  const hook = source("src/lib/workouts/retry-focus.ts");
  test("acts once, on the first render after a press where the load is no longer running, and only after a press", () => {
    assert.match(hook, /const pressed = useRef\(false\);/);
    assert.match(hook, /useEffect\(\(\) => \{\n\s+if \(!pressed\.current \|\| phase === "loading"\) return;\n\s+pressed\.current = false;\n\s+focusAfterReload\(document, phase, \{ heading, retry \}, \{ keepScroll \}\);\n\s+\}, \[phase, heading, retry, keepScroll\]\);/);
    assert.match(hook, /return useCallback\(\(\) => \{ pressed\.current = true; \}, \[\]\);/);
    assert.doesNotMatch(hook.slice(hook.indexOf("export function useRetryFocus")), /pressed\.current = true;[\s\S]*pressed\.current = true;/, "only the press sets it");
  });
});

/**
 * Each Try again in the workouts stream's files: the file, the hook call (phase and ids), the button (its id, the
 * message it carries, and the mark before the reload), and the heading and message ids it relies on.
 */
const PLACES: ReadonlyArray<{ name: string; file: string; hook: RegExp; buttons: RegExp[]; heading: RegExp; problem: RegExp[] }> = [
  {
    name: "Workouts: Workouts unavailable, and the equipment or programme alert (one at a time, the same id)",
    file: "src/app/(dashboard)/workouts/page.tsx",
    hook: /const reloadPhase: ReloadPhase = loading \? "loading" : error \|\| equipmentLoadFailed \|\| programmeLoadFailed \? "failed" : "ready";\n\s+const retrying = useRetryFocus\(reloadPhase, WORKOUTS_FOCUS\);/,
    buttons: [
      /<button id=\{WORKOUTS_FOCUS\.retry\} type="button" aria-describedby="workouts-load-problem" className="fitx-button fitx-button-secondary" onClick=\{\(\) => \{ retrying\(\); setLoading\(true\); void load\(\); \}\}>Try again<\/button>/,
      /<button id=\{WORKOUTS_FOCUS\.retry\} type="button" aria-describedby="workouts-lists-problem" onClick=\{\(\) => \{ retrying\(\); setLoading\(true\); void load\(\); \}\} className="fitx-alert-action">Try again<\/button>/,
    ],
    heading: /const WORKOUTS_FOCUS = \{ heading: "workouts-title", retry: "workouts-retry" \};[\s\S]*(<PageHeader title="Workouts" titleId=\{WORKOUTS_FOCUS\.heading\}[\s\S]*){3}/,
    problem: [/descriptionId="workouts-load-problem"/, /<span id="workouts-lists-problem">/],
  },
  {
    name: "Programme unavailable",
    file: "src/app/(dashboard)/workouts/programme/page.tsx",
    hook: /const reloadPhase: ReloadPhase = state === "loading" \? "loading" : state === "error" \? "failed" : "ready";\n\s+const retrying = useRetryFocus\(reloadPhase, PROGRAMME_FOCUS\);/,
    buttons: [/<button id=\{PROGRAMME_FOCUS\.retry\} type="button" aria-describedby="programme-load-problem" className="fitx-button fitx-button-secondary" onClick=\{\(\) => \{ retrying\(\); setState\("loading"\); void load\(\); \}\}>Try again<\/button>/],
    heading: /const PROGRAMME_FOCUS = \{ heading: "programme-page-title", retry: "programme-retry" \};/,
    problem: [/descriptionId="programme-load-problem"/],
  },
  {
    name: "History unavailable",
    file: "src/components/session/WorkoutHistoryScreen.tsx",
    hook: /const retrying = useRetryFocus\(state\.status === "error" \? "failed" : state\.status, HISTORY_FOCUS\);/,
    buttons: [/<button id=\{HISTORY_FOCUS\.retry\} type="button" aria-describedby="workout-history-problem" onClick=\{\(\) => \{ retrying\(\); setState\(\{ status: "loading" \}\); void load\(\); \}\} className="fitx-button">Try again<\/button>/],
    heading: /<PageHeader title="Workout history" meta="[^"]+" titleId=\{HISTORY_FOCUS\.heading\} \/>/,
    problem: [/descriptionId="workout-history-problem"/],
  },
  {
    name: "Workout record unavailable",
    file: "src/components/session/SessionRecordScreen.tsx",
    hook: /const retrying = useRetryFocus\(!current \? "loading" : "error" in current && current\.error === "failed" \? "failed" : "ready", RECORD_FOCUS\);/,
    buttons: [/\{current\.error === "failed" && <button id=\{RECORD_FOCUS\.retry\} type="button" aria-describedby="workout-record-problem" onClick=\{\(\) => \{ retrying\(\); setLoaded\(null\); void load\(\); \}\} className="fitx-button">Try again<\/button>\}/],
    heading: /<PageHeader title="Workout record" titleId=\{RECORD_FOCUS\.heading\} \/>/,
    problem: [/descriptionId="workout-record-problem"/],
  },
  {
    name: "The Today card",
    file: "src/components/workouts/TodayWorkout.tsx",
    hook: /const retrying = useRetryFocus\(failed \? "failed" : rows === null \? "loading" : "ready", TODAY_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{TODAY_FOCUS\.retry\} type="button" aria-describedby="today-workout-problem" className="fitx-alert-action" onClick=\{\(\) => \{ retrying\(\); onRetry\(\); \}\}>Try again<\/button>/],
    heading: /<h3 id="today-workout-title" className=\{styles\.title\}>\{plan\.title\}<\/h3>/,
    problem: [/<span id="today-workout-problem">This workout’s exercises couldn’t be loaded\.<\/span>/],
  },
  {
    name: "The exercise library: the member's details",
    file: "src/app/(dashboard)/exercises/page.tsx",
    hook: /const accountPhase: ReloadPhase = account\.status === "loading" \? "loading" : account\.status === "error" \? "failed" : "ready";\n\s+const retryingAccount = useRetryFocus\(accountPhase, ACCOUNT_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{ACCOUNT_FOCUS\.retry\} type="button" aria-describedby="library-account-problem" className="fitx-alert-action" onClick=\{\(\) => \{ retryingAccount\(\); retryAccount\(\); \}\}>Try again<\/button>/],
    heading: /title="Exercise library"\n\s+titleId=\{LIBRARY_TITLE\}/,
    problem: [/<span id="library-account-problem">Your equipment and saved exercises could not be loaded\.<\/span>/],
  },
  {
    name: "The exercise library: the library itself (its results heading once the results are worked out)",
    file: "src/app/(dashboard)/exercises/page.tsx",
    hook: /const cataloguePhase: ReloadPhase = catalogue\.status === "error" \? "failed" : catalogue\.status === "ready" && result \? "ready" : "loading";\n\s+const retryingCatalogue = useRetryFocus\(cataloguePhase, CATALOGUE_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{CATALOGUE_FOCUS\.retry\} type="button" aria-describedby="library-catalogue-problem" className="fitx-alert-action" onClick=\{\(\) => \{ retryingCatalogue\(\); retry\(\); \}\}>Try again<\/button>/],
    heading: /<h2 id=\{RESULTS_TITLE\} className=/,
    problem: [/<span id="library-catalogue-problem">The library could not be loaded\.<\/span>/],
  },
  {
    name: "Browse by muscle",
    file: "src/app/(dashboard)/exercises/muscles/page.tsx",
    hook: /const retryingCatalogue = useRetryFocus\(catalogue\.status === "error" \? "failed" : catalogue\.status, \{ heading: region \? DETAIL_TITLE : CHOOSE_TITLE, retry: CATALOGUE_RETRY \}, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{CATALOGUE_RETRY\} type="button" aria-describedby="muscles-catalogue-problem" className="fitx-alert-action" onClick=\{\(\) => \{ retryingCatalogue\(\); retry\(\); \}\}>Try again<\/button>/],
    heading: /<h2 id=\{CHOOSE_TITLE\} className="m-0 text-base font-semibold">Choose a muscle<\/h2>/,
    problem: [/<span id="muscles-catalogue-problem">The exercise library could not be loaded\.<\/span>/],
  },
  {
    name: "An exercise's note",
    file: "src/components/exercises/detail/ExerciseNote.tsx",
    hook: /const retrying = useRetryFocus\(load === null \? "loading" : load\.status === "error" \? "failed" : "ready", \{ heading: `\$\{fieldId\}-heading`, retry: `\$\{fieldId\}-retry` \}, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{`\$\{fieldId\}-retry`\} type="button" aria-describedby=\{`\$\{fieldId\}-problem`\} onClick=\{\(\) => \{ retrying\(\); onRetry\(\); \}\}/],
    heading: /<h2 id=\{`\$\{fieldId\}-heading`\} className="text-sm font-semibold text-fitx-text">Your note<\/h2>/,
    problem: [/<p id=\{`\$\{fieldId\}-problem`\} className="m-0">Your note couldn’t be loaded\.<\/p>/],
  },
  {
    name: "An exercise's History tab",
    file: "src/components/exercises/detail/HistoryPanel.tsx",
    hook: /const retryingHistory = useRetryFocus\(historyPhase\(history\), HISTORY_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<HistoryProblem history=\{history\} retryId=\{HISTORY_FOCUS\.retry\} onRetry=\{retryingHistory\} \/>/, /<button id=\{retryId\} type="button" aria-describedby=\{`\$\{retryId\}-problem`\} onClick=\{\(\) => \{ onRetry\(\); history\.retry\(\); \}\}/],
    heading: /title="No sessions yet"\n\s+headingId=\{HISTORY_FOCUS\.heading\}[\s\S]*<h2 id=\{HISTORY_FOCUS\.heading\} className=/,
    problem: [/<p id=\{`\$\{retryId\}-problem`\} className="m-0">Your history couldn’t be loaded\. Check your connection and try again\.<\/p>/],
  },
  {
    name: "An exercise's Progress tab (its own Try again: both tabs can be open at once)",
    file: "src/components/exercises/detail/ProgressPanel.tsx",
    hook: /const retryingHistory = useRetryFocus\(historyPhase\(history\), PROGRESS_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<HistoryProblem history=\{history\} retryId=\{PROGRESS_FOCUS\.retry\} onRetry=\{retryingHistory\} \/>/],
    heading: /title="No progress yet"\n\s+headingId=\{PROGRESS_FOCUS\.heading\}[\s\S]*<h2 id=\{PROGRESS_FOCUS\.heading\} className=/,
    problem: [/const PROGRESS_FOCUS = \{ heading: "exercise-progress-heading", retry: "exercise-progress-retry" \};/],
  },
  {
    name: "An exercise's alternatives",
    file: "src/components/exercises/detail/AlternativesSection.tsx",
    hook: /const retrying = useRetryFocus\(catalog\.status === "error" \? "failed" : catalog\.status, ALTERNATIVES_FOCUS, \{ keepScroll: true \}\);/,
    buttons: [/<button id=\{ALTERNATIVES_FOCUS\.retry\} type="button" aria-describedby="exercise-alternatives-problem" onClick=\{\(\) => \{ retrying\(\); setCatalog\(\{ status: "loading" \}\); setAttempt\(\(value\) => value \+ 1\); \}\}/],
    heading: /<h2 ref=\{heading\} id=\{ALTERNATIVES_FOCUS\.heading\} tabIndex=\{-1\}/,
    problem: [/<p id="exercise-alternatives-problem" className="m-0">Alternatives couldn’t be loaded\. Check your connection and try again\.<\/p>/],
  },
];

describe("every Try again in these screens hands focus on once its reload ends", () => {
  for (const place of PLACES) {
    test(place.name, () => {
      const text = source(place.file);
      assert.match(text, /import \{ useRetryFocus(, type ReloadPhase)? \} from "@\/lib\/workouts\/retry-focus";/);
      assert.match(text, place.hook);
      for (const button of place.buttons) assert.match(text, button);
      assert.match(text, place.heading);
      for (const problem of place.problem) assert.match(text, problem);
    });
  }

  test("no Try again in these screens is left without it", () => {
    let seen = 0;
    for (const file of new Set(PLACES.map((place) => place.file))) {
      const text = source(file);
      // Each "Try again" button, from its <button to its text (an arrow function's => is inside the tag).
      for (let end = text.indexOf(">Try again</button>"); end >= 0; end = text.indexOf(">Try again</button>", end + 1)) {
        const button = text.slice(text.lastIndexOf("<button", end), end + 1);
        seen += 1;
        assert.match(button, /\sid=\{/, `${file}: ${button}`);
        assert.match(button, /aria-describedby=/, `${file}: ${button}`);
        assert.match(button, /onClick=\{\(\) => \{ (retrying|retryingAccount|retryingCatalogue|onRetry)\(\);/, `${file}: ${button}`);
      }
    }
    // Workouts 2, Programme, History, the record, the Today card, the library 2, Browse by muscle, the note, the
    // History and Progress tabs' one (HistoryProblem) and Alternatives.
    assert.equal(seen, 12);
  });

  test("each page's or block's heading id is used for its heading only once in its file", () => {
    for (const id of ["workouts-title", "programme-page-title", "workout-history-title", "workout-record-title", "exercise-library-title", "muscle-choose-title"]) {
      const files = [...new Set(PLACES.map((place) => place.file))].map(source).filter((text) => text.includes(`"${id}"`));
      assert.equal(files.length, 1, id);
      assert.equal(files[0].split(`"${id}"`).length - 1, 1, `${id} is written once (a constant or one attribute)`);
    }
  });
});

describe("the screens' h1s are PageHeader's (PageHeading only wrapped it), now with an id", () => {
  test("Programme, Workout history and a workout's record name their h1", () => {
    for (const file of ["src/app/(dashboard)/workouts/programme/page.tsx", "src/components/session/WorkoutHistoryScreen.tsx", "src/components/session/SessionRecordScreen.tsx"]) {
      const text = source(file);
      assert.doesNotMatch(text, /PageHeading/, file);
    }
    assert.match(source("src/app/(dashboard)/workouts/programme/page.tsx"), new RegExp(escape('<PageHeader title={programme.title} meta={view.meta?.objective ?? programme.summary} titleId={PROGRAMME_FOCUS.heading} />')));
    assert.match(source("src/components/session/SessionRecordScreen.tsx"), /<PageHeader\n\s+title=\{session\.name\}\n\s+titleId=\{RECORD_FOCUS\.heading\}\n\s+meta=\{/);
    // PageHeading passed its description as PageHeader's meta, and nothing else: the same output.
    assert.match(source("src/components/app/PageHeading.tsx"), /return <PageHeader title=\{title\} meta=\{description\} actions=\{actions\} \/>;/);
  });

  test("EmptyState names its description only when asked (additive)", () => {
    const empty = source("src/components/app/EmptyState.tsx");
    assert.match(empty, /descriptionId\?: string \}/);
    assert.match(empty, /<p id=\{descriptionId\} className="mx-auto mt-1\.5 max-w-md text-sm leading-6 text-fitx-text-secondary">\{description\}<\/p>/);
  });
});
