// Deleting a member from Admin also removes their Explore photos (social-media/<id>/…), as the member's own
// "Delete my account" does, before the login goes. Made-up IDs, addresses and file names only.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { sealedRedirect } from "./helpers/notices.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const social = await importTypeScriptModule("src/lib/social-media-storage.ts");
const userActions = await importTypeScriptModule("src/app/(control)/users/actions.ts", SESSION_STUBS);

const MEMBER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const operator = { id: "00000000-0000-4000-8000-0000000000b2", username: "deputy", role: "super_admin", sessionId: "s-own", isRoot: false, permissions: ["people.view", "people.delete"] };

/** A fake bucket: `tree` maps a listed folder to its entries (files have an id, folders do not). */
function bucket(tree, { listError = null, removeError = null } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      storage: {
        from: (name) => ({
          list: async (path, options) => {
            calls.push(["list", name, path, options.offset]);
            if (listError && listError.path === path) return { data: null, error: listError.error };
            const all = tree[path] ?? [];
            return { data: all.slice(options.offset, options.offset + options.limit), error: null };
          },
          remove: async (paths) => {
            calls.push(["remove", name, [...paths]]);
            return { error: removeError };
          },
        }),
      },
    },
  };
}

test("every Explore photo of the account is listed two levels deep and removed from the social-media bucket", async () => {
  const fakeBucket = bucket({
    [MEMBER]: [{ name: "post-1", id: null }, { name: "profile", id: null }, { name: "stray.jpg", id: "f0" }],
    [`${MEMBER}/post-1`]: [{ name: "a.jpg", id: "f1" }, { name: "b.jpg", id: "f2" }],
    [`${MEMBER}/profile`]: [{ name: "me.jpg", id: "f3" }],
  });
  const result = await social.removeSocialMediaFiles(fakeBucket.client, MEMBER);
  assert.deepEqual(result, { removed: 4, error: null });
  assert.ok(fakeBucket.calls.every(([, name]) => name === "social-media"));
  assert.deepEqual(fakeBucket.calls.filter(([op]) => op === "remove"), [
    ["remove", "social-media", [`${MEMBER}/post-1/a.jpg`, `${MEMBER}/post-1/b.jpg`, `${MEMBER}/profile/me.jpg`, `${MEMBER}/stray.jpg`]],
  ]);
});

test("a folder of more than 1,000 photos is read page by page and removed in batches of 1,000", async () => {
  const many = Array.from({ length: 1500 }, (_, index) => ({ name: `p${String(index).padStart(4, "0")}.jpg`, id: `f${index}` }));
  const fakeBucket = bucket({ [MEMBER]: [{ name: "post-1", id: null }], [`${MEMBER}/post-1`]: many });
  const result = await social.removeSocialMediaFiles(fakeBucket.client, MEMBER);
  assert.deepEqual(result, { removed: 1500, error: null });
  assert.deepEqual(fakeBucket.calls.filter(([op, , path]) => op === "list" && path === `${MEMBER}/post-1`).map(([, , , offset]) => offset), [0, 1000]);
  assert.deepEqual(fakeBucket.calls.filter(([op]) => op === "remove").map(([, , paths]) => paths.length), [1000, 500]);
});

test("a missing social-media bucket means nothing to remove; any other error is passed back and nothing is removed", async () => {
  const missing = bucket({}, { listError: { path: MEMBER, error: { message: "Bucket not found" } } });
  assert.deepEqual(await social.removeSocialMediaFiles(missing.client, MEMBER), { removed: 0, error: null });

  const failure = { message: "storage unavailable" };
  const broken = bucket({ [MEMBER]: [{ name: "post-1", id: null }] }, { listError: { path: `${MEMBER}/post-1`, error: failure } });
  const result = await social.removeSocialMediaFiles(broken.client, MEMBER);
  assert.equal(result.error, failure);
  assert.equal(broken.calls.some(([op]) => op === "remove"), false);
});

