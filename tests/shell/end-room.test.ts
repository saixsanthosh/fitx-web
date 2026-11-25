import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Review of bugs 79 and 73. While the privacy banner is open the page gets room after its end (body's padding-bottom,
// as much as the banner hides), so its last controls can be scrolled clear of the banner. That room sat outside the
// app's frame, the flex row whose sidebar and rail are `sticky top-0 h-dvh`. A sticky box never leaves its containing
// block, so once the page scrolled into the room they slid up with the frame: at 1440 x 900 with the banner's 130 px,
// the logo row and Home went off the top and the account card ended 130 px above the window's bottom. Every app page
// also scrolled by the room, even one shorter than the window. The onboarding photo frame had a strip of page colour
// under its dark photo for the same reason. Each full-height frame now holds the room inside itself.
const source = (file: string) => readFileSync(file, "utf8");
const globals = source("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const ROOM_OUT = "margin-bottom: calc(-1 * var(--fitx-inset-consent, 0px));";
const ROOM_IN = "padding-bottom: var(--fitx-inset-consent, 0px);";

/** The declarations of every rule for exactly this selector, media queries included, in file order. */
function rules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...globals.matchAll(new RegExp(`(?:^|\\n)[ \\t]*${escaped} \\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}
const classesOf = (text: string, pattern: RegExp) => (text.match(pattern)?.[1] ?? "").split(/\s+/);

/**
 * A full-height frame (min-height: one window) that ends the page, scrolled to the very end: a model of its boxes in
 * px. The banner's room is the body's padding-bottom (border-box, min-height one window); with `inside`, the frame
 * cancels it (.fitx-holds-end-room) and adds it back at the foot of its content (.fitx-end-room). It gives how far
 * the page scrolls, the strip of page colour left under the frame, where a `sticky top-0` box one window tall inside
 * the frame sits (the sidebar and the rail; it cannot leave the frame), and where the frame's content ends on screen.
 */
function scrolledToEnd({ viewport, room, content, inside }: { viewport: number; room: number; content: number; inside: boolean }) {
  const frame = Math.max(viewport, content + (inside ? room : 0));
  const page = Math.max(viewport, frame - (inside ? room : 0) + room);
  const scroll = page - viewport;
  const frameBottom = frame - scroll;
  return { scroll, strip: viewport - frameBottom, stickyTop: Math.min(0, frameBottom - viewport), contentEnd: content - scroll };
}

test("the old layout, as the review measured it: the sidebar 130 px off the top, a short page scrolling for nothing", () => {
  // 1440 x 900 with the banner open (it hides 130 px), a long page and a short one.
  const long = scrolledToEnd({ viewport: 900, room: 130, content: 2000, inside: false });
  assert.deepEqual(long, { scroll: 1230, strip: 130, stickyTop: -130, contentEnd: 770 });
  const short = scrolledToEnd({ viewport: 900, room: 130, content: 500, inside: false });
  assert.equal(short.scroll, 130, "a page shorter than the window scrolls by the room");
  assert.equal(short.stickyTop, -130);
});

test("the app's frame holds the room: the sidebar and rail stay pinned, the last control still clears the banner", () => {
  // The model's `inside` is what the code does: the frame cancels the body's room and its column adds it back.
  assert.ok(rules("body")[0].includes(ROOM_IN), "body keeps the room for any other page");
  assert.deepEqual(rules(".fitx-holds-end-room").map((body) => body.trim()), [ROOM_OUT]);
  assert.deepEqual(rules(".fitx-end-room").map((body) => body.trim()), [ROOM_IN]);
  const layout = source("src/app/(dashboard)/layout.tsx");
  const frame = classesOf(layout, /<div className="([^"]*)">\s*\{\/\* Idle unless the head script/);
  for (const token of ["fitx-holds-end-room", "flex", "min-h-dvh"]) assert.ok(frame.includes(token), token);
  assert.match(layout, /<Sidebar \/>\s*<div className="fitx-end-room min-w-0 flex-1">/, "the room is at the foot of the page's column");
  assert.match(layout, /<main id="main-content"[^>]*>\{children\}<\/main>\s*<\/div>/, "after main, inside the column");
  // The sidebar (and, at tablet widths, the rail) is the frame's sticky child, one window tall.
  const aside = classesOf(source("src/components/layout/Sidebar.tsx"), /<aside data-coach-edge="" className="([^"]+)"/);
  for (const token of ["sticky", "top-0", "h-dvh", "md:flex"]) assert.ok(aside.includes(token), token);

  const long = scrolledToEnd({ viewport: 900, room: 130, content: 2000, inside: true });
  assert.equal(long.stickyTop, 0, "pinned at the end of the page: logo row and Home in view");
  assert.equal(long.strip, 0, "no bare page colour under the sidebar");
  assert.equal(long.contentEnd, 900 - 130, "the content still ends at the banner's top edge (bug 79's room kept)");
  assert.equal(long.scroll, 1230, "as far as before");
  assert.equal(scrolledToEnd({ viewport: 900, room: 130, content: 500, inside: true }).scroll, 0, "a short page doesn't scroll");
  assert.equal(scrolledToEnd({ viewport: 900, room: 130, content: 700, inside: true }).scroll, 0, "nor one whose end needs no room");
  // Bug 73's laptop (1366 x 768 with Chrome's bars: 641 px) with the banner open: the 630 px sidebar stays whole.
  assert.equal(scrolledToEnd({ viewport: 641, room: 130, content: 1600, inside: true }).stickyTop, 0);
  // With the banner answered there is no room and nothing changes.
  assert.deepEqual(scrolledToEnd({ viewport: 900, room: 0, content: 2000, inside: true }), scrolledToEnd({ viewport: 900, room: 0, content: 2000, inside: false }));
});

test("the onboarding photo frame holds the room: the dark photo reaches the bottom, a step that fits doesn't scroll", () => {
  // AuthChrome (the auth stream's) draws onboarding in this frame: a grid of the photo and the form's column.
  const chrome = source("src/components/auth/AuthChrome.tsx");
  assert.match(chrome, /<main className="auth-layout">\s*<section className="auth-visual"/);
  assert.match(chrome, /<section className="auth-main" aria-label="Account access">/);
  const [layout, ...narrowLayout] = rules(".auth-layout");
  assert.ok(layout.includes(ROOM_OUT) && layout.includes("min-height: 100svh;"), "one window tall, the body's room cancelled");
  const [main, ...narrowMain] = rules(".auth-main");
  assert.ok(main.includes(ROOM_IN), "the room at the foot of the form's column");
  for (const body of [...narrowLayout, ...narrowMain]) assert.doesNotMatch(body, /margin|padding/, "no narrower rule undoes it");
  // The photo column stretches with the grid's row (nothing sets its height), so it grows with the room.
  for (const body of rules(".auth-visual")) assert.doesNotMatch(body, /(^|[\s;])(height|max-height|align-self):/);

  // 1440 x 900 with the banner open: before, a 130 px strip of page colour (light in the light theme) under the photo.
  assert.deepEqual(scrolledToEnd({ viewport: 900, room: 130, content: 700, inside: false }), { scroll: 130, strip: 130, stickyTop: -130, contentEnd: 570 });
  const fits = scrolledToEnd({ viewport: 900, room: 130, content: 700, inside: true });
  assert.equal(fits.scroll, 0);
  assert.equal(fits.strip, 0);
  const long = scrolledToEnd({ viewport: 900, room: 130, content: 1100, inside: true });
  assert.equal(long.strip, 0, "a long step: the photo still reaches the bottom");
  assert.equal(long.contentEnd, 770, "and its last control can be scrolled clear of the banner");
});

test("the not-found and error screens hold the room too: the card sits above the banner, no scrolling for nothing", () => {
  const [status, ...others] = rules(".fitx-status");
  assert.ok(status.includes("min-height: 100dvh;"));
  assert.ok(status.includes(ROOM_OUT));
  assert.ok(status.includes("padding: 48px var(--fitx-gutter) calc(48px + var(--fitx-inset-consent, 0px));"), "the room under the card");
  assert.equal(others.length, 0, "no other rule changes it");
  assert.match(source("src/app/not-found.tsx"), /<main id="main-content" className="fitx-status">/);
  assert.equal(scrolledToEnd({ viewport: 900, room: 130, content: 600, inside: true }).scroll, 0);
});
