// Profile > Add photo / Change photo (bug 21): a file is judged by its content, not its name, and the old photo is
// only deleted once the new one is stored, opens and is on the profile (src/components/profile/photo-file.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PHOTO_DID_NOT_OPEN,
  PHOTO_HEADER_BYTES,
  PHOTO_MAX_BYTES,
  PHOTO_NOT_AN_IMAGE,
  PHOTO_SAVE_FAILED,
  PHOTO_TOO_BIG,
  PHOTO_UPLOAD_FAILED,
  checkPhotoFile,
  isOwnPhoto,
  photoPath,
  replacePhoto,
  sniffPhotoType,
  type PhotoSteps,
} from "@/components/profile/photo-file";

const USER = "11111111-2222-4333-8444-555555555555";
// A real 1×1 PNG (the e2e fixture's), and the hunt's 18-byte text file saved as "not-an-image.png".
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const TEXT = new TextEncoder().encode("hello this is text");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0x24, 0x00, 0x00, 0x00, ...new TextEncoder().encode("WEBPVP8 ")]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00\x00\x00");

const head = (bytes: Uint8Array) => bytes.subarray(0, PHOTO_HEADER_BYTES);

describe("what a picked file really is", () => {
  test("the first bytes decide: PNG, JPEG and WebP are known, anything else is not", () => {
    assert.equal(sniffPhotoType(head(PNG)), "image/png");
    assert.equal(sniffPhotoType(head(JPEG)), "image/jpeg");
    assert.equal(sniffPhotoType(head(WEBP)), "image/webp");
    assert.equal(sniffPhotoType(head(TEXT)), null, "text renamed .png is not a PNG");
    assert.equal(sniffPhotoType(head(GIF)), null, "a GIF is not one of the three");
    assert.equal(sniffPhotoType(new Uint8Array()), null);
    assert.equal(sniffPhotoType(new Uint8Array([0x89, 0x50, 0x4e])), null, "a cut-off PNG signature");
    assert.equal(sniffPhotoType(new TextEncoder().encode("RIFF\0\0\0\0WAVE")), null, "a RIFF file that isn't WebP");
  });

  test("the 18-byte text file is refused with the usual message, whatever the browser said its type was", () => {
    assert.deepEqual(checkPhotoFile({ size: TEXT.length }, head(TEXT)), { ok: false, message: PHOTO_NOT_AN_IMAGE });
    assert.equal(PHOTO_NOT_AN_IMAGE, "Choose a JPEG, PNG or WebP image.");
  });

  test("a real PNG passes with its real type, even when its name says JPEG", () => {
    assert.deepEqual(checkPhotoFile({ size: PNG.length }, head(PNG)), { ok: true, type: "image/png" });
    assert.equal(photoPath(USER, "image/png", 1795632131615), `${USER}/avatar-1795632131615.png`, "stored as .png");
    assert.equal(photoPath(USER, "image/jpeg", 1), `${USER}/avatar-1.jpg`);
    assert.equal(photoPath(USER, "image/webp", 1), `${USER}/avatar-1.webp`);
  });

  test("an empty file and one over 5 MB are refused before anything is read or sent", () => {
    assert.deepEqual(checkPhotoFile({ size: 0 }, new Uint8Array()), { ok: false, message: PHOTO_NOT_AN_IMAGE });
    assert.deepEqual(checkPhotoFile({ size: PHOTO_MAX_BYTES + 1 }, head(PNG)), { ok: false, message: PHOTO_TOO_BIG });
    assert.deepEqual(checkPhotoFile({ size: PHOTO_MAX_BYTES }, head(PNG)), { ok: true, type: "image/png" }, "exactly 5 MB is fine");
  });

  test("only photos in the member's own folder count as FITX uploads", () => {
    assert.equal(isOwnPhoto(`${USER}/avatar-1.png`, USER), true);
    assert.equal(isOwnPhoto("https://lh3.googleusercontent.com/a/photo", USER), false, "a Google picture is a link");
    assert.equal(isOwnPhoto("someone-else/avatar-1.png", USER), false);
    assert.equal(isOwnPhoto(null, USER), false);
  });
});

type Call = [string, ...unknown[]];

