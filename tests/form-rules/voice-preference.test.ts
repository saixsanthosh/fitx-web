import { test } from "node:test";
import assert from "node:assert/strict";
import { readVoicePreference, writeVoicePreference } from "@/components/form-coach/voice";

/** A stand-in for the browser window with the given localStorage behaviour. */
function withWindow(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | "blocked") {
  const fakeWindow = {};
  Object.defineProperty(fakeWindow, "localStorage", {
    get() {
      // Chrome with site data blocked throws as soon as localStorage is touched.
      if (storage === "blocked") throw new DOMException("The operation is insecure.", "SecurityError");
      return storage;
    },
  });
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

test("the voice choice is remembered on this device", () => {
  const storage = memoryStorage();
  withWindow(storage);
  assert.equal(readVoicePreference(), false, "off until turned on");
  writeVoicePreference(true);
  assert.equal(readVoicePreference(), true);
  storage.values.set("fitx:form-coach:voice", "off"); // changed in another tab
  assert.equal(readVoicePreference(), false);
});

test("with storage full the switch still turns voice on and off for this visit", () => {
  const storage = memoryStorage();
  storage.values.set("fitx:form-coach:voice", "off");
  withWindow({ getItem: storage.getItem, setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } });
  writeVoicePreference(true);
  assert.equal(readVoicePreference(), true);
  writeVoicePreference(false);
  assert.equal(readVoicePreference(), false);
});

test("with site data blocked the switch still turns voice on and off for this visit", () => {
  withWindow("blocked");
  writeVoicePreference(true);
  assert.equal(readVoicePreference(), true, "the live view's Voice button shows on, so the next tap turns it off");
  writeVoicePreference(false);
  assert.equal(readVoicePreference(), false);
});
