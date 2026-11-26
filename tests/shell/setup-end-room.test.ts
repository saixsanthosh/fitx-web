import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression found by the release 3 re-check (reg-shell-1, bug 79's review fix). The review round put the privacy
// banner's room inside the sign-in photo frame (.auth-layout, .auth-visual), but setup hides that photo: its own dark
// stage is a sticky column one window tall inside .layout (Onboarding.module.css), and the room (.auth-main's
// padding-bottom) came after that frame and the legal note. At 1440 x 900 with the banner (130 px) open, setup step 1
// was 1075 px tall: it scrolled 175 px, and scrolled to the end the stage stopped at y 725 above 175 px of page colour.
// After "Essential only": 945 px, a 45 px strip (the legal note), as at 99d06a8. The room now goes inside .layout, at
// the foot of the form's column, with the legal note above it.
const source = (file: string) => readFileSync(file, "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const onboarding = strip(source("src/components/onboarding/Onboarding.module.css"));
const globals = strip(source("src/app/globals.css"));

const HEADER = 64; // --onboarding-header
const NOTE = 45; // the legal note: one line of .68rem at 1.55 and 28 px under it
const BAND = 56; // --onboarding-legal, 3.5rem

/**
 * Setup from 1024 px scrolled to its very end, in px: `content` is the form's column without any room (step 1 at
 * 1440 x 900: 611, to the end of the links under the form), `room` the banner's inset. Gives how far the page scrolls,
 * where the stage (sticky, one window tall, inside .layout) ends, where the legal note ends and the column's content.
 */
function setupAtEnd({ viewport, content, room, inside }: { viewport: number; content: number; room: number; inside: boolean }) {
  const layout = Math.max(viewport - HEADER, content + (inside ? BAND + room : 0));
  const frame = HEADER + layout;
  const page = inside ? frame : frame + NOTE + room;
  const scroll = page - viewport;
  return {
    scroll,
    stageEnd: frame - scroll,
    noteEnd: inside ? viewport - room : frame + NOTE - scroll,
    contentEnd: HEADER + content - scroll,
  };
}

test("before: the room after the frame left page colour under the stage and scrolled every step (the re-check)", () => {
  const open = setupAtEnd({ viewport: 900, content: 611, room: 130, inside: false });
  assert.equal(open.scroll + 900, 1075, "documentElement.scrollHeight as measured");
  assert.equal(open.scroll, 175);
  assert.equal(open.stageEnd, 725, "page colour from 725 to 900");
  const answered = setupAtEnd({ viewport: 900, content: 611, room: 0, inside: false });
  assert.equal(answered.scroll, 45, "45 px with only the legal note under the stage, as at 99d06a8");
});

test("now: the stage reaches the bottom, a step that fits doesn't scroll, the note and last control clear the banner", () => {
  for (const viewport of [900, 768, 720, 641]) {
    for (const content of [400, 611, 900, 1400]) {
      for (const room of [0, 106, 130, 182]) {
        const at = setupAtEnd({ viewport, content, room, inside: true });
        const label = `${viewport} px tall, content ${content}, room ${room}`;
        assert.equal(at.stageEnd, viewport, `${label}: the stage reaches the bottom of the window`);
        assert.equal(at.noteEnd, viewport - room, `${label}: the legal note ends at the banner's top edge`);
        assert.ok(at.contentEnd <= at.noteEnd - NOTE, `${label}: the form's column ends above the note`);
        const without = setupAtEnd({ viewport, content, room: 0, inside: true });
        if (without.scroll === 0 && content + BAND + room <= viewport - HEADER) assert.equal(at.scroll, 0, `${label}: fits, no scroll`);
        assert.ok(at.scroll <= without.scroll + room, `${label}: scrolls at most the banner's room further`);
      }
    }
  }
  // The re-check's case: step 1 at 1440 x 900 with the banner open no longer scrolls (the expected 45 px or less).
  assert.deepEqual(setupAtEnd({ viewport: 900, content: 611, room: 130, inside: true }), { scroll: 0, stageEnd: 900, noteEnd: 770, contentEnd: 675 });
  assert.equal(setupAtEnd({ viewport: 900, content: 611, room: 0, inside: true }).scroll, 0, "nor without it");
});

test("Onboarding.module.css holds the room inside .layout from 1024 px, with the legal note above it", () => {
  const wide = [...onboarding.matchAll(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  const block = wide.find((body) => body.includes(":global(.auth-main):has(.layout)")) ?? "";
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return block.match(new RegExp(`${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
  };
  assert.match(rule(":global(.auth-main):has(.layout)"), /padding-bottom: 0;/, "no room after the frame");
  const content = rule(":global(.auth-content):has(.layout)");
  assert.match(content, /--onboarding-legal: 3\.5rem;/);
  assert.match(content, /position: relative;/);
  const note = rule(":global(.auth-content):has(.layout) > :global(.auth-legal-note)");
  for (const declaration of ["position: absolute;", "right: 0;", "bottom: var(--fitx-inset-consent, 0px);", "left: calc(100% * 5 / 12);"]) {
    assert.ok(note.includes(declaration), declaration);
  }
  assert.match(rule(".layout > :not(.stage)"), /padding-bottom: calc\(var\(--onboarding-legal\) \+ var\(--fitx-inset-consent, 0px\)\);/);

  // The note's column is the form's: .layout splits 5 : 7 at the same width, and the stage is the sticky one.
  const grid = wide.find((body) => /\.layout \{\s*display: grid;/.test(body)) ?? "";
  assert.match(grid, /grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\);/);
  assert.match(grid, /\.stage \{\s*position: sticky;[^}]*height: calc\(100svh - var\(--onboarding-header\)\);/);
  // The band holds the note: .68rem at 1.55 and 28 px under it (setup's padding), at 16 px and at 24 px text.
  assert.match(globals, /\.auth-legal-note \{ margin: 32px 0 0; color: var\(--fitx-text-disabled\); font-size: \.68rem; line-height: 1\.55; \}/);
  assert.match(onboarding, /:global\(\.auth-content\):has\(\.root\) > :global\(\.auth-legal-note\) \{\s*margin: 0;\s*padding: 0 16px 28px;/);
  for (const rem of [16, 24]) assert.ok(0.68 * rem * 1.55 + 28 <= 3.5 * rem, `${rem} px text`);
  assert.ok(Math.abs(0.68 * 16 * 1.55 + 28 - NOTE) < 1 && 3.5 * 16 === BAND, "the model's note and band");
});

test("the markup the rules rely on: the note follows setup in the frame, .layout holds the stage and the form", () => {
  const chrome = source("src/components/auth/AuthChrome.tsx");
  assert.match(chrome, /<div className="auth-content" id="main-content">\s*\{children\}\s*<p className="auth-legal-note">/);
  const flow = source("src/app/(auth)/onboarding/OnboardingFlow.tsx");
  assert.match(flow, /<div className=\{styles\.layout\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<section data-onboarding-stage="" className=\{`\$\{styles\.stage\}/);
  assert.match(flow, /<\/section>\s*<div className="min-w-0">\s*<form /, "then the form's column");
});
