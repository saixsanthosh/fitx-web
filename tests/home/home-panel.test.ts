import { test } from "node:test";
import assert from "node:assert/strict";
import { goalTemplate, homeRedirect, legacyGoalsTarget, panelTarget, progressGoalsHref, readPanelRequest } from "@/components/home/home-panel";

test("the old Goals addresses land where each part lives now (BRIEF 3.7)", () => {
  assert.equal(legacyGoalsTarget({}), "/progress?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: "goals" }), "/progress?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: "today" }), "/dashboard", "the To-Do list was removed: Home");
  assert.equal(legacyGoalsTarget({ tab: "week" }), "/workouts", "planned workouts are in Workouts");
  assert.equal(legacyGoalsTarget({ tab: "nonsense" }), "/progress?panel=goals");
  assert.equal(legacyGoalsTarget({ tab: ["week", "today"] }), "/workouts", "a repeated tab uses the first");
});

test("a goal template keeps its new= and always opens Goals on Progress", () => {
  assert.equal(legacyGoalsTarget({ tab: "goals", new: "water_day" }), "/progress?panel=goals&new=water_day");
  assert.equal(legacyGoalsTarget({ tab: "week", new: "protein_day" }), "/progress?panel=goals&new=protein_day");
  assert.equal(legacyGoalsTarget({ tab: "today", new: "<script>" }), "/dashboard", "an unknown template is dropped");
  assert.equal(goalTemplate("checklist"), "checklist");
  assert.equal(goalTemplate("toString"), null);
  assert.equal(progressGoalsHref(), "/progress?panel=goals");
});

test("Home's own old panel links redirect; plain Home does not", () => {
  assert.equal(homeRedirect({}), null);
  assert.equal(homeRedirect({ panel: "goals" }), "/progress?panel=goals");
  assert.equal(homeRedirect({ panel: "goals", new: "weight" }), "/progress?panel=goals&new=weight");
  assert.equal(homeRedirect({ new: "water_day" }), "/progress?panel=goals&new=water_day", "a template alone means Goals");
  assert.equal(homeRedirect({ panel: "todo" }), "/dashboard");
  assert.equal(homeRedirect({ panel: "week" }), "/workouts");
  assert.equal(homeRedirect({ panel: "week", new: "water_day" }), "/workouts", "the week does not open the goal editor");
  assert.equal(homeRedirect({ panel: "settings", new: "bogus" }), "/dashboard", "unknown parameters are dropped");
  assert.equal(panelTarget("todo"), "/dashboard");
});

test("panel requests are read the same way as before", () => {
  assert.deepEqual(readPanelRequest(""), { panel: null, template: null });
  assert.deepEqual(readPanelRequest("panel=week"), { panel: "week", template: null });
  assert.deepEqual(readPanelRequest(new URLSearchParams("panel=goals&new=weight")), { panel: "goals", template: "weight" });
  assert.deepEqual(readPanelRequest("new=water_day"), { panel: "goals", template: "water_day" });
});
