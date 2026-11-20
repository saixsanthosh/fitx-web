// The content forms in the browser's terms: a refused save keeps what was typed, a saved portion stays
// on screen with its values, and an "ask first" button never sends on its first press.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const food = await importTypeScriptModule("src/lib/content/food-input.ts");

// React stand-ins: hooks read from globalThis.__fitxHooks so each test sets the state it renders with.
const REACT = `
const hooks = () => globalThis.__fitxHooks;
export const startTransition = (fn) => { hooks().transitions += 1; hooks().inTransition = true; try { fn(); } finally { hooks().inTransition = false; } };
export const useState = (initial) => { const h = hooks(); const at = h.slot++; const value = at in h.state ? h.state[at] : typeof initial === "function" ? initial() : initial; return [value, (next) => h.sets.push([at, next])]; };
export const useRef = (initial) => ({ current: initial ?? null });
export const useEffect = () => {};
`;
const JSX = `
export const jsx = (type, props, key) => ({ type, props, key: key ?? null });
export const jsxs = jsx;
export const Fragment = "fragment";
`;
const STUBS = {
  react: REACT,
  "react/jsx-runtime": JSX,
  "react-dom": "export const useFormStatus = () => ({ pending: false });",
  "lucide-react": "export const LoaderCircle = () => null;",
  "./content.module.css": "export default new Proxy({}, { get: (_target, name) => String(name) });",
};
const { keepTyped } = await importTypeScriptModule("src/components/content/keep-typed.ts", STUBS);
const { ConfirmSubmit } = await importTypeScriptModule("src/components/content/confirm-submit.tsx", STUBS);

function hooks(state = {}) {
  globalThis.__fitxHooks = { slot: 0, state, sets: [], transitions: 0, inTransition: false };
  return globalThis.__fitxHooks;
}

test("a content form is sent through a transition with its default submit cancelled, so React never resets it", () => {
  const h = hooks();
  let prevented = false;
  const sent = [];
  keepTyped((data) => sent.push({ data, inTransition: h.inTransition }))({ preventDefault: () => { prevented = true; }, currentTarget: undefined });
  assert.equal(prevented, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].data instanceof FormData);
  assert.equal(sent[0].inTransition, true);
});

test("every content form with typed fields submits through keepTyped", async () => {
  for (const name of ["exercise-form", "food-form", "plan-form", "portions-editor", "category-rename"]) {
    const source = await readFile(new URL(`../src/components/content/${name}.tsx`, import.meta.url), "utf8");
    const forms = source.match(/<form\b[^>]*>/g) ?? [];
    assert.equal(forms.length, 1, name);
    assert.match(forms[0], /onSubmit=\{keepTyped\(formAction\)\}/, name);
  }
});

test("the first press of an ask-first button cancels its click and only asks; the confirm button is a new element", () => {
  const h = hooks();
  const asking = ConfirmSubmit({ label: "Delete exercise", confirmLabel: "Confirm delete, cannot be undone" });
  assert.equal(asking.type, "button");
  assert.equal(asking.props.type, "button");
  let prevented = false;
  asking.props.onClick({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, "the click that asks can never submit the form");
  assert.deepEqual(h.sets[0], [0, true]);

  hooks({ 0: true });
  const confirming = ConfirmSubmit({ label: "Delete exercise", confirmLabel: "Confirm delete, cannot be undone" });
  assert.equal(confirming.props.type, "submit");
  assert.notEqual(confirming.key, asking.key, "a different key, so React mounts a new button instead of retyping the pressed one");
});

test("after a save the portions editor shows what was stored, with fresh fields for each saved set", () => {
  const before = [{ label: "1 idli", unit: "piece", grams: "39", measured: false }];
  const rows = food.portionDrafts(before, 0);
  assert.deepEqual(rows, [{ label: "1 idli", unit: "piece", grams: "39", measured: false, key: "0-0" }]);

  // The operator adds "1 large idli", edits the first weight and saves.
  const data = new FormData();
  for (const [label, unit, grams, measured] of [["1 idli", "piece", "40", "false"], ["1 large idli", "piece", "55", "true"]]) {
    data.append("portion_label", label);
    data.append("portion_unit", unit);
    data.append("portion_grams", grams);
    data.append("portion_measured", measured);
  }
  data.append("portion_default", "1");
  const parsed = food.parsePortionsForm(data);
  assert.equal(parsed.ok, true);

  // What the page sends back once revalidated (the same mapping as foods/[id]/page.tsx).
  const saved = parsed.value.map((portion) => ({ label: portion.label, unit: portion.unit, grams: String(portion.grams), measured: !portion.is_estimate }));
  const savedDefault = parsed.value.findIndex((portion) => portion.is_default);
  assert.notEqual(food.portionsSignature(saved, savedDefault), food.portionsSignature(before, -1), "the editor notices the stored set changed");
  assert.equal(food.portionsSignature(saved, savedDefault), food.portionsSignature(saved.map((row) => ({ ...row })), savedDefault), "same values, same signature");

  const after = food.portionDrafts(saved, 1);
  assert.deepEqual(after.map(({ label, grams, measured }) => [label, grams, measured]), [["1 idli", "40", false], ["1 large idli", "55", true]]);
  assert.equal(after.some((row) => rows.some((old) => old.key === row.key)), false, "new keys, so no field keeps an old value");
  assert.equal(savedDefault, 1);
});
