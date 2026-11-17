import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRecordingStore, type RecordingStore, type StoredRecording } from "@/lib/activity/local-store";
import { prepareDeviceActivityForSignOut } from "@/lib/activity/sign-out";
import { deviceActivityAtSignOut, signOutWithDeviceActivity, type SignOutClient } from "@/lib/auth/device-sign-out";
import { T0 } from "./support/tracks";

// "Log out" and the delete dialog's "Sign in again" both sign out through src/lib/auth/device-sign-out.ts. Its time
// limits must never skip the "not saved yet" question or the clean-up, however slowly the upload code loads.

const never = <T>() => new Promise<T>(() => undefined);

/** A recording that can't be uploaded (its upload was refused), so it is never removed by the upload step. */
function refused(clientId: string, userId = "u"): StoredRecording {
  return { clientId, userId, sport: "run", startedAt: T0, state: "finished", updatedAt: T0, uploadRejected: true };
}

function client({ signOut = async () => ({ error: null as unknown }) }: { signOut?: SignOutClient["auth"]["signOut"] } = {}) {
  const calls: string[] = [];
  const supabase: SignOutClient = {
    from: () => { throw new Error("no queries expected"); },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u" } } } }),
      signOut: async (options) => { calls.push(`signOut:${options.scope}`); return signOut(options); },
    },
  };
  return { supabase, calls };
}

async function storeWith(...recordings: StoredRecording[]) {
  const store = new MemoryRecordingStore(true);
  for (const recording of recordings) await store.saveRecording(recording);
  return store;
}

test("upload code that loads too slowly still leads to the question, and a yes still clears the device", async () => {
  const store = await storeWith(refused("a"), refused("b"), refused("theirs", "someone-else"));
  const { supabase, calls } = client();
  const asked: string[] = [];
  const started = Date.now();
  const outcome = await signOutWithDeviceActivity(supabase, {
    openStore: async () => store,
    loadPrepare: never,
    prepareLimitMs: 50,
    locks: null,
    ask: (question) => { asked.push(question); return true; },
  });
  assert.ok(Date.now() - started < 2000, "the slow chunk doesn't hold up signing out");
  assert.equal(outcome, "signed_out");
  assert.deepEqual(asked, ["2 activities on this device aren’t saved to your account yet. Sign out and delete them from this device?"]);
  assert.deepEqual(calls, ["signOut:local"]);
  assert.deepEqual(await store.listRecordings("u"), [], "this account's recordings are gone from the device");
  assert.equal((await store.listRecordings("someone-else")).length, 1, "another account's stay");
});

test("a no keeps the member signed in with every recording on the device", async () => {
  const store = await storeWith(refused("a"));
  const { supabase, calls } = client();
  const outcome = await signOutWithDeviceActivity(supabase, { openStore: async () => store, loadPrepare: never, prepareLimitMs: 50, locks: null, ask: () => false });
  assert.equal(outcome, "cancelled");
  assert.deepEqual(calls, [], "not signed out");
  assert.equal((await store.listRecordings("u")).length, 1);
});

test("uploads that run out of time are counted again: what uploaded meanwhile isn't asked about", async () => {
  const store = await storeWith(refused("a"), refused("b"));
  const activity = await deviceActivityAtSignOut(client().supabase, {
    openStore: async () => store,
    // The upload step removes one recording, then hangs.
    loadPrepare: async () => (async (target: RecordingStore) => { await target.deleteRecording("a"); return never(); }) as unknown as typeof prepareDeviceActivityForSignOut,
    prepareLimitMs: 50,
    locks: null,
  });
  assert.equal(activity?.notUploaded, 1);
});

test("with the upload step in time, its own count and clean-up are used", async () => {
  const store = await storeWith(refused("a"));
  let loaded = 0;
  const activity = await deviceActivityAtSignOut(client().supabase, {
    openStore: async () => store,
    loadPrepare: async () => { loaded += 1; return prepareDeviceActivityForSignOut; },
    locks: null,
  });
  assert.equal(loaded, 1);
  assert.equal(activity?.notUploaded, 1, "a refused upload stays and is counted");
  await activity?.clear();
  assert.deepEqual(await store.listRecordings("u"), []);
});

test("nothing kept for the account: the upload code isn't loaded and nobody is asked", async () => {
  const store = await storeWith(refused("theirs", "someone-else"));
  let loaded = 0;
  const { supabase, calls } = client();
  const outcome = await signOutWithDeviceActivity(supabase, {
    openStore: async () => store,
    loadPrepare: async () => { loaded += 1; return prepareDeviceActivityForSignOut; },
    locks: null,
    ask: () => assert.fail("nothing to ask about"),
  });
  assert.equal(outcome, "signed_out");
  assert.equal(loaded, 0);
  assert.deepEqual(calls, ["signOut:local"]);
});

test("a device storage that never answers doesn't keep anyone signed in", async () => {
  const { supabase, calls } = client();
  const outcome = await signOutWithDeviceActivity(supabase, { openStore: never, listLimitMs: 50, locks: null, ask: () => assert.fail("nothing known to ask about") });
  assert.equal(outcome, "signed_out");
  assert.deepEqual(calls, ["signOut:local"]);
});

test("signing out of every device that fails keeps the session and the recordings; this device alone still signs out", async () => {
  const offline = async () => ({ error: new Error("Failed to fetch") as unknown });
  const store = await storeWith(refused("a"));
  const everywhere = await signOutWithDeviceActivity(client({ signOut: offline }).supabase, { scope: "global", openStore: async () => store, loadPrepare: never, prepareLimitMs: 50, locks: null, ask: () => true });
  assert.equal(everywhere, "failed");
  assert.equal((await store.listRecordings("u")).length, 1, "still signed in, so nothing is removed");
  const here = await signOutWithDeviceActivity(client({ signOut: offline }).supabase, { openStore: async () => store, loadPrepare: never, prepareLimitMs: 50, locks: null, ask: () => true });
  assert.equal(here, "signed_out", "the session cookies are removed in the browser instead");
  assert.deepEqual(await store.listRecordings("u"), []);
});
