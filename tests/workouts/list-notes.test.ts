// D6, the same mistake as bug 11, found again on the Workouts page (review round, workouts-r5): "Show more plans",
// a plan card's Edit, Duplicate and Delete, and Repeat in History said what went wrong only in the alert under the
// page heading, often far above the control used. Each now answers beside its control; a deleted plan's card takes
// the focused menu with it, so focus moves to the next plan's Start (D5). The page is JSX, which node --test cannot
// render: where it puts each message is read from the source; which message goes where is pure and tested directly.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterPlanDelete, historyNote, moreNote, planCardNote, plansLineNote, type ListNote } from "@/app/(dashboard)/workouts/_lib/list-notes";

const listed = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("which message goes where", () => {
  test("a plan's message shows in that plan's card, and on the list's line only when the plan is not listed", () => {
    const note: ListNote = { at: "plan", planId: "b", tone: "error", text: "That workout could not be deleted. Check your connection and try again." };
    assert.deepEqual(planCardNote(note, "b"), { tone: "error", text: note.text });
    assert.equal(planCardNote(note, "a"), null);
    assert.equal(plansLineNote(note, listed), null);
    assert.deepEqual(plansLineNote(note, [{ id: "a" }]), { tone: "error", text: note.text }, "a saved plan beyond the first page");
  });

  test("the list's own line, Show more plans and a History row each take only their own", () => {
    const deleted: ListNote = { at: "plans", tone: "info", text: "Deleted “Push”." };
    const more: ListNote = { at: "more", text: "More plans couldn’t be loaded. Check your connection and try again." };
    const repeat: ListNote = { at: "history", sessionId: "s1", text: "That workout couldn’t be loaded to repeat. Check your connection and try again." };
    assert.deepEqual(plansLineNote(deleted, listed), { tone: "info", text: deleted.text });
    assert.equal(moreNote(more), more.text);
    assert.equal(moreNote(deleted), null);
    assert.equal(historyNote(repeat, "s1"), repeat.text);
    assert.equal(historyNote(repeat, "s2"), null);
    for (const note of [deleted, more, repeat]) assert.equal(planCardNote(note, "a"), null);
    assert.equal(plansLineNote(null, listed), null);
  });

  test("after a delete, the next plan's Start takes focus, the previous one's for the last, none for an empty list", () => {
    assert.equal(focusAfterPlanDelete(listed, "a"), "b");
    assert.equal(focusAfterPlanDelete(listed, "b"), "c");
    assert.equal(focusAfterPlanDelete(listed, "c"), "b");
    assert.equal(focusAfterPlanDelete([{ id: "a" }], "a"), null);
    assert.equal(focusAfterPlanDelete(listed, "gone"), "a");
  });
});

