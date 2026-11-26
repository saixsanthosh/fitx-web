// Fix round 3d (open-3c-profile-save-timeout): Add photo, Change photo, Remove photo and Download photo waited on storage
// and the profile with no time limit, so a request that never answered left "Working…" up (and every photo button busy)
// until the page was reloaded. Each step now waits only so long (src/components/profile/photo-file.ts): the upload as
// long as its file needs on a slow connection, the profile's save 20 s and cancelled then, clean-ups 20 s. Bug 21's
// order holds throughout: the old photo goes only once the new one is stored, opens and is on the profile.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PHOTO_DID_NOT_OPEN,
  PHOTO_LINK_TIMED_OUT,
  PHOTO_MAX_BYTES,
  PHOTO_SAVE_FAILED,
  PHOTO_SAVE_TIMED_OUT,
  PHOTO_UPLOAD_TIMED_OUT,
  SLOWEST_UPLOAD_BYTES_PER_SECOND,
  replacePhoto,
  signedUrlWithin,
  uploadLimitMs,
  type PhotoSteps,
} from "@/components/profile/photo-file";
import { PROFILE_TIME_LIMIT_MS } from "@/components/profile/profile-save";

const USER = "11111111-2222-4333-8444-555555555555";
const OLD = `${USER}/avatar-1795632131615.png`;
const NEW = `${USER}/avatar-1795632153147.png`;
const input = (limits?: Parameters<typeof replacePhoto>[1]["limits"]) => ({ userId: USER, type: "image/png" as const, previous: OLD, now: 1795632153147, limits });
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A step's answer the test gives by hand: `answer(value)` settles it. */
function later<T>() {
  let answer: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { answer = resolve; });
  return { promise, answer };
}

type Overrides = { upload?: () => PromiseLike<{ error: unknown }>; opens?: () => PromiseLike<boolean>; save?: (signal: AbortSignal) => PromiseLike<{ error: unknown }>; remove?: (paths: string[]) => PromiseLike<unknown> };

function fakeSteps(overrides: Overrides = {}) {
  const calls: string[][] = [];
  const signals: AbortSignal[] = [];
  const steps: PhotoSteps = {
    upload: (path, type) => { calls.push(["upload", path, type]); return overrides.upload?.() ?? Promise.resolve({ error: null }); },
    opens: (path) => { calls.push(["opens", path]); return overrides.opens?.() ?? Promise.resolve(true); },
    save: (path, signal) => { calls.push(["save", path]); signals.push(signal); return overrides.save?.(signal) ?? Promise.resolve({ error: null }); },
    remove: (paths) => { calls.push(["remove", ...paths]); return overrides.remove?.(paths) ?? Promise.resolve({ error: null }); },
  };
  return { steps, calls, signals };
}

describe("the upload's limit grows with the file", () => {
  test("Profile's 20 s plus the file at 256 kbit/s: about three minutes for 5 MB", () => {
    assert.equal(SLOWEST_UPLOAD_BYTES_PER_SECOND, 32_000);
    assert.equal(uploadLimitMs(0), PROFILE_TIME_LIMIT_MS.save);
    assert.equal(uploadLimitMs(32_000), PROFILE_TIME_LIMIT_MS.save + 1_000);
    assert.equal(uploadLimitMs(1_000_000), 51_250, "1 MB");
    assert.equal(uploadLimitMs(PHOTO_MAX_BYTES), 183_840, "5 MB");
    assert.ok(uploadLimitMs(2_000_000) > uploadLimitMs(1_000_000), "a bigger file gets longer");
  });
});

