// Home's edit 3 (bug 26): Profile, Progress and the coach read the member's training answers from the shared user
// context, which loads once for the signed-in app. After the Workouts setup is saved the page tells it to reload
// (as Nutrition's setup does), so Profile shows the new answers without a reload of the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notifyUserContextChanged, USER_CONTEXT_EVENT } from "@/lib/domain/user-context";

type WithWindow = { window?: unknown };

/** Runs `body` with a stand-in `window` (an EventTarget), as the browser gives notifyUserContextChanged. */
function withWindow(body: (target: EventTarget) => void) {
  const global = globalThis as WithWindow;
  const before = global.window;
  const target = new EventTarget();
  global.window = target;
  try {
    body(target);
  } finally {
    if (before === undefined) delete global.window;
    else global.window = before;
  }
}

test("notifyUserContextChanged sends the event the shared context listens for", () => {
  withWindow((target) => {
    let heard = 0;
    target.addEventListener(USER_CONTEXT_EVENT, () => { heard += 1; });
    notifyUserContextChanged();
    assert.equal(heard, 1);
  });
});

test("the shared context reloads on that event", () => {
  const provider = readFileSync("src/components/app/UserContextProvider.tsx", "utf8");
  assert.match(provider, /const onChange = \(\) => void refresh\(\);/);
  assert.match(provider, /window\.addEventListener\(USER_CONTEXT_EVENT, onChange\);/);
});

test("the Workouts setup tells the shared context once its answers are saved", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  assert.match(page, /import \{ notifyUserContextChanged \} from "@\/lib\/domain\/user-context";/);
  const saved = page.slice(page.indexOf("function setupSaved("), page.indexOf("async function replanAfterSetup("));
  assert.match(saved, /\n {4}notifyUserContextChanged\(\);\n/);
  // setupSaved is the setup's onSaved, which the flow calls only after saveWorkoutSetup succeeded.
  assert.equal((page.match(/onSaved=\{setupSaved\}/g) ?? []).length, 2, "both the inline setup and the setup sheet");
  const flow = readFileSync("src/components/workouts/WorkoutSetupFlow.tsx", "utf8");
  const save = flow.slice(flow.indexOf("async function save()"), flow.indexOf("const toggleKey"));
  assert.ok(save.indexOf("if (outcome.error)") > 0 && save.indexOf("if (outcome.error)") < save.indexOf("onSaved({"), "a failed save never reaches onSaved");
});
