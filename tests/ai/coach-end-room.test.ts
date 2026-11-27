// Where the coach's conversation ends after a reply (integration of release 3). Two streams kept the same thing clear in
// different files: the coach's end marker (Coach.module.css .end, bug 23's "Also seen") cleared the composer and the
// phone's bar with its own scroll-margin-bottom, and the shell's html scroll-padding-bottom (bugs 12 and 79) now keeps
// the bar, or the privacy banner while it is open, clear for every scroll. scrollIntoView adds the two, so on a phone
// the last line stopped about 90px above the composer instead of 12px, and with the banner open about half a screen
// up. The marker now asks only for what goes beyond the page's own room.
//
// Fix round 3d (integration): the composer is sticky, and scroll padding cannot move a sticky bar, so while the banner
// was open the composer sat under it (z-index 20 under 49): on a phone, 76 to about 226px up, wholly under a banner
// reaching 270px up; on a laptop, 16px up under one reaching 154px. It now stops 8px above the banner's top edge while
// the banner is open (.chat's --coach-dock-bottom), and the end marker reads the same place, so the last line still
// stops 12px above the composer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const coach = read("src/components/coach/Coach.module.css");
const globals = read("src/app/globals.css");
const desktop = coach.slice(coach.indexOf("@media (min-width: 1024px)"));
const phone = coach.slice(0, coach.indexOf("@media (min-width: 640px)"));

const numbers = (pattern: RegExp, text: string) => (pattern.exec(text)?.slice(1) ?? []).map(Number);
// The composer's place (its bottom edge above the window's bottom): its own offset, and its gap above the banner.
const [DOCK_PHONE = Number.NaN, BANNER_GAP_PHONE = Number.NaN] = numbers(/\.chat \{ --coach-dock-bottom: max\(calc\(env\(safe-area-inset-bottom\) \+ (\d+)px\), calc\(var\(--fitx-inset-consent, 0px\) \+ (\d+)px\)\); \}/, phone);
const [DOCK_DESKTOP = Number.NaN, BANNER_GAP_DESKTOP = Number.NaN] = numbers(/\.chat \{ --coach-dock-bottom: max\((\d+)px, calc\(var\(--fitx-inset-consent, 0px\) \+ (\d+)px\)\); \}/, desktop);
// The gap the marker leaves above the composer.
const [END_GAP = Number.NaN] = numbers(/\.end \{ scroll-margin-bottom: max\(0px, calc\(var\(--coach-dock-bottom, 76px\) \+ var\(--coach-dock-height, 180px\) \+ (\d+)px - var\(--fitx-scroll-room-bottom, 0px\)\)\); \}/, phone);

/** The page's bottom room, as globals.css defines it (html: --fitx-scroll-room-bottom). */
const pageRoom = (bar: number, consent: number) => Math.max(bar, consent) + 12;

/** The composer's bottom edge above the window's bottom (.chat's --coach-dock-bottom); `consent` 0: no banner. */
const dockBottom = (width: number, consent: number, safe: number) =>
  width >= 1024 ? Math.max(DOCK_DESKTOP, consent + BANNER_GAP_DESKTOP) : Math.max(safe + DOCK_PHONE, consent + BANNER_GAP_PHONE);

/**
 * How far above the window's bottom the conversation's end stops after scrollIntoView({ block: "end" }): the page's
 * scroll padding plus the marker's scroll margin. `width` picks the rules; `safe` is the home indicator's inset.
 */
function endAt({ width, bar, consent, dock, safe = 0 }: { width: number; bar: number; consent: number; dock: number; safe?: number }) {
  const room = pageRoom(bar, consent);
  const bottom = dockBottom(width, consent, safe);
  const margin = Math.max(0, bottom + dock + END_GAP - room);
  const composerTop = bottom + dock;
  return { end: room + margin, composerBottom: bottom, composerTop, gap: room + margin - composerTop };
}