describe("replacing the photo waits only so long at each step", () => {
  test("an upload that never answers stops at its limit, not before; nothing changes, and a late upload is removed again", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const upload = later<{ error: unknown }>();
    const { steps, calls } = fakeSteps({ upload: () => upload.promise });
    let settled = false;
    const outcome = replacePhoto(steps, input({ upload: 60_000 }));
    void outcome.then(() => { settled = true; });
    await turn();
    t.mock.timers.tick(59_999);
    await turn();
    assert.equal(settled, false, "a slow upload is still waited for");
    t.mock.timers.tick(1);
    assert.deepEqual(await outcome, { ok: false, step: "upload", message: PHOTO_UPLOAD_TIMED_OUT });
    assert.deepEqual(calls, [["upload", NEW, "image/png"]], "never checked, never saved, the old photo never touched");
    upload.answer({ error: null });
    await turn();
    assert.deepEqual(calls.at(-1), ["remove", NEW], "the upload that landed after all is removed again");
  });

  test("a late upload that failed removes nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const upload = later<{ error: unknown }>();
    const { steps, calls } = fakeSteps({ upload: () => upload.promise });
    const outcome = replacePhoto(steps, input({ upload: 1_000 }));
    await turn();
    t.mock.timers.tick(1_000);
    assert.equal((await outcome).ok, false);
    upload.answer({ error: { message: "storage down" } });
    await turn();
    assert.deepEqual(calls, [["upload", NEW, "image/png"]]);
  });

  test("by default the upload gets the 5 MB photo's limit", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { steps } = fakeSteps({ upload: never });
    let settled = false;
    const outcome = replacePhoto(steps, input());
    void outcome.then(() => { settled = true; });
    await turn();
    t.mock.timers.tick(uploadLimitMs(PHOTO_MAX_BYTES) - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.equal((await outcome).ok, false);
  });

  test("a profile save that never answers stops at 20 s and is cancelled; the new upload and the old photo both stay", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { steps, calls, signals } = fakeSteps({ save: () => never() });
    let settled = false;
    const outcome = replacePhoto(steps, input());
    void outcome.then(() => { settled = true; });
    await turn();
    assert.deepEqual(calls, [["upload", NEW, "image/png"], ["opens", NEW], ["save", NEW]]);
    assert.equal(signals[0].aborted, false, "the save's request carries a signal, left alone until the limit");
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await outcome, { ok: false, step: "save", message: PHOTO_SAVE_TIMED_OUT });
    assert.equal(signals[0].aborted, true, "the profile's request is cancelled");
    // It may still have reached the database: removing the new upload could leave the profile pointing at nothing.
    assert.ok(!calls.some(([name]) => name === "remove"), "nothing is removed");
  });

  test("a save that answers in time is used as before: refused, the new upload goes; saved, the old photo goes", async () => {
    const refused = fakeSteps({ save: async () => ({ error: { code: "42501" } }) });
    assert.deepEqual(await replacePhoto(refused.steps, input()), { ok: false, step: "save", message: PHOTO_SAVE_FAILED });
    assert.deepEqual(refused.calls.at(-1), ["remove", NEW]);
    const broken = fakeSteps({ save: async () => { throw new Error("offline"); } });
    assert.deepEqual(await replacePhoto(broken.steps, input()), { ok: false, step: "save", message: PHOTO_SAVE_FAILED });
    assert.deepEqual(broken.calls.at(-1), ["remove", NEW]);
    const saved = fakeSteps();
    assert.deepEqual(await replacePhoto(saved.steps, input()), { ok: true, path: NEW });
    assert.deepEqual(saved.calls.at(-1), ["remove", OLD]);
    assert.equal(saved.signals[0].aborted, false);
  });

  test("clean-ups that never answer are waited for only so long", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const notOpening = fakeSteps({ opens: async () => false, remove: () => never() });
    const shut = replacePhoto(notOpening.steps, input());
    await turn();
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save);
    assert.deepEqual(await shut, { ok: false, step: "open", message: PHOTO_DID_NOT_OPEN });

    const oldStuck = fakeSteps({ remove: () => never() });
    let settled = false;
    const replaced = replacePhoto(oldStuck.steps, input());
    void replaced.then(() => { settled = true; });
    await turn();
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await replaced, { ok: true, path: NEW }, "the new photo stands even if the old one's removal never answers");
  });
});

describe("storage links within the limit", () => {
  test("a link in time, none when refused or broken off, and 'timed_out' at 20 s", async (t) => {
    assert.equal(await signedUrlWithin(Promise.resolve({ data: { signedUrl: "https://storage.example/a" }, error: null })), "https://storage.example/a");
    assert.equal(await signedUrlWithin(Promise.resolve({ data: null, error: { message: "not found" } })), null);
    assert.equal(await signedUrlWithin(Promise.reject(new Error("offline"))), null);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    const link = signedUrlWithin(never());
    void link.then(() => { settled = true; });
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.equal(await link, "timed_out");
  });

  test("the download's message is plain and says what to do", () => {
    for (const message of [PHOTO_LINK_TIMED_OUT, PHOTO_UPLOAD_TIMED_OUT, PHOTO_SAVE_TIMED_OUT]) {
      assert.match(message, / is taking too long, so we stopped waiting\. (Nothing changed\. )?Check your connection and try again\.$/);
      assert.doesNotMatch(message, /error|fail|timeout|timed out|request/i);
    }
  });
});

describe("Profile uses it", () => {
  const view = readFileSync(new URL("../../src/app/(dashboard)/profile/ProfileView.tsx", import.meta.url), "utf8");

  test("the upload gets its file's limit, the save its signal, and the stored copy's link its limit", () => {
    const upload = view.slice(view.indexOf("async function uploadPhoto"), view.indexOf("async function downloadPhoto"));
    assert.match(upload, /limits: \{ upload: uploadLimitMs\(file\.size\) \}/);
    assert.match(upload, /save: \(path, signal\) => updateProfileRow\(withAbortSignal\(supabase, signal\), data\.userId, \{ avatar: path \}\),/);
    assert.match(upload, /const url = await signedUrlWithin\(bucket\.createSignedUrl\(path, 120\)\);\s*if \(!url \|\| url === "timed_out"\) return false;/);
    assert.doesNotMatch(upload, /await bucket\.createSignedUrl/, "no link is waited for without the limit");
  });

  test("Download photo waits for its link only so long, and says so", () => {
    const download = view.slice(view.indexOf("async function downloadPhoto"), view.indexOf("async function removePhoto"));
    assert.match(download, /const url = await signedUrlWithin\(supabase\.storage\.from\(MEDIA_BUCKET\)\.createSignedUrl\(storedAvatar, 60, \{ download: fileName \}\)\);\s*setBusy\(""\);\s*if \(url === "timed_out"\) return setError\(PHOTO_LINK_TIMED_OUT\);\s*if \(!url\) return setError\("Your photo couldn't be downloaded\. Try again\."\);\s*window\.location\.assign\(url\);/);
  });
});
