import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_SECTION, goalTemplate, legacyGoalsTarget, readPanelRequest } from "@/components/home/home-panel";

test("the old Goals addresses land on the matching place on Home", () => {
  assert.equal(legacyGoalsTarget({}), "/dashboard?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: "goals" }), "/dashboard?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: "today" }), "/dashboard?panel=todo");
  assert.equal(legacyGoalsTarget({ tab: "week" }), "/dashboard?panel=week");
  assert.equal(legacyGoalsTarget({ tab: "nonsense" }), "/dashboard?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: ["week", "today"] }), "/dashboard?panel=week", "a repeated tab uses the first");
});

test("a goal template keeps its new= and always opens Goals, as on the old page", () => {
  assert.equal(legacyGoalsTarget({ tab: "goals", new: "water_day" }), "/dashboard?panel=goals&new=water_day");
  assert.equal(legacyGoalsTarget({ tab: "week", new: "protein_day" }), "/dashboard?panel=goals&new=protein_day");
  assert.equal(legacyGoalsTarget({ tab: "today", new: "<script>" }), "/dashboard?panel=todo", "an unknown template is dropped");
  assert.equal(goalTemplate("checklist"), "checklist");
  assert.equal(goalTemplate("toString"), null);
});

test("Home reads its panel and template off the address", () => {
  assert.deepEqual(readPanelRequest(""), { panel: null, template: null });
  assert.deepEqual(readPanelRequest("panel=week"), { panel: "week", template: null });
  assert.deepEqual(readPanelRequest("panel=todo"), { panel: "todo", template: null });
  assert.deepEqual(readPanelRequest(new URLSearchParams("panel=goals&new=weight")), { panel: "goals", template: "weight" });
  assert.deepEqual(readPanelRequest("new=water_day"), { panel: "goals", template: "water_day" }, "a template alone means Goals");
  assert.deepEqual(readPanelRequest("panel=week&new=water_day"), { panel: "week", template: null }, "the week plan does not open the goal editor");
  assert.deepEqual(readPanelRequest("panel=settings&new=bogus"), { panel: null, template: null });
  assert.deepEqual(PANEL_SECTION, { goals: "home-goals", todo: "home-todo" });
});
