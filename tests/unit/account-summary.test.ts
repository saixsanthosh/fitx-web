import test from "node:test";
import assert from "node:assert/strict";
import { preferSharedAccount } from "@/components/layout/accountSummary";

const fetched = { name: "Old name", email: "me@example.test", avatarUrl: "https://storage.example/signed-old" };
const shared = (name: string, avatar: string | null, avatarUrl: string | null) => ({
  data: { email: "me@example.test", profile: { name, avatar } },
  avatarUrl,
});

test("without the shared user context, the shell's own fetch is used", () => {
  assert.equal(preferSharedAccount(fetched, null), fetched);
  assert.equal(preferSharedAccount(fetched, { data: null, avatarUrl: null }), fetched, "still loading");
  assert.equal(preferSharedAccount(null, null), null);
});

test("the shared context's name and renewed photo link win", () => {
  assert.deepEqual(preferSharedAccount(fetched, shared("New name", "user/avatar-2.webp", "https://storage.example/signed-new")), {
    name: "New name", email: "me@example.test", avatarUrl: "https://storage.example/signed-new",
  });
});

test("while the shared photo link is being signed, the fetched one fills in", () => {
  assert.equal(preferSharedAccount(fetched, shared("New name", "user/avatar-2.webp", null))?.avatarUrl, fetched.avatarUrl);
});

test("a removed photo shows no photo, and an empty name falls back to the fetched one", () => {
  const result = preferSharedAccount(fetched, shared("", null, null));
  assert.equal(result?.avatarUrl, null);
  assert.equal(result?.name, "Old name");
  assert.equal(preferSharedAccount(null, shared("", null, null))?.name, "");
});