function fakeSteps(overrides: Partial<{ upload: unknown; opens: unknown; save: unknown; remove: unknown }> = {}) {
  const calls: Call[] = [];
  const result = <T>(value: unknown, fallback: T): Promise<T> => {
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve((value === undefined ? fallback : value) as T);
  };
  const steps: PhotoSteps = {
    upload: (path, type) => { calls.push(["upload", path, type]); return result(overrides.upload, { error: null }); },
    opens: (path) => { calls.push(["opens", path]); return result(overrides.opens, true); },
    save: (path) => { calls.push(["save", path]); return result(overrides.save, { error: null }); },
    remove: (paths) => { calls.push(["remove", ...paths]); return result(overrides.remove, { error: null }); },
  };
  return { steps, calls };
}

const OLD = `${USER}/avatar-1795632131615.png`;
const NEW = `${USER}/avatar-1795632153147.png`;
const input = (previous: string | null = OLD) => ({ userId: USER, type: "image/png" as const, previous, now: 1795632153147 });

describe("replacing the photo", () => {
  test("upload, check it opens, save it on the profile, and only then delete the old photo", async () => {
    const { steps, calls } = fakeSteps();
    assert.deepEqual(await replacePhoto(steps, input()), { ok: true, path: NEW });
    assert.deepEqual(calls, [["upload", NEW, "image/png"], ["opens", NEW], ["save", NEW], ["remove", OLD]]);
  });

  test("a new photo that doesn't open from storage is removed; the profile and the old photo stay", async () => {
    const { steps, calls } = fakeSteps({ opens: false });
    assert.deepEqual(await replacePhoto(steps, input()), { ok: false, step: "open", message: PHOTO_DID_NOT_OPEN });
    assert.deepEqual(calls, [["upload", NEW, "image/png"], ["opens", NEW], ["remove", NEW]], "never saved, old photo never touched");
  });

  test("a check that throws counts as not opening", async () => {
    const { steps, calls } = fakeSteps({ opens: new Error("network") });
    assert.equal((await replacePhoto(steps, input())).ok, false);
    assert.ok(!calls.some(([name, path]) => name === "remove" && path === OLD));
  });

  test("a failed upload changes nothing", async () => {
    for (const upload of [{ error: { message: "mime type not supported" } }, new Error("offline")]) {
      const { steps, calls } = fakeSteps({ upload });
      assert.deepEqual(await replacePhoto(steps, input()), { ok: false, step: "upload", message: PHOTO_UPLOAD_FAILED });
      assert.deepEqual(calls, [["upload", NEW, "image/png"]]);
    }
  });

  test("a failed profile save removes the new upload and keeps the old photo", async () => {
    const { steps, calls } = fakeSteps({ save: { error: { code: "42501" } } });
    assert.deepEqual(await replacePhoto(steps, input()), { ok: false, step: "save", message: PHOTO_SAVE_FAILED });
    assert.deepEqual(calls.at(-1), ["remove", NEW]);
    assert.ok(!calls.some(([name, path]) => name === "remove" && path === OLD));
  });

  test("a first photo, or a Google picture before it, deletes nothing", async () => {
    for (const previous of [null, "https://lh3.googleusercontent.com/a/photo"]) {
      const { steps, calls } = fakeSteps();
      assert.equal((await replacePhoto(steps, input(previous))).ok, true);
      assert.ok(!calls.some(([name]) => name === "remove"), String(previous));
    }
  });

  test("an old photo that can't be deleted doesn't undo the new one", async () => {
    const { steps } = fakeSteps({ remove: new Error("storage down") });
    assert.deepEqual(await replacePhoto(steps, input()), { ok: true, path: NEW });
  });
});

describe("Profile uses it", () => {
  const view = readFileSync(new URL("../../src/app/(dashboard)/profile/ProfileView.tsx", import.meta.url), "utf8");

  test("the picked file is checked by content and opened before upload, and stored with its real type", () => {
    assert.match(view, /const check = checkPhotoFile\(file, header\);/);
    assert.match(view, /if \(!\(await fileOpens\(file\)\)\) return stop\(PHOTO_NOT_AN_IMAGE\);/);
    assert.match(view, /bucket\.upload\(path, file\.slice\(0, file\.size, type\), \{ contentType: type, upsert: false \}\)/);
    assert.doesNotMatch(view, /file\.type/, "the declared type (from the file name) decides nothing");
  });

  test("the old photo is deleted only through replacePhoto", () => {
    const upload = view.slice(view.indexOf("async function uploadPhoto"), view.indexOf("async function downloadPhoto"));
    assert.match(upload, /await replacePhoto\(\{/);
    assert.doesNotMatch(upload, /remove\(\[storedAvatar\]\)/);
  });
});
