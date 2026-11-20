// The browser's cooldown on sign-in, sign-up and reset emails (src/lib/auth/send-cooldown.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressKey, cooldownMessage, createEmailCooldown, EMAILS_PER_WINDOW, recentSends, SAME_ADDRESS_SECONDS, secondsUntilNextSend, STORAGE_KEY, WINDOW_MS, withSend,
} from "@/lib/auth/send-cooldown";

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
}

test("one email a minute to the same address, whatever its case or spaces", () => {
  const t0 = 10_000_000;
  const sends = withSend([], "Meera@Example.test ", t0);
  assert.equal(secondsUntilNextSend(sends, "meera@example.test", t0 + 1000), SAME_ADDRESS_SECONDS - 1);
  assert.equal(secondsUntilNextSend(sends, "meera@example.test", t0 + SAME_ADDRESS_SECONDS * 1000), 0);
  assert.equal(secondsUntilNextSend(sends, "other@example.test", t0 + 1000), 0, "another address is not held by the minute rule");
});

test("switching addresses does not get past the browser's limit", () => {
  const t0 = 50_000_000;
  let sends: ReturnType<typeof withSend> = [];
  for (let i = 0; i < EMAILS_PER_WINDOW; i += 1) sends = withSend(sends, `person${i}@example.test`, t0 + i * 61_000);
  const now = t0 + EMAILS_PER_WINDOW * 61_000;
  const wait = secondsUntilNextSend(sends, "fresh@example.test", now);
  assert.equal(wait, Math.ceil((t0 + WINDOW_MS - now) / 1000));
  assert.equal(secondsUntilNextSend(sends, "fresh@example.test", t0 + WINDOW_MS + 1), 0, "the window passes");
});

test("the stored list never holds an address, and junk in storage is ignored", () => {
  const storage = memoryStorage();
  let now = 1_000_000;
  const cooldown = createEmailCooldown(storage, () => now);
  cooldown.record("meera@example.test");
  assert.doesNotMatch(storage.map.get(STORAGE_KEY) ?? "", /meera|example/);
  assert.equal(cooldown.wait("meera@example.test"), SAME_ADDRESS_SECONDS);
  // A reload (a new cooldown over the same storage) still waits.
  now += 10_000;
  assert.equal(createEmailCooldown(storage, () => now).wait("meera@example.test"), SAME_ADDRESS_SECONDS - 10);
  storage.map.set(STORAGE_KEY, "{not json");
  assert.equal(createEmailCooldown(storage, () => now).wait("meera@example.test"), 0);
  assert.deepEqual(recentSends([{ at: "x" }, null, { at: now + 5, address: "a" }], now), [], "future or malformed entries are dropped");
  assert.equal(addressKey("A@B.test"), addressKey(" a@b.test"));
});

test("storage that throws falls back to memory", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const cooldown = createEmailCooldown(broken, () => 5_000_000);
  cooldown.record("meera@example.test");
  assert.equal(cooldown.wait("meera@example.test"), SAME_ADDRESS_SECONDS);
});

test("messages say how long to wait", () => {
  assert.equal(cooldownMessage(42), "Wait 42 s, then try again.");
  assert.equal(cooldownMessage(600), "Too many emails sent from this browser. Try again in 10 min.");
});
