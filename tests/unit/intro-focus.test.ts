import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterFilm } from "@/components/brand/introFocus";

const source = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

/**
 * The page as focusAfterFilm sees it when the film closes with focus on Skip: whether Skip shows its keyboard focus
 * ring, and its "Skip to content" links in page order, each either able to take focus or not (hidden at this width).
 * Returns what was called, which link has focus now (its index) and whether anything has.
 */
function close({ keyboard, links }: { keyboard: boolean; links: boolean[] }) {
  const calls: string[] = [];
  const doc = {
    activeElement: null as unknown,
    querySelectorAll: (selector: string) => (selector === ".fitx-skip-link" ? anchors : []),
  };
  const skip = {
    matches: (selector: string) => selector === ":focus-visible" && keyboard,
    blur: () => {
      calls.push("blur Skip");
      doc.activeElement = null;
    },
  };
  const anchors = links.map((focusable, index) => ({
    focus: (options?: FocusOptions) => {
      calls.push(`focus link ${index}${options?.preventScroll ? ", no scroll" : ""}`);
      if (focusable) doc.activeElement = anchors[index];
    },
  }));
  doc.activeElement = skip;
  const returned = focusAfterFilm(skip as unknown as HTMLElement, doc as unknown as Pick<Document, "activeElement" | "querySelectorAll">);
  const focused = anchors.findIndex((anchor) => anchor === doc.activeElement);
  assert.equal(returned, focused === -1 ? null : anchors[focused], "returns the link that took focus");
  return { calls, focused: focused === -1 ? null : focused, focusOnSkip: doc.activeElement === skip };
}

test("a keyboard user whose focus was on Skip when the film closes carries on from the page's Skip to content", () => {
  // Not from the overlay's place in the page, which on the home page is after the header.
  assert.deepEqual(close({ keyboard: true, links: [true] }), { calls: ["focus link 0, no scroll"], focused: 0, focusOnSkip: false });
  // An app page has two: the sidebar's (hidden on phones) and the header's (phones only). The first that takes focus.
  assert.deepEqual(close({ keyboard: true, links: [true, true] }), { calls: ["focus link 0, no scroll"], focused: 0, focusOnSkip: false });
  assert.deepEqual(close({ keyboard: true, links: [false, true] }), { calls: ["focus link 0, no scroll", "focus link 1, no scroll"], focused: 1, focusOnSkip: false });
  // None can take focus: it is let go rather than left on the hidden Skip.
  assert.deepEqual(close({ keyboard: true, links: [false] }), { calls: ["focus link 0, no scroll", "blur Skip"], focused: null, focusOnSkip: false });
  assert.deepEqual(close({ keyboard: true, links: [] }), { calls: ["blur Skip"], focused: null, focusOnSkip: false });
});

test("after a mouse click on Skip focus is only let go, so no skip link pops up", () => {
  assert.deepEqual(close({ keyboard: false, links: [true] }), { calls: ["blur Skip"], focused: null, focusOnSkip: false });
});

test("the film hands focus to focusAfterFilm whenever it closes with focus inside the overlay", () => {
  const intro = source("components/brand/CinematicIntro.tsx");
  const finish = intro.slice(intro.indexOf("const finish = useCallback"), intro.indexOf("const armWatchdog"));
  assert.match(finish, /previous\.focus\(\{ preventScroll: true \}\);\s*\} else if \(section && document\.activeElement instanceof HTMLElement && section\.contains\(document\.activeElement\)\) \{\s*focusAfterFilm\(document\.activeElement\);/);
  assert.doesNotMatch(finish, /\.blur\(\)/, "focusAfterFilm decides when focus is let go");
});

test("on app pages the overlay comes first, so Tab after it starts at the top of the page", () => {
  // The overlay is fixed, and inertOutside covers every sibling: its place among them changes nothing else.
  const layout = source("app/(dashboard)/layout.tsx");
  const overlay = layout.indexOf("<CinematicIntro />");
  assert.ok(overlay > -1, "the account's film is on app pages");
  for (const later of ["<Sidebar />", "<WorkspaceHeader />", "<main", "<BottomNav />"]) assert.ok(layout.indexOf(later) > overlay, later);
});

test("with reduced motion the overlay's visibility switches at once, so Replay can move focus to Skip", () => {
  // globals.css gives every element a .01 ms transition-duration then: a visibility transition would keep Skip
  // hidden, so unable to take focus, in the frame the film moves focus to it.
  assert.match(source("app/globals.css"), /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*transition-duration: \.01ms !important;/);
  const css = source("components/brand/CinematicIntro.module.css");
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(reduced, /\.intro,\s*\.intro \* \{ transition-property: opacity; \}/);
});
