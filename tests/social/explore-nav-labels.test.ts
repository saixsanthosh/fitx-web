import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPLORE_RAIL, RAIL_LABEL_PX, railEntries, railLabelsWidth } from "@/lib/social/rail";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/components/social/Explore.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
const labels = (videosOn: boolean) => [...railEntries(EXPLORE_RAIL, videosOn).map((entry) => entry.label), "Notifications", "Profile"];

/** The widest rail (px) at which the container queries still hide the labels, for a tab count. */
function iconsUpTo(tabs: number): number {
  const general = Number(/@container explore-nav \(max-width: (\d+)px\) \{\s*\.subnavLabel \{ display: none; \}/.exec(css)?.[1]);
  const specific = new RegExp(`@container explore-nav \\(max-width: (\\d+)px\\) \\{\\s*\\.subnav\\[data-tabs="${tabs}"\\] \\.subnavLabel \\{ display: none; \\}`).exec(css);
  return Math.max(general, specific ? Number(specific[1]) : 0);
}

// Bug 74 (explore-5): every tab got an equal share of the rail, so from 960 px to about 1300 px the long names were cut
// ("Dis…", "Co…", "Notificatio…"), and icons only applied below 960 px of window, whatever room the rail really had.
test("the rail's room for full labels, from the widths measured in the hunt", () => {
  for (const label of labels(true)) assert.ok(RAIL_LABEL_PX[label] > 0, `${label} has a measured width`);
  assert.equal(railLabelsWidth(labels(false)), 815, "six tabs, each as wide as its label");
  assert.equal(railLabelsWidth(labels(true)), 912, "with Videos");
  // The hunt's 1024 px rail: 696 px, each of six equal links 91 px wide = 49 px of padding, icon and gap + 42 px of label.
  assert.equal(696 - 6 * 91, 2 + 10 + 6 + 122 + 5 * 2, "the frame and New post take what the measured links left");
  assert.ok(Number.isNaN(railLabelsWidth(["Settings"])), "a new label must be measured before it can be laid out");
});

test("labels show only where every one fits with room to spare, and the rail is icons only below that", () => {
  for (const videosOn of [false, true]) {
    const tabs = labels(videosOn).length;
    const need = railLabelsWidth(labels(videosOn));
    const from = iconsUpTo(tabs) + 1;
    assert.ok(from >= need * 1.08, `${tabs} tabs: labels from ${from} px, they need ${need} px`);
    assert.ok(from <= need * 1.12, `${tabs} tabs: not hidden far longer than needed (${from} px for ${need} px)`);
  }
  // As measured in the hunt: 1024 × 768 (rail 696 px) is icons only; 1280 × 800 (rail 948 px) has every label in full.
  assert.ok(696 <= iconsUpTo(6));
  assert.ok(948 > iconsUpTo(6) && 948 >= railLabelsWidth(labels(false)));
  // Measured on the rail itself, not the window: no viewport rule hides or cuts the labels any more.
  assert.match(css, /\.subnav \{[^}]*container: explore-nav \/ inline-size;/);
  assert.doesNotMatch(css, /@media \(max-width: 959px\) \{\s*\.subnavLabel/);
  assert.match(css, /\.subnavLink \{[^}]*flex: 1 1 auto;/, "each tab as wide as its own label");
  assert.match(source("src/components/social/ExploreShell.tsx"), /<nav className=\{styles\.subnav\} aria-label="Explore" data-tabs=\{items\.length\}>/);
});