test("Admin's copy of the helper matches the FITX app's own removeSocialMediaFiles", { skip: !existsSync(fileURLToPath(new URL("../../src/lib/account/deletion.ts", import.meta.url))) }, () => {
  const body = (source) => source.slice(source.indexOf("const SOCIAL_PAGE"), source.indexOf("return { removed, error: null };"));
  const app = readFileSync(fileURLToPath(new URL("../../src/lib/account/deletion.ts", import.meta.url)), "utf8");
  const own = readFileSync(fileURLToPath(new URL("../src/lib/social-media-storage.ts", import.meta.url)), "utf8");
  assert.ok(body(own).length > 200);
  assert.equal(body(own), body(app));
  assert.match(app, /SOCIAL_MEDIA_BUCKET = "social-media"/);
  assert.match(own, /SOCIAL_MEDIA_BUCKET = "social-media"/);
});

function deletionForm() {
  const data = new FormData();
  data.append("userId", MEMBER);
  data.append("reason", "Asked by the member by email");
  data.append("confirmEmail", "member@example.test");
  return data;
}

/** The fake Supabase for a deletion: one private photo, two Explore photos, no live subscription. */
function deletionHandler({ socialListError = null } = {}) {
  return (call) => {
    if (call.auth === "getUserById") return { data: { user: { id: MEMBER, email: "member@example.test", phone: null } }, error: null };
    if (call.auth === "deleteUser") return { data: null, error: null };
    if (call.table === "billing_subscriptions") return { data: [], error: null };
    if (call.storage === "fitx-user-media" && call.op === "list") return { data: call.args[0] === MEMBER ? [{ name: "avatar.jpg", id: "u1" }] : [], error: null };
    if (call.storage === "social-media" && call.op === "list") {
      if (socialListError) return { data: null, error: socialListError };
      const [path] = call.args;
      if (path === MEMBER) return { data: [{ name: "post-1", id: null }], error: null };
      if (path === `${MEMBER}/post-1`) return { data: [{ name: "a.jpg", id: "s1" }, { name: "b.jpg", id: "s2" }], error: null };
      return { data: [], error: null };
    }
    if (call.op === "remove") return { data: call.args[0].map((name) => ({ name })), error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = operator;
});

test("Admin's deleteAccount removes the member's Explore photos before it deletes the login", async () => {
  fake.handler = deletionHandler();
  await assert.rejects(userActions.deleteAccount({ status: "idle" }, deletionForm()), (error) => {
    assert.deepEqual(sealedRedirect(error.url, operator.id), { path: "/users", notice: { code: "deleted", count: null } });
    return true;
  });
  const socialRemove = fake.calls.findIndex((call) => call.storage === "social-media" && call.op === "remove");
  const deleteUser = fake.calls.findIndex((call) => call.auth === "deleteUser");
  assert.ok(socialRemove >= 0, "the Explore photos are removed");
  assert.ok(socialRemove < deleteUser, "before the login is deleted");
  assert.deepEqual(fake.calls[socialRemove].args[0], [`${MEMBER}/post-1/a.jpg`, `${MEMBER}/post-1/b.jpg`]);
  const done = rpcCalls("fitx_admin_op_log_event").find((call) => call.args.p_action === "user_deleted");
  assert.equal(done.args.p_details.files_removed, 3);
});

test("when the Explore photos cannot be removed, the account is kept and the failure is audited", async () => {
  fake.handler = deletionHandler({ socialListError: { message: "storage unavailable" } });
  // Refused beside the Delete button, with the reason and the typed confirmation kept (BUGS.md 63).
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const refused = await userActions.deleteAccount({ status: "idle" }, deletionForm()).finally(() => { console.error = original; });
  assert.deepEqual(refused, { status: "error", message: "The account was not deleted. The audit log and server log have the details.", fieldErrors: undefined });
  assert.ok(errors.some((line) => line.includes("people.delete_social_storage")), "the failure is logged");
  assert.equal(fake.calls.some((call) => call.auth === "deleteUser"), false);
  const failed = rpcCalls("fitx_admin_op_log_event").find((call) => call.args.p_action === "user_delete_failed");
  assert.equal(failed.args.p_details.step, "social_storage");
});
