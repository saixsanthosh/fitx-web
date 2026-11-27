// open-3c-food-photo-order: uploading a food's new photo removed its old one before the food pointed at the new one, so
// a save that then failed left the food pointing at a deleted file ("The photo was not saved", and the old photo gone
// too). Bug 21's rule: the old photo goes only once the food points at a new one that is stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceCustomFoodPhoto } from "@/lib/food/client-data";
import { FOOD_PHOTO_BUCKET, FoodPhotoError, photoNotSavedText, uploadFoodPhoto } from "@/lib/food/food-photos";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const STAMP = 1764150000000;
const OLD = `${USER}/foods/c1-1763000000000.webp`;
const NEW = `${USER}/foods/c1-${STAMP}.webp`;
const FOREIGN = "bbbbbbbb-0000-4000-8000-000000000002/foods/c9-1.webp";
const webp = new Blob(["webp bytes"], { type: "image/webp" });

type Failure = { upload?: string; update?: number; remove?: "error" | "throw" };
type Answer = { data: null; error: { code: string; message: string } | null; status: number };
interface UpdateQuery {
  update(values: Record<string, unknown>): UpdateQuery;
  eq(column: string, value: unknown): UpdateQuery;
  then<T>(resolve: (answer: Answer) => T, reject?: (reason: unknown) => T): Promise<T>;
}

/**
 * One food's image_path and the photo files as one ordered log. Every step checks bug 21's rule (the food never points
 * at a file that isn't there). The upload can fail with a storage error's name, the row update with an HTTP status
 * (0: it never reached FITX) and the removal with an error answer or a throw.
 */
function photoStore(start: string | null, fail: Failure = {}) {
  const log: string[] = [];
  const broken: string[] = [];
  const uploads: { bucket: string; path: string; contentType: unknown; upsert: unknown }[] = [];
  const files = new Set<string>(start ? [start] : []);
  let imagePath = start;
  const check = (step: string) => {
    if (imagePath !== null && !files.has(imagePath)) broken.push(`${step}: the food points at ${imagePath}, which is gone`);
  };
  const from = (table: string) => {
    let values: Record<string, unknown> = {};
    const filters: string[] = [];
    const builder: UpdateQuery = {
      update(next) { values = next; return builder; },
      eq(column, value) { filters.push(`${column}=${String(value)}`); return builder; },
      then(resolve, reject) {
        log.push(`${table}.update ${Object.entries(values).map(([key, value]) => `${key}=${String(value)}`).join(" ")} where ${filters.join(" ")}`);
        const answer: Answer = fail.update !== undefined
          ? { data: null, error: { code: fail.update ? String(fail.update) : "", message: fail.update ? "refused" : "TypeError: Failed to fetch" }, status: fail.update }
          : { data: null, error: null, status: 204 };
        if (!answer.error) imagePath = values.image_path as string | null;
        check("update");
        return Promise.resolve(answer).then(resolve, reject);
      },
    };
    return builder;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Blob, options: { contentType?: string; upsert?: boolean }) => {
        log.push(`upload ${path}`);
        uploads.push({ bucket, path, contentType: options.contentType, upsert: options.upsert });
        if (fail.upload) return { data: null, error: { name: fail.upload, message: "upload failed" } };
        files.add(path);
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        log.push(`remove ${paths.join(",")}`);
        if (fail.remove === "throw") throw new TypeError("Failed to fetch");
        if (fail.remove === "error") return { data: null, error: { name: "StorageUnknownError", message: "Failed to fetch" } };
        for (const path of paths) files.delete(path);
        check("remove");
        return { data: [], error: null };
      },
    }),
  };
  return {
    client: { from, storage } as unknown as SupabaseClient,
    log,
    broken,
    uploads,
    state: () => ({ imagePath, files: [...files].sort() }),
  };
}

const update = (path: string) => `custom_foods.update image_path=${path} where id=c1 user_id=${USER}`;
const said = async (work: Promise<unknown>) => {
  try {
    await work;
    return null;
  } catch (cause) {
    assert.ok(cause instanceof FoodPhotoError, "every failure is FITX's own");
    return photoNotSavedText(cause);
  }
};

test("a new photo is stored and the food points at it before its old photo goes", async () => {
  const store = photoStore(OLD);
  assert.equal(await replaceCustomFoodPhoto(store.client, USER, { id: "c1", image_path: OLD }, webp, STAMP), NEW);
  assert.deepEqual(store.log, [`upload ${NEW}`, update(NEW), `remove ${OLD}`], "the old photo goes last");
  assert.deepEqual(store.state(), { imagePath: NEW, files: [NEW] });
  assert.deepEqual(store.broken, []);
});

