import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Bug 75: at 280 px wide (a folding phone's cover screen) the public header's row needed 272.9 px of the 248 px
// inside the 16 px margins, so the menu button stuck out 9 px and every public page scrolled sideways.
const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");
const header = source("src/components/layout/PublicHeader.tsx");
const styles = css("src/components/layout/PublicHeader.module.css");

// What the hunt measured at 280 and 320 px (verify/public-header-…/evidence.txt), in px.
const MARK = 32; // the logo's mark alone (Logo size 32)
const LOGO = 70.4; // mark, gap and wordmark
const GAP = 12; // gap-3 between the logo and the right-hand group
const BUTTON = 142.5; // "Create account": its label, 18 px each side and the border
const GROUP_GAP = 4; // gap-1
const MENU = 44; // "Open menu"
const inside = (width: number) => width - 2 * 16; // --fitx-gutter is 16 px up to 400 px

test("below 320 px the logo is the mark alone and the main button's sides are 12 px", () => {
  const narrow = styles.match(/@media \(max-width: 319\.98px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(narrow, /\.brand :global\(\.fitx-wordmark\) \{ display: none; \}/);
  assert.match(narrow, /\.cta:global\(\.fitx-button\) \{ padding-inline: 12px; \}/, "weightier than the unlayered .fitx-button padding");
  assert.match(header, /<Link href="\/" aria-label="FITX home" className=\{`\$\{styles\.brand\} [^`]*`\}><Logo size=\{32\} \/><\/Link>/, "still named FITX home");
  for (const label of ["Create account", "Open dashboard"]) {
    assert.match(header, new RegExp(`className=\\{\`fitx-button \\$\\{styles\\.cta\\} [^\`]*\`\\}>${label}</Link>`), label);
  }
  assert.doesNotMatch(header, /px-3\.5/, "no dead padding utility left (.fitx-button's own padding always won over it)");
});

test("the row fits at 280 px with the menu button in full, and is unchanged from 320 px", () => {
  const before = LOGO + GAP + BUTTON + GROUP_GAP + MENU;
  assert.equal(before.toFixed(1), "272.9");
  assert.ok(before > inside(280), "the old row overflowed at 280 px");
  const narrow = MARK + GAP + (BUTTON - 2 * 6) + GROUP_GAP + MENU;
  assert.equal(narrow, 222.5);
  assert.ok(narrow <= inside(280), `${narrow} px fits in ${inside(280)} px`);
  assert.ok(inside(280) - narrow >= 20, "room for the wider 'Open dashboard' and font differences");
  assert.ok(before <= inside(320), "at 320 px the full logo still fits, so nothing changes there");
  // "Log in" only shows from 400 px, where there is room for it.
  assert.match(header, /className="hidden [^"]*min-\[400px\]:inline-flex">Log in<\/Link>/);
});
