// Release 3 fix round 3f (open-3d-programme-left-elsewhere-focus, open item 3 of round 3d; D5). On
// /workouts/programme, if the member had left the programme in another tab, "Show earlier weeks" then showed "You’re
// not following a programme" in place of the page: the button went, and keyboard focus fell to the page body. That
// state's heading now takes focus, if focus went with the button (a member who moved it meanwhile keeps it). The same
// in the same place: weeks loaded for a programme changed in another tab meanwhile may not include the week focus was
// to go to; the page's own heading then takes it, never the page. The page is JSX, which `node --test` cannot render:
// its wiring is read from the source, and the focus move runs on a stand-in page.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusHeading } from "@/lib/workouts/focus-heading";

const page = readFileSync("src/app/(dashboard)/workouts/programme/page.tsx", "utf8");
const load = page.slice(page.indexOf("  const load = useCallback("), page.indexOf("  }, [todayKey]);") + 18);
const showEarlier = page.slice(page.indexOf("  async function showEarlier() {"), page.indexOf("\n  }\n", page.indexOf("  async function showEarlier() {")) + 4);

/** A stand-in page: <body>, what has focus, and the headings by id (each records its focus). */
function standIn(ids: string[], activeElement: unknown = null) {
  const body = { tag: "body" };
  const headings = new Map(ids.map((id) => {
    const heading = {
      id,
      tabIndex: 0,
      focused: 0,
      focus() { heading.focused += 1; lookup.activeElement = heading; },
      matches: () => true,
      scrollIntoView: () => undefined,
    };
    return [id, heading];
  }));
  const lookup = { activeElement: activeElement ?? body, body, getElementById: (id: string) => headings.get(id) ?? null };
  return { lookup, headings, body };
}

describe("Show earlier weeks finds the programme left in another tab", () => {
  test("the load says so: no programme followed is its own outcome, not a success", () => {
    assert.match(load, /if \(!current\.enrolment\) \{ setState\("none"\); return "none"; \}/);
    assert.match(page, /type LoadOutcome = "ready" \| "none" \| "failed";/);
  });

  test("then the state that replaced the page takes focus; the weeks only when they loaded; nothing when it failed", () => {
    assert.match(showEarlier, /if \(outcome === "ready"\) setWeekFocus\(\(current\) => \(\{ shown, seq: \(current\?\.seq \?\? 0\) \+ 1 \}\)\);\n\s+else if \(outcome === "none"\) setNoneFocus\(\(value\) => value \+ 1\);/);
    assert.match(page, /const \[noneFocus, setNoneFocus\] = useState\(0\);\n\s+useEffect\(\(\) => \{ if \(noneFocus\) focusHeading\(document, NONE_HEADING\); \}, \[noneFocus\]\);/);
    assert.match(page, /const NONE_HEADING = "programme-none-title";/);
  });

  test("that state's heading is the one named, under the page's h1", () => {
    const none = page.split("\n").find((line) => line.includes("if (state === \"none\" || !loaded || !view) return")) ?? "";
    assert.match(none, /\{heading\}<EmptyState headingLevel=\{2\} title="You’re not following a programme" headingId=\{NONE_HEADING\} /);
    assert.match(none, /<Link href="\/workouts" className="fitx-button">Choose a programme<\/Link>/, "Tab goes on to its one control");
  });

  test("on the page: the button went (focus on the body), so the heading takes focus and is no Tab stop of its own", () => {
    const { lookup, headings } = standIn(["programme-page-title", "programme-none-title"]);
    assert.equal(focusHeading(lookup, "programme-none-title"), true);
    const heading = headings.get("programme-none-title")!;
    assert.equal(heading.focused, 1);
    assert.equal(heading.tabIndex, -1);
    assert.equal(lookup.activeElement, heading);
  });

  test("a member who moved focus while it loaded (to the header, say) keeps it there", () => {
    const header = { tag: "a" };
    const { lookup, headings } = standIn(["programme-none-title"], header);
    assert.equal(focusHeading(lookup, "programme-none-title"), false);
    assert.equal(headings.get("programme-none-title")!.focused, 0);
    assert.equal(lookup.activeElement, header);
  });
});

describe("weeks loaded for a programme changed in another tab", () => {
  const effect = page.slice(page.indexOf("    if (!weekFocus || weekFocus.seq === handledWeekFocus.current || !view || !loaded) return;"), page.indexOf("  }, [weekFocus, view, loaded]);"));

  test("the button stays while there are earlier weeks: focus stays on it, as before", () => {
    assert.match(effect, /if \(target === "button"\) return;/);
  });

  test("the week focus was to go to is not drawn: the page's own heading takes focus (if lost), never the page", () => {
    assert.match(effect, /const heading = target \? document\.querySelector<HTMLElement>\(`\[data-journey-week="\$\{target\}"\] h2`\) : null;\n\s+\/\/[^\n]*\n\s+if \(!heading\) \{ focusHeading\(document, PROGRAMME_FOCUS\.heading\); return; \}\n\s+heading\.tabIndex = -1;\n\s+heading\.focus\(\);/);
    assert.match(page, /import \{ focusHeading \} from "@\/lib\/workouts\/focus-heading";/);
  });
});
