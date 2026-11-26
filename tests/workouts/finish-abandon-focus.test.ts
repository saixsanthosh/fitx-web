// Release 3 re-check (a side note of bug 84's re-check, the same at 99d06a8): once Finish workout or Abandon had worked,
// the finish screen or the abandoned state replaced the running workout, the button that held focus went with it, and
// keyboard focus fell to the page body (D5). That screen's heading, which says what happened, now takes focus; when the
// action fails the button stays, with its problem beside it, and keeps focus. The page is JSX, which `node --test`
// cannot render, so the wiring is read from its source; focusHeading is tried on a stand-in page.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusHeading, focusLost } from "@/lib/workouts/focus-heading";

const source = (file: string) => readFileSync(file, "utf8");
const page = source("src/app/(dashboard)/workouts/active/page.tsx");
/** A function of the page's component, from its first line to its closing brace (two-space indent). */
function body(name: string): string {
  const start = page.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is found`);
  return page.slice(start, page.indexOf("\n  }\n", start) + 5);
}

describe("focusHeading", () => {
  const body = { tag: "body" };
  const heading = () => {
    const focusedAt: number[] = [];
    const element: { tabIndex: number; focus(): void } = { tabIndex: 0, focus: () => { focusedAt.push(element.tabIndex); } };
    return { element, focusedAt };
  };

  test("focus is lost when the page body has it, or nothing does", () => {
    assert.equal(focusLost({ activeElement: body, body }), true, "the control that had it went away");
    assert.equal(focusLost({ activeElement: null, body }), true);
    assert.equal(focusLost({ activeElement: { tag: "a" }, body }), false);
  });

  test("once focus is lost, focuses the heading, made focusable by script only (tabIndex -1: not a Tab stop)", () => {
    const { element, focusedAt } = heading();
    const asked: string[] = [];
    const page = { activeElement: body, body, getElementById: (id: string) => { asked.push(id); return id === "workout-complete-title" ? element : null; } };
    assert.equal(focusHeading(page, "workout-complete-title"), true);
    assert.deepEqual(asked, ["workout-complete-title"]);
    assert.deepEqual(focusedAt, [-1]);
  });

  test("focus the member has moved somewhere that is still there stays there", () => {
    const { element, focusedAt } = heading();
    assert.equal(focusHeading({ activeElement: { tag: "a" }, body, getElementById: () => element }, "workout-complete-title"), false);
    assert.deepEqual(focusedAt, []);
    assert.equal(element.tabIndex, 0);
  });

  test("with no such heading on the page nothing moves and nothing throws", () => {
    assert.equal(focusHeading({ activeElement: body, body, getElementById: () => null }, "workout-abandoned-title"), false);
  });
});

describe("Finish workout and Abandon hand focus to the screen that replaces the workout", () => {
  test("each screen's heading has its own id, used nowhere else on the page", () => {
    assert.match(page, /const COMPLETE_HEADING = "workout-complete-title";\nconst ABANDONED_HEADING = "workout-abandoned-title";/);
    assert.match(page, /<PageHeader title="Workout complete" meta="Saved to your workout history\." titleId=\{COMPLETE_HEADING\} \/>/);
    assert.match(page, /<EmptyState headingLevel=\{2\} title="Workout abandoned" headingId=\{ABANDONED_HEADING\} /);
    assert.equal(page.match(/titleId=|headingId=/g)?.length, 2, "only those two headings are named");
    for (const id of ["workout-complete-title", "workout-abandoned-title"]) assert.equal(page.split(id).length - 1, 1, `${id} is written once`);
    assert.doesNotMatch(page, /\bid="workout-(complete|abandoned)-title"/);
  });

  test("once the finish has worked, the finish screen's h1 'Workout complete' takes focus", () => {
    assert.match(page, /const \[closedFocus, setClosedFocus\] = useState<string \| null>\(null\);\n\s+useEffect\(\(\) => \{ if \(closedFocus\) focusHeading\(document, closedFocus\); \}, \[closedFocus\]\);/);
    assert.match(body("showCompletion"), /setFinished\(true\);\n\s+setSaving\(false\);\n\s+setClosedFocus\(COMPLETE_HEADING\);/);
    // Both ways of finishing (the database function, or one request at a time) end in showCompletion; a refusal or a
    // failure says why beside Finish workout and moves nothing.
    const finish = body("finishWorkout");
    assert.doesNotMatch(finish, /setClosedFocus/);
    assert.match(finish, /if \(viaRpc\.summary\) return showCompletion\(supabase, viaRpc\.summary\.duration, viaRpc\.summary\.records\);/);
    assert.match(finish, /\n    showCompletion\(supabase, duration, recordCount\);\n  \}\n$/);
    assert.equal(finish.match(/return setProblem\(\{ at: "finish"/g)?.length, 2);
  });

  test("once the abandon has worked, the abandoned state's 'Workout abandoned' takes focus; a failure keeps it on Abandon", () => {
    const abandon = body("abandonWorkout");
    const failed = abandon.indexOf('if (result.error || !result.data) return setProblem({ at: "finish"');
    const moved = abandon.indexOf("setClosedFocus(ABANDONED_HEADING);");
    assert.ok(failed > 0 && moved > failed, "focus moves only after the failure has returned");
    assert.match(abandon, /setSession\(\{ \.\.\.session, status: "abandoned" \}\);\n\s+setClosedFocus\(ABANDONED_HEADING\);\n  \}\n$/);
  });

  test("nothing else moves focus to them: a page opened on a closed workout goes to its record instead", () => {
    assert.equal(page.match(/setClosedFocus\(/g)?.length, 2);
    assert.match(page, /if \(sessionRow\.status !== "in_progress"\) \{ setRedirecting\(true\); routerRef\.current\.replace\(recordHref\(sessionRow\.id\)\); return; \}/);
  });
});

describe("PageHeader and EmptyState name their heading only when asked (additive)", () => {
  test("PageHeader's h1 takes titleId", () => {
    const header = source("src/components/ui/PageHeader.tsx");
    assert.match(header, /titleId\?: string;/);
    assert.match(header, /<h1 id=\{titleId\} className=/);
  });

  test("EmptyState's heading takes headingId; its level rule is unchanged", () => {
    const empty = source("src/components/app/EmptyState.tsx");
    assert.match(empty, /headingLevel = 3, headingId \}: \{ title: string; description: string; action\?: ReactNode; headingLevel\?: 2 \| 3; headingId\?: string \}/);
    assert.match(empty, /<Heading id=\{headingId\} className=/);
    assert.match(empty, /const Heading = headingLevel === 2 \? "h2" : "h3";/);
  });
});
