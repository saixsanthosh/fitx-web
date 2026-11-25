// Source checks on the coach page's components (the test runner has no DOM). Each guards a fix from
// the phase review; if a component is restructured, re-check the behaviour and update the pattern.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");

describe("coach page components", () => {
  test("the consent screen starts with no choice made, and Start waits for one", () => {
    const panel = source("ConsentPanel.tsx");
    assert.match(panel, /useState<boolean \| null>\(minor \? false : null\)/, "adults start with nothing chosen; under-18s never share");
    // Disabled until a choice is made; while saving it stays focusable (aria-disabled), so focus isn't dropped (bug 86).
    assert.match(panel, /disabled=\{!chosen\} aria-disabled=\{saving \|\| undefined\}/);
    assert.doesNotMatch(panel, /\(recommended\)/);
    assert.match(panel, /saveConsent\(shareData === true && !minor\)/);
    assert.doesNotMatch(panel, /Fit your diet, allergies and budget/, "FITX checks names, so plans don't promise more");
  });

  test("times in the viewer's time zone render only after hydration", () => {
    const app = source("CoachApp.tsx");
    const list = source("ConversationList.tsx");
    assert.match(app, /const hydrated = useHydrated\(\)/);
    assert.match(app, /hydrated \? formatResetTime\(activeQuota\.resetsAt\) : null/);
    assert.match(list, /hydrated \? relativeDay\(thread\.updatedAt\) : ""/);
    // Elsewhere formatResetTime runs only in event handlers (after a failed request), never during the first render.
    const renderUses = app.split("\n").filter((line) => /formatResetTime\(/.test(line) && !/const when = formatResetTime/.test(line));
    assert.deepEqual(renderUses.map((line) => line.trim().slice(0, 40)), ["const quotaHint = activeQuota ? quotaTex"]);
  });

  test("the history drawer is a native modal dialog", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /function HistoryDrawer[\s\S]*?showModal\(\)[\s\S]*?<dialog/);
    assert.doesNotMatch(app, /role="dialog" aria-modal="true"/);
  });

  test("Add to My Food Plan says where the food went", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /Saved to My foods in Nutrition\. Nothing was logged as eaten\./);
    assert.doesNotMatch(app, /Added to My Food Plan in Nutrition/);
    // Nutrition's tab for saved foods.
    const nutrition = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");
    assert.match(nutrition, /\["foods", "My foods"\]/);
  });

  test("while the coach is paused or not set up, a member with coach data can open Coach settings", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /onSettings=\{hasCoachData \? \(\) => setSettingsOpen\(true\) : undefined\}/);
    assert.match(source("CoachUnavailable.tsx"), /Coach settings/);
  });
});
