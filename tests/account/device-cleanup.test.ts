// What sign-out and account deletion remove from this browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetAccountOnDevice } from "@/lib/account/device-cleanup";

function store(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
  };
}

const user = "6b1e4d2a-0000-4000-8000-000000000001";

test("sign-out removes the tab's unsaved Home workout sets and the account's exercise recents", () => {
  const session = store({ "fitx:home-workout:today": "{}", "fitx:home-workout:unfinished-save": "[]", "fitx-session-stamped": "1" });
  const local = store({
    [`fitx:exercise:v1:${user}:recent`]: "[]",
    [`fitx:exercise:v1:${user}:searches`]: "[\"squat\"]",
    [`fitx:exercise:v1:${user}:favorites`]: "[]",
    "fitx:exercise:v1:library-sections": "{}",
    "fitx-theme": "dark",
    "fitx:home-workout:voice-gender": "female",
    "fitx.household-measures.v1": "{}",
  });
  forgetAccountOnDevice({ local, session });
  assert.deepEqual([...session.values.keys()], ["fitx-session-stamped"]);
  assert.deepEqual([...local.values.keys()].sort(), [
    `fitx:exercise:v1:${user}:favorites`,
    "fitx-theme",
    "fitx.household-measures.v1",
    "fitx:exercise:v1:library-sections",
    "fitx:home-workout:voice-gender",
  ].sort());
});

test("deleting the account also removes its saved exercises waiting in this browser; blocked storage is harmless", () => {
  const local = store({ [`fitx:exercise:v1:${user}:favorites`]: "[]", "fitx-theme": "light" });
  forgetAccountOnDevice({ local, session: null }, { deleted: true });
  assert.deepEqual([...local.values.keys()], ["fitx-theme"]);
  const blocked = { get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => forgetAccountOnDevice({ local: blocked, session: blocked }));
  assert.doesNotThrow(() => forgetAccountOnDevice({ local: null, session: null }));
});