describe("the coach's end marker and the page's bottom room", () => {
  test("the rules read as the model expects", () => {
    const parsed = [DOCK_PHONE, BANNER_GAP_PHONE, DOCK_DESKTOP, BANNER_GAP_DESKTOP, END_GAP];
    assert.ok(parsed.every(Number.isFinite), parsed.join(", "));
    assert.deepEqual(parsed, [76, 8, 16, 8, 12]);
    // The third inset (a page's own bars over its foot) is set only on the live workout, where the coach is hidden
    // (LAUNCHER_HIDDEN_ON), so pageRoom leaves it out.
    assert.match(globals, /html \{[^}]*--fitx-scroll-room-bottom: calc\(max\(var\(--fitx-inset-bottom-bar, 0px\), var\(--fitx-inset-consent, 0px\), var\(--fitx-inset-page-foot, 0px\)\) \+ 12px\);[^}]*scroll-padding-bottom: var\(--fitx-scroll-room-bottom\);/);
    // The composer and the marker read one place; nothing else moves either of them.
    assert.match(phone, /\.composerDock \{ position: sticky; bottom: var\(--coach-dock-bottom\); z-index: 20;/);
    assert.equal((coach.match(/\.composerDock \{[^}]*bottom:/g) ?? []).length, 1, "one bottom for the composer");
    assert.equal((coach.match(/(?:^|\n)\s*\.end \{/g) ?? []).length, 1, "one end marker rule for every width");
    assert.equal((coach.match(/--coach-dock-bottom:/g) ?? []).length, 2, "phones and tablets, and from 1024 px");
    // Inside the floating panel the conversation scrolls in its own box, which has no page padding: unchanged.
    assert.match(coach, /\.panelLayout \.composerDock \{ position: static;/);
    assert.match(coach, /\.panelLayout \.end \{ scroll-margin-bottom: 12px; \}/);
  });

  test("on a phone with its bar, the last line stops 12px above the composer (it stopped about 90px above)", () => {
    for (const dock of [120, 150, 220]) {
      for (const safe of [0, 34]) {
        const bar = 67 + safe; // the bar's inset is from its top edge to the window's bottom, home indicator included
        const at = endAt({ width: 390, bar, consent: 0, dock, safe });
        assert.equal(at.gap, 12, `dock ${dock}, safe ${safe}`);
        assert.equal(at.composerBottom, safe + 76, "the composer where it always was, over the bar");
        // Counted twice (the marker's whole margin on top of the page's room), as before this fix:
        assert.equal(pageRoom(bar, 0) + (safe + DOCK_PHONE + dock + END_GAP) - (safe + DOCK_PHONE + dock), 12 + bar + 12);
      }
    }
  });

  test("with the privacy banner open, the composer stops 8px above it, and the end 12px above the composer", () => {
    // The banner's inset (consent) runs from its top edge to the window's bottom.
    const phoneOpen = endAt({ width: 390, bar: 67, consent: 270, dock: 150 });
    assert.equal(phoneOpen.composerBottom, 270 + 8);
    assert.equal(phoneOpen.gap, 12);
    assert.ok(phoneOpen.end >= pageRoom(67, 270), "and so clear of the banner too");
    assert.ok(76 + 150 < 270, "before, the whole composer lay under the banner");
    for (const safe of [0, 34]) {
      assert.equal(endAt({ width: 390, bar: 67 + safe, consent: 270 + safe, dock: 150, safe }).gap, 12, `safe ${safe}`);
    }
    const laptop = endAt({ width: 1440, bar: 0, consent: 154, dock: 110 });
    assert.equal(laptop.composerBottom, 154 + 8);
    assert.equal(laptop.gap, 12);
    const tablet = endAt({ width: 820, bar: 0, consent: 150, dock: 150 });
    assert.equal(tablet.composerBottom, 158);
    assert.equal(tablet.gap, 12);
  });

  test("a tablet (no bar, the composer still raised) and a desktop: 12px above the composer, as designed", () => {
    assert.equal(endAt({ width: 820, bar: 0, consent: 0, dock: 150 }).gap, 12);
    assert.equal(endAt({ width: 820, bar: 0, consent: 0, dock: 150 }).composerBottom, 76);
    assert.equal(endAt({ width: 1440, bar: 0, consent: 0, dock: 110 }).gap, 12);
    assert.equal(endAt({ width: 1440, bar: 0, consent: 0, dock: 110 }).composerBottom, 16);
  });
});
