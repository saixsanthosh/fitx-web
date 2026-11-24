// Shutting the page behind a full-screen film: CinematicIntro, and the welcome film after onboarding
// (PostOnboardingSequence), which is a modal dialog over the onboarding frame's links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inertOutside, releaseInert } from "@/components/brand/inertPage";

/** Just enough of an element for inertOutside: its tag, children, parent and `inert`. */
class FakeElement {
  tagName: string;
  label: string;
  inert = false;
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  constructor(tagName: string, label: string, kids: FakeElement[] = []) {
    this.tagName = tagName;
    this.label = label;
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
  }
}

/** The /onboarding page as the welcome film plays in it: AuthChrome's frame around the sequence, the banner after it. */
function onboardingPage() {
  const cover = new FakeElement("DIV", "the sequence (the film)");
  const legal = new FakeElement("P", "Terms and Privacy Policy");
  const content = new FakeElement("DIV", "auth-content", [cover, legal]);
  const main = new FakeElement("SECTION", "auth-main", [content]);
  const visual = new FakeElement("SECTION", "auth-visual (FITX home)");
  const layout = new FakeElement("MAIN", "auth-layout", [visual, main]);
  const skipLink = new FakeElement("A", "Skip to content");
  const banner = new FakeElement("ASIDE", "cookie and analytics choices");
  const script = new FakeElement("SCRIPT", "a script");
  const shut = new FakeElement("DIV", "already inert");
  shut.inert = true;
  const body = new FakeElement("BODY", "body", [skipLink, layout, banner, script, shut]);
  return { body, cover, legal, content, main, visual, layout, skipLink, banner, script, shut };
}

test("everything outside the film is inert while it covers the page, and given back after; nothing else is touched", () => {
  const page = onboardingPage();
  const globals = globalThis as unknown as Record<string, unknown>;
  const before = { HTMLElement: globals.HTMLElement, document: globals.document };
  globals.HTMLElement = FakeElement;
  globals.document = { body: page.body };
  try {
    const marked = inertOutside(page.cover as unknown as HTMLElement) as unknown as FakeElement[];
    assert.deepEqual(marked.map((element) => element.label).sort(), ["Terms and Privacy Policy", "Skip to content", "auth-visual (FITX home)", "cookie and analytics choices"].sort());
    for (const element of [page.legal, page.visual, page.skipLink, page.banner]) assert.equal(element.inert, true, element.label);
    // The film itself and its ancestors stay live (inert on an ancestor would shut the film too); scripts are skipped.
    for (const element of [page.cover, page.content, page.main, page.layout, page.body, page.script]) assert.equal(element.inert, false, element.label);
    releaseInert(marked as unknown as HTMLElement[]);
    for (const element of [page.legal, page.visual, page.skipLink, page.banner]) assert.equal(element.inert, false, `${element.label}: given back`);
    assert.equal(page.shut.inert, true, "what was inert already stays so");
    assert.equal(marked.length, 0, "released once");
  } finally {
    globals.HTMLElement = before.HTMLElement;
    globals.document = before.document;
  }
});

test("both films use it: the intro overlay, and the sequence after onboarding for its whole life", () => {
  const intro = readFileSync("src/components/brand/CinematicIntro.tsx", "utf8");
  assert.match(intro, /import \{ inertOutside, releaseInert \} from "\.\/inertPage";/);
  assert.doesNotMatch(intro, /function inertOutside/, "one copy");
  const sequence = readFileSync("src/components/onboarding/PostOnboardingSequence.tsx", "utf8");
  assert.match(sequence, /useLayoutEffect\(\(\) => \{\s*const cover = coverRef\.current;\s*if \(!cover\) return;\s*const marked = inertOutside\(cover\);\s*return \(\) => releaseInert\(marked\);\s*\}, \[\]\);/);
  // Every step renders inside the cover: the film, the logo, and the empty stage while nothing plays.
  assert.match(sequence, /<div ref=\{coverRef\} className=\{styles\.cover\} data-post-onboarding="">\s*\{shown\}\s*<\/div>/);
  assert.doesNotMatch(sequence, /return <|return \(\s*<(?!div ref=\{coverRef\})/, "no step renders outside the cover");
  const css = readFileSync("src/components/onboarding/PostOnboarding.module.css", "utf8");
  assert.match(css, /\.cover \{\s*position: fixed;\s*inset: 0;\s*z-index: 1000;\s*background: var\(--fitx-bg\);\s*\}/);
  // The film's stage is a modal dialog: now it is one.
  assert.match(readFileSync("src/components/brand/films/WelcomeFilm.tsx", "utf8"), /role="dialog"\s+aria-modal="true"/);
});
