// Bug 94 (cross-cutting-8): /workouts/programme and /workouts/active had no main heading when there was no programme
// or workout (only EmptyState's h3), nor in their other states. Every state of the Workouts pages now has one h1, and
// an empty state right under it is an h2. The pages are JSX, which `node --test` cannot render, so their states are
// read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(file, "utf8");
/** The one-line `if (...) return <…>;` states of a component's render. */
const stateReturns = (text: string, from: string) => text.slice(text.indexOf(from)).split("\n").filter((line) => /^\s+if \(.*\) return </.test(line));

describe("EmptyState (additive)", () => {
  test("its title is an h3 unless the box sits right under a page's h1 (headingLevel 2)", () => {
    const empty = source("src/components/app/EmptyState.tsx");
    assert.match(empty, /headingLevel = 3/);
    assert.match(empty, /const Heading = headingLevel === 2 \? "h2" : "h3";/);
  });
});

describe("every state has one h1", () => {
  test("/workouts/active: loading, no workout, not available, abandoned and finished elsewhere show 'Workout' over the state", () => {
    const page = source("src/app/(dashboard)/workouts/active/page.tsx");
    assert.match(page, /function ActiveState\(\{ children \}: \{ children: ReactNode \}\) \{\s+return <div className="mx-auto max-w-5xl"><PageHeader title="Workout" \/>\{children\}<\/div>;/);
    const states = stateReturns(page, "// Every state of the page has one main heading");
    assert.equal(states.length, 5, states.join("\n"));
    for (const line of states) assert.match(line, /return <ActiveState>/);
    for (const title of ["No workout in progress", "Workout not available", "Workout abandoned", "Opening the workout record"]) {
      assert.match(page, new RegExp(`<EmptyState headingLevel=\\{2\\} title="${title}"`), title);
    }
    assert.match(page, /<PageHeader title="Workout complete"/, "the finish screen keeps its own h1");
    assert.match(page, /<h1 className="[^"]*">\{session\.name\}<\/h1>/, "a running workout's h1 is its name");
  });

  test("/workouts/programme: loading, unavailable and not following show 'Programme' over the state", () => {
    const page = source("src/app/(dashboard)/workouts/programme/page.tsx");
    assert.match(page, /const heading = <PageHeader title="Programme"/);
    const states = stateReturns(page, "const heading = <PageHeader");
    assert.equal(states.length, 3, states.join("\n"));
    for (const line of states) assert.match(line, /\{back\}\{heading\}/);
    assert.match(page, /<EmptyState headingLevel=\{2\} title="You’re not following a programme"/);
    assert.match(page, /<PageHeading title=\{programme\.title\}/, "a followed programme's h1 is its name");
  });

  test("/workouts: the h1 is there while loading and when the page can't load", () => {
    const page = source("src/app/(dashboard)/workouts/page.tsx");
    const loading = page.slice(page.indexOf("  if (loading) return ("), page.indexOf("  // Hidden only once the database"));
    assert.equal(loading.match(/<PageHeader title="Workouts" \/>/g)?.length, 2, "loading and unavailable");
    assert.match(loading, /<EmptyState headingLevel=\{2\} title="Workouts unavailable"/);
  });

  test("/workouts/history/[id]: loading, missing, unavailable and still running show 'Workout record'", () => {
    const screen = source("src/components/session/SessionRecordScreen.tsx");
    assert.match(screen, /<PageHeader title="Workout record" \/>/);
    assert.match(screen, /if \(!current\) return <RecordState>/);
    assert.equal(screen.match(/return <RecordState><EmptyState headingLevel=\{2\}/g)?.length, 2);
  });

  test("/exercises/[id]: the exercise's name, or 'Exercise' over the unavailable state (none while loading)", () => {
    const view = source("src/components/exercises/detail/ExerciseDetailView.tsx");
    // While it loads there is no h1 at all, rather than a stand-in one: e2e flows wait for the page's h1 and then read
    // what it shows.
    const skeleton = view.slice(view.indexOf("function DetailSkeleton()"), view.indexOf("export function ExerciseDetailView"));
    assert.doesNotMatch(skeleton, /<h1/);
    assert.match(source("src/components/exercises/detail/ExerciseHeader.tsx"), /<h1 [^>]*>\{exercise\.name\}<\/h1>/);
    assert.match(view, /<PageHeader title="Exercise" \/>\s+<EmptyState\s+headingLevel=\{2\}\s+title="Exercise unavailable"/);
  });
});
