// The browser's cooldown on sign-in, sign-up and reset emails (src/lib/auth/send-cooldown.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressKey, cooldownMessage, createEmailCooldown, EMAILS_PER_WINDOW, recentSends, SAME_ADDRESS_SECONDS, secondsUntilNextSend, sentToRecently, STORAGE_KEY, WINDOW_MS, withSend,
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

test("an email to the same address in the last minute counts as still on its way; another address or an older one does not", () => {
  const t0 = 70_000_000;
  const sends = withSend([], "Meera@Example.test", t0);
  assert.equal(sentToRecently(sends, " meera@example.test", t0 + 5_000), true);
  assert.equal(sentToRecently(sends, "other@example.test", t0 + 5_000), false);
  assert.equal(sentToRecently(sends, "meera@example.test", t0 + SAME_ADDRESS_SECONDS * 1000), false);
  let now = t0;
  const cooldown = createEmailCooldown(memoryStorage(), () => now);
  assert.equal(cooldown.sentRecently("meera@example.test"), false);
  cooldown.record("meera@example.test");
  now += 2_000;
  assert.equal(cooldown.sentRecently("meera@example.test"), true);
});

test("the code sign-in keeps the code step, with the code already sent, when asked again within a minute", async () => {
  const { readFileSync } = await import("node:fs");
  const hook = readFileSync(new URL("../../src/components/auth/useEmailCode.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(!cooldown\.sentRecently\(address\)\) return cooldownMessage\(wait\);[\s\S]{0,200}setNotice\(CODE_SENT_MOMENTS_AGO\);\s*setEmail\(address\);\s*setCode\(""\);\s*setStep\("code"\);\s*return null;/);
  assert.match(hook, /const CODE_SENT_MOMENTS_AGO = "A code was sent a moment ago\. Use that one, or wait to ask again\.";/);
});