test("an upload that fails changes nothing: the food keeps its photo", async () => {
  for (const [name, reason] of [["StorageUnknownError", "Check your connection and try again."], ["StorageApiError", "Please try again."]] as const) {
    const store = photoStore(OLD, { upload: name });
    assert.equal(await said(replaceCustomFoodPhoto(store.client, USER, { id: "c1", image_path: OLD }, webp, STAMP)), `The photo was not saved. ${reason}`, name);
    assert.deepEqual(store.log, [`upload ${NEW}`], `${name}: no update, nothing removed`);
    assert.deepEqual(store.state(), { imagePath: OLD, files: [OLD] });
    assert.deepEqual(store.broken, []);
  }
});

test("a food that can't be pointed at its new photo keeps the old one, and the new upload goes", async () => {
  for (const [status, reason] of [[0, "Check your connection and try again."], [500, "Please try again."], [403, "Please try again."]] as const) {
    const store = photoStore(OLD, { update: status });
    assert.equal(await said(replaceCustomFoodPhoto(store.client, USER, { id: "c1", image_path: OLD }, webp, STAMP)), `The photo was not saved. ${reason}`, `status ${status}`);
    assert.deepEqual(store.log, [`upload ${NEW}`, update(NEW), `remove ${NEW}`], `status ${status}: the new upload goes, the old photo is not touched`);
    assert.deepEqual(store.state(), { imagePath: OLD, files: [OLD] }, `status ${status}: the food still shows its old photo`);
    assert.deepEqual(store.broken, []);
  }
});

test("a clean-up that fails never changes what the member is told", async () => {
  for (const remove of ["error", "throw"] as const) {
    const saved = photoStore(OLD, { remove });
    assert.equal(await replaceCustomFoodPhoto(saved.client, USER, { id: "c1", image_path: OLD }, webp, STAMP), NEW, `${remove}: the photo is saved`);
    assert.equal(saved.state().imagePath, NEW);
    assert.deepEqual(saved.broken, [], `${remove}: the old file is only left over in the member's own folder`);
    const refused = photoStore(OLD, { remove, update: 0 });
    assert.equal(await said(replaceCustomFoodPhoto(refused.client, USER, { id: "c1", image_path: OLD }, webp, STAMP)), "The photo was not saved. Check your connection and try again.", `${remove}: the save's own failure is said`);
    assert.equal(refused.state().imagePath, OLD);
    assert.deepEqual(refused.broken, []);
  }
});

test("a first photo has nothing to remove, and a file outside the member's folder is never removed", async () => {
  const first = photoStore(null);
  assert.equal(await replaceCustomFoodPhoto(first.client, USER, { id: "c1", image_path: null }, webp, STAMP), NEW);
  assert.deepEqual(first.log, [`upload ${NEW}`, update(NEW)]);
  const foreign = photoStore(FOREIGN);
  assert.equal(await replaceCustomFoodPhoto(foreign.client, USER, { id: "c1", image_path: FOREIGN }, webp, STAMP), NEW);
  assert.deepEqual(foreign.log, [`upload ${NEW}`, update(NEW)]);
  assert.deepEqual(foreign.state().files, [FOREIGN, NEW].sort());
});

test("uploading stores a new file in the member's own folder and removes nothing", async () => {
  const store = photoStore(OLD);
  assert.equal(await uploadFoodPhoto(store.client, USER, "c1", webp, STAMP), NEW);
  assert.deepEqual(store.uploads, [{ bucket: FOOD_PHOTO_BUCKET, path: NEW, contentType: "image/webp", upsert: false }], "never over another file");
  assert.deepEqual(store.state(), { imagePath: OLD, files: [NEW, OLD].sort() }, "the food is not touched");
  const jpeg = photoStore(null);
  await uploadFoodPhoto(jpeg.client, USER, "c1", new Blob(["jpeg bytes"], { type: "image/jpeg" }), STAMP);
  assert.equal(jpeg.uploads[0].contentType, "image/jpeg", "shrinkPhoto's JPEG fallback keeps its type");
  const photos = read("src/lib/food/food-photos.ts");
  const upload = photos.slice(photos.indexOf("export async function uploadFoodPhoto("), photos.indexOf("export async function signedPhotoUrls("));
  assert.doesNotMatch(upload, /\.remove\(/, "uploading a photo never removes one");
});

test("Save in the food form goes the same way, and a saved photo is never called not saved", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const save = page.slice(page.indexOf("async function saveFood("), page.indexOf("async function removeFood("));
  // For the member the save checked (saveMember, fix round 3f).
  assert.match(save, /const path = await replaceCustomFoodPhoto\(supabase, member\.uid, row, await shrinkPhoto\(photo\)\);/);
  assert.doesNotMatch(save, /uploadFoodPhoto\(/);
  assert.doesNotMatch(save, /update\(\{ image_path/, "only replaceCustomFoodPhoto points the food at a photo");
  assert.match(save, /photoUrl = await signedPhotoUrls\(supabase, \[path\]\)\.then\(\(urls\) => urls\.get\(path\) \?\? null, \(\) => null\);/, "a link that can't be made now is not a failed save");
});
