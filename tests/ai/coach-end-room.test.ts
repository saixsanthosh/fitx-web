// Where the coach's conversation ends after a reply (integration of release 3). Two streams kept the same thing clear in
// different files: the coach's end marker (Coach.module.css .end, bug 23's "Also seen") cleared the composer and the
// phone's bar with its own scroll-margin-bottom, and the shell's html scroll-padding-bottom (bugs 12 and 79) now keeps
// the bar, or the privacy banner while it is open, clear for every scroll. scrollIntoView adds the two, so on a phone
// the last line stopped about 90px above the composer instead of 12px, and with the banner open about half a screen
// up. The marker now asks only for what goes beyond the page's own room.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const coach = read("src/components/coach/Coach.module.css");
const globals = read("src/app/globals.css");
const desktop = coach.slice(coach.indexOf("@media (min-width: 1024px)"));
const phone = coach.slice(0, coach.indexOf("@media (min-width: 640px)"));

const number = (pattern: RegExp, text: string) => Number(pattern.exec(text)?.[1] ?? Number.NaN);
// The composer's place (its bottom edge above the window's bottom) and the gap the marker leaves above it.
const DOCK_PHONE = number(/\.composerDock \{[^}]*bottom: calc\(env\(safe-area-inset-bottom\) \+ (\d+)px\)/, phone);
const DOCK_DESKTOP = number(/\.composerDock \{ bottom: (\d+)px; \}/, desktop);
const END_PHONE = number(/\.end \{ scroll-margin-bottom: max\(0px, calc\(var\(--coach-dock-height, 180px\) \+ env\(safe-area-inset-bottom\) \+ (\d+)px - var\(--fitx-scroll-room-bottom, 0px\)\)\); \}/, phone);
const END_DESKTOP = number(/\.end \{ scroll-margin-bottom: max\(0px, calc\(var\(--coach-dock-height, 180px\) \+ (\d+)px - var\(--fitx-scroll-room-bottom, 0px\)\)\); \}/, desktop);

/** The page's bottom room, as globals.css defines it (html: --fitx-scroll-room-bottom). */
const pageRoom = (bar: number, consent: number) => Math.max(bar, consent) + 12;

/**
 * How far above the window's bottom the conversation's end stops after scrollIntoView({ block: "end" }): the page's
 * scroll padding plus the marker's scroll margin. `width` picks the rules; `safe` is the home indicator's inset.
 */
function endAt({ width, bar, consent, dock, safe = 0 }: { width: number; bar: number; consent: number; dock: number; safe?: number }) {
  const room = pageRoom(bar, consent);
  const margin = width >= 1024 ? Math.max(0, dock + END_DESKTOP - room) : Math.max(0, dock + safe + END_PHONE - room);
  const composerTop = (width >= 1024 ? DOCK_DESKTOP : safe + DOCK_PHONE) + dock;
  return { end: room + margin, composerTop, gap: room + margin - composerTop };
}

describe("the coach's end marker and the page's bottom room", () => {
  test("the rules read as the model expects", () => {
    assert.ok([DOCK_PHONE, DOCK_DESKTOP, END_PHONE, END_DESKTOP].every(Number.isFinite), [DOCK_PHONE, DOCK_DESKTOP, END_PHONE, END_DESKTOP].join(", "));
    assert.match(globals, /html \{[^}]*--fitx-scroll-room-bottom: calc\(max\(var\(--fitx-inset-bottom-bar, 0px\), var\(--fitx-inset-consent, 0px\)\) \+ 12px\);[^}]*scroll-padding-bottom: var\(--fitx-scroll-room-bottom\);/);
    // Inside the floating panel the conversation scrolls in its own box, which has no page padding: unchanged.
    assert.match(coach, /\.panelLayout \.end \{ scroll-margin-bottom: 12px; \}/);
  });

  test("on a phone with its bar, the last line stops 12px above the composer (it stopped about 90px above)", () => {
    for (const dock of [120, 150, 220]) {
      for (const safe of [0, 34]) {
        const bar = 67 + safe; // the bar's inset is from its top edge to the window's bottom, home indicator included
        assert.equal(endAt({ width: 390, bar, consent: 0, dock, safe }).gap, 12, `dock ${dock}, safe ${safe}`);
        // Counted twice (the marker's whole margin on top of the page's room), as before this fix:
        assert.equal(pageRoom(bar, 0) + dock + safe + END_PHONE - (safe + DOCK_PHONE + dock), 12 + bar + 12);
      }
    }
  });

  test("with the privacy banner open, the end clears the banner, and goes no higher", () => {
    const phone = endAt({ width: 390, bar: 67, consent: 270, dock: 150 });
    assert.equal(phone.end, pageRoom(67, 270), "12px above the banner's top edge");
    const laptop = endAt({ width: 1440, bar: 0, consent: 130, dock: 110 });
    assert.equal(laptop.end, Math.max(pageRoom(0, 130), DOCK_DESKTOP + 110 + 12));
  });

  test("a tablet (no bar, the composer still raised) and a desktop: 12px above the composer, as designed", () => {
    assert.equal(endAt({ width: 820, bar: 0, consent: 0, dock: 150 }).gap, 12);
    assert.equal(endAt({ width: 1440, bar: 0, consent: 0, dock: 110 }).gap, 12);
  });
});