describe("the Workouts page (JSX, read from the source)", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  const preview = readFileSync("src/components/workouts/PlanPreviewSheet.tsx", "utf8");
  const between = (start: string, end: string) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));

  test("the list and History actions no longer write the page-wide alert", () => {
    for (const [start, end] of [["async function repeatSession(", "function swapPreview("], ["async function editPlan(", "async function duplicatePlan("], ["async function duplicatePlan(", "function sayOnPlan("], ["async function loadMorePlans(", "async function deletePlan("], ["async function deletePlan(", "async function savePlan("], ["async function afterSave(", "async function startWorkout("]] as const) {
      assert.doesNotMatch(between(start, end), /setError\("[^"]/, start);
    }
    // Only loading the page uses it now.
    assert.deepEqual([...page.matchAll(/setError\("([^"]+)"\)/g)].map((match) => match[1]), [
      "FITX is not connected to Supabase in this environment.", "Sign in to manage your workouts.", "Workouts could not load. Check your connection and try again.",
    ]);
  });

  test("each message is rendered beside its control", () => {
    assert.match(page, /\{historyNote\(listNote, session\.id\) && <p role="alert" className=\{styles\.rowNote\}>/);
    assert.match(page, /const cardNote = planCardNote\(listNote, plan\.id\);[\s\S]*?<\/article>\s+\{cardNote && <ActionNote note=\{cardNote\} \/>\}/);
    assert.match(page, /\{moreNote\(listNote\) && <p role="alert"/);
    assert.match(page, /<ActionNote note=\{plansLineNote\(listNote, plans\)\} live \/>/);
    assert.match(page, /onSelect: \(\) => void editPlan\(plan\.id\)\.then\(\(message\) => sayOnPlan\(plan\.id, message\)\)/);
    assert.match(page, /onSelect: \(\) => void duplicatePlan\(plan\)\.then\(\(message\) => sayOnPlan\(plan\.id, message\)\)/);
  });

  test("Repeat's left-out movements are said inside the builder that opens, not behind it", () => {
    const repeat = between("async function repeatSession(", "function swapPreview(");
    assert.ok(repeat.indexOf("showBuilder()") < repeat.indexOf("setAutoNote(missing > 0"));
    assert.doesNotMatch(repeat, /setNotice\(`/);
  });

  test("a deleted plan's card hands focus to the next plan's Start, and the list's line says it was deleted", () => {
    const remove = between("async function deletePlan(", "async function savePlan(");
    assert.match(remove, /const next = focusAfterPlanDelete\(plans, plan\.id\);\s+await load\(\);/);
    assert.match(remove, /setPlanFocus\(\(current\) => \(\{ planId: next, seq: \(current\?\.seq \?\? 0\) \+ 1 \}\)\);/);
    assert.match(page, /\[id="workout-plan-\$\{planFocus\.planId\}"\] \[data-plan-start\]/);
    assert.match(page, /<button type="button" data-plan-start/);
    assert.match(page, /id="plans-build-first"/);
  });

  test("an earlier message goes once the member moves on: New workout, and every reload of the list (re-check of release 3)", () => {
    // A failed Edit's "Check your connection" stayed under its card after a new plan was saved: only the list actions
    // cleared it. At 99d06a8 opening the builder, saving and loading all cleared the page-wide alert it replaced.
    assert.match(between("function openCreator(", "function switchMode("), /setError\(""\);\s+setNotice\(""\);[\s\S]*?setListNote\(null\);\s+\}/);
    const load = between("const load = useCallback(", "useEffect(() => { void Promise.resolve().then(load); }, [load]);");
    assert.match(load, /setLoading\(false\);\s+setError\(""\);[\s\S]{0,300}?setListNote\(null\);[\s\S]{0,200}?setLoadVersion/, "a list that loaded clears it");
    assert.doesNotMatch(load.slice(0, load.indexOf("if (failure?.error)") + 200), /setListNote/, "a failed load leaves it");
    // An action that reloads says its own result after the reload, so the reload never wipes it.
    const remove = between("async function deletePlan(", "async function savePlan(");
    assert.ok(remove.indexOf("await load();") > 0 && remove.indexOf("await load();") < remove.indexOf('setListNote({ at: "plans"'));
    const after = between("async function afterSave(", "async function startWorkout(");
    assert.ok(after.lastIndexOf("await load();") < after.lastIndexOf("if (saved) sayOnSaved("));
    assert.match(after, /if \(message\) \{ await load\(\); sayOnSaved\("error", message\); \}/);
  });

  test("after the builder closes, a save's warning or a failed start is said with the saved plan", () => {
    const after = between("async function afterSave(", "async function startWorkout(");
    assert.match(after, /const sayOnSaved = \(tone: "info" \| "error", text: string\) => \(editingProgrammeDay \? setProgrammeNote\(\{ tone, text \}\) : setListNote\(\{ at: "plan", planId, tone, text \}\)\);/);
    assert.match(after, /if \(message\) \{ await load\(\); sayOnSaved\("error", message\); \}/);
  });

  test("Edit plan in the preview says why it could not open there; the preview closes only as the builder opens", () => {
    assert.match(page, /onEdit=\{\(planId\) => editPlan\(planId, \(\) => setPreviewPlanId\(null\)\)\}/);
    assert.match(page, /beforeOpen\?\.\(\);\s+setBuilderMode\("custom"\); setEditingPlanId\(planId\);/);
    assert.match(preview, /\{editError && <p role="alert" className="fitx-alert fitx-alert-danger">\{editError\}<\/p>\}/);
    assert.match(preview, /onClick=\{\(\) => void edit\(\)\} aria-disabled=\{opening \|\| undefined\}/);
  });

  test("the programme's own results are said in the Programme section, in every state", () => {
    assert.equal((page.match(/<ActionNote note=\{programmeNote\} live/g) ?? []).length, 2, "no longer available, and the programme list after leaving or finishing");
    for (const start of ["async function leave()", "async function finish()", "async function enrol("]) {
      const action = between(start, "\n  }\n");
      assert.match(action, /setProgrammeNote\(\{ tone:/, start);
      assert.doesNotMatch(action, /setNotice\(`|setNotice\("[^"]/, start);
    }
  });
});
