import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkButtonStates, resolveButton } from "../../scripts/checks/check-contrast.mjs";

// Bug 10: hovering "Essential only" on the privacy banner (and every other quiet button) gave it the main red fill
// under its grey label, 1.14:1 in light and 1.27:1 in dark, so it looked like "Allow analytics" beside it. The quiet
// style now has its own hover and keyboard-focus look, set once in globals.css for every button that uses it.
const globals = readFileSync("src/app/globals.css", "utf8");
const QUIET = ["fitx-button", "fitx-button-quiet"];

test("a hovered or focused quiet button keeps its own see-through look with a body-text label", () => {
  for (const state of [["hover"], ["focus-visible"], ["hover", "focus-visible"]]) {
    const quiet = resolveButton(globals, QUIET, state);
    assert.equal(quiet.background?.value, "var(--fitx-hover)", `${state}: the hover tint, not the main fill`);
    assert.equal(quiet.color?.value, "var(--fitx-text)", `${state}: the label darkens to body text`);
    assert.match(quiet["border-color"]?.value ?? "", /var\(--fitx-primary\)/, `${state}: the edge picks up the brand colour`);
  }
  const resting = resolveButton(globals, QUIET);
  assert.deepEqual([resting.background?.value, resting.color?.value], ["transparent", "var(--fitx-text-secondary)"], "at rest it is unchanged");
});

test("the main button still brightens on hover, and no variant takes its fill", () => {
  assert.equal(resolveButton(globals, ["fitx-button"], ["hover"]).background?.value, "var(--fitx-primary-bright)");
  for (const variant of ["fitx-button-secondary", "fitx-button-quiet", "fitx-button-danger"]) {
    const hovered = resolveButton(globals, ["fitx-button", variant], ["hover"]).background?.value ?? "";
    assert.doesNotMatch(hovered, /--fitx-primary/, `${variant} on hover`);
  }
});

test("every quiet button label passes 4.5:1 hovered and focused, in light, dark, system-dark and the inverse band", () => {
  const quiet = checkButtonStates(globals).results.filter((row) => row.button === "quiet");
  assert.equal(new Set(quiet.map((row) => row.palette)).size, 6);
  const weakest = Math.min(...quiet.filter((row) => row.state !== "rest").map((row) => row.ratio));
  assert.ok(weakest >= 4.5, `weakest hovered or focused quiet label: ${weakest.toFixed(2)}:1`);
});

test("the privacy banner's two choices stay different: Essential only is the quiet one, Allow analytics the main one", () => {
  const banner = readFileSync("src/components/layout/AnalyticsConsent.tsx", "utf8");
  assert.match(banner, /className="fitx-button fitx-button-quiet[^"]*">Essential only</);
  assert.match(banner, /className="fitx-button (?!fitx-button-)[^"]*">Allow analytics</);
});
