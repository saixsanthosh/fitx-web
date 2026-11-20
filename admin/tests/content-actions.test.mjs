// The Workouts, Nutrition, Subscriptions and Reports server code with a fake Supabase: each change goes
// through its fitx_admin_op_* function with the operator, forms are checked before any call, uploads are
// checked before anything points at them, and the CSV export is audited.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const storage = `
const fake = globalThis.__fitxAdminFake;
export async function createSignedUpload(bucket, ownerId, kind, type) { fake.storage.push(["sign", bucket, ownerId, kind, type]); return { ok: true, path: "admin/" + ownerId + "/still-AbCdEf123456.jpg", uploadUrl: "https://example-project.supabase.co/sign" }; }
export async function checkUploadedFile(bucket, path, kind) { fake.storage.push(["check", bucket, path, kind]); return fake.uploadCheck ?? { ok: true, url: "https://example-project.supabase.co/storage/v1/object/public/" + bucket + "/" + path, type: "image/jpeg", size: 10 }; }
export async function removeFiles(bucket, paths) { fake.storage.push(["remove", bucket, [...paths]]); }
export function supabaseProjectUrl() { return "https://example-project.supabase.co"; }
`;
const STUBS = { ...SESSION_STUBS, "@/lib/content/storage": storage };

const training = await importTypeScriptModule("src/app/(control)/training/actions.ts", STUBS);
const nutrition = await importTypeScriptModule("src/app/(control)/nutrition/actions.ts", STUBS);
const billing = await importTypeScriptModule("src/app/(control)/billing/actions.ts", STUBS);
const exportRoute = await importTypeScriptModule("src/app/(control)/reports/export/route.ts", STUBS);

const operator = { id: "00000000-0000-4000-8000-0000000000aa", username: "editor", role: "content_editor", permissions: [] };

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = operator;
  fake.storage = [];
  fake.uploadCheck = undefined;
});

async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

function form(entries) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const exerciseForm = () => form([
  ["name", "Tempo Goblet Squat"], ["category", "strength"], ["movement_pattern", "squat"], ["difficulty", "beginner"],
  ["primary_muscle", "quadriceps"], ["required_equipment", "dumbbell"], ["prescription_type", "reps"], ["recommended_sets", "3"],
  ["reps_min", "8"], ["reps_max", "12"], ["rest_seconds", "90"], ["instructions", "Sit down.\nStand up."],
]);

test("an invalid exercise form is answered field by field and never reaches the database", async () => {
  const state = await training.saveExercise(null, { status: "idle" }, form([["name", "A"]]));
  assert.equal(state.status, "error");
  assert.ok(state.fieldErrors.name && state.fieldErrors.primary_muscle);
  assert.equal(fake.calls.length, 0);
});

test("a new exercise is saved by the operator's function and opens its own page", async () => {
  fake.handler = (call) => (call.rpc === "fitx_admin_op_save_exercise" ? { data: "fitx-tempo-goblet-squat", error: null } : { data: null, error: null });
  const { error } = await outcome(training.saveExercise(null, { status: "idle" }, exerciseForm()));
  assert.equal(error?.url, "/training/exercises/fitx-tempo-goblet-squat?state=created");
  const [call] = rpcCalls("fitx_admin_op_save_exercise");
  assert.equal(call.args.p_operator_id, operator.id);
  assert.equal(call.args.p_exercise_id, null);
  assert.equal(call.args.p_exercise.muscle_group, "quadriceps");
  assert.equal(call.args.p_exercise.is_active, false);
});

test("a taken name comes back on the name field; other database refusals are worded, not raw", async () => {
  fake.handler = () => ({ data: null, error: { code: "23505", message: "An exercise with this name exists" } });
  const taken = await training.saveExercise("bench_press", { status: "idle" }, exerciseForm());
  assert.equal(taken.fieldErrors.name, "An exercise with this name exists.");
  fake.handler = () => ({ data: null, error: { code: "XX000", message: "relation detail" } });
  const failed = await training.saveExercise("bench_press", { status: "idle" }, exerciseForm());
  assert.equal(failed.message, "The change could not be saved. Nothing was changed.");
  const bad = await training.saveExercise("../x", { status: "idle" }, exerciseForm());
  assert.equal(bad.status, "error");
});

test("uploads: only into the exercise's own folder, checked first, refused files deleted and audited", async () => {
  const signed = await training.prepareExerciseUpload({ ownerId: "bench_press", kind: "still", type: "image/jpeg", size: 2048 });
  assert.equal(signed.ok, true);
  assert.deepEqual(fake.storage[0], ["sign", "exercise-media", "bench_press", "still", "image/jpeg"]);
  assert.equal((await training.prepareExerciseUpload({ ownerId: "bench_press", kind: "still", type: "image/svg+xml", size: 10 })).ok, false);
  assert.equal((await training.prepareExerciseUpload({ ownerId: "bench_press", kind: "food_photo", type: "image/jpeg", size: 10 })).ok, false);

  const elsewhere = await training.finishExerciseUpload({ ownerId: "bench_press", kind: "still", path: "admin/squat/still-AbCdEf123456.jpg", alt: "", attribution: "FITX", license: "x", width: null, height: null });
  assert.equal(elsewhere.ok, false);
  assert.equal(fake.calls.length, 0);

  fake.uploadCheck = { ok: false, message: "This is not a real JPEG file." };
  const refused = await training.finishExerciseUpload({ ownerId: "bench_press", kind: "still", path: "admin/bench_press/still-AbCdEf123456.jpg", alt: "", attribution: "FITX", license: "x", width: null, height: null });
  assert.equal(refused.message, "This is not a real JPEG file.");
  assert.equal(rpcCalls("fitx_admin_op_log_event")[0].args.p_action, "media_upload_refused");
  assert.equal(rpcCalls("fitx_admin_op_add_exercise_media").length, 0);

  fake.uploadCheck = undefined;
  resetFakes();
  fake.operator = operator;
  fake.storage = [];
  const added = await training.finishExerciseUpload({ ownerId: "bench_press", kind: "still", path: "admin/bench_press/still-AbCdEf123456.jpg", alt: " Bottom ", attribution: "FITX", license: "FITX own work", width: 1200, height: 99999 });
  assert.equal(added.ok, true);
  const [call] = rpcCalls("fitx_admin_op_add_exercise_media");
  assert.equal(call.args.p_alt, "Bottom");
  assert.equal(call.args.p_width, 1200);
  assert.equal(call.args.p_height, null, "an impossible size is dropped");

  fake.handler = () => ({ data: null, error: { code: "FXC03", message: "An exercise holds at most 21 files of one kind" } });
  const full = await training.finishExerciseUpload({ ownerId: "bench_press", kind: "still", path: "admin/bench_press/still-AbCdEf123456.jpg", alt: "", attribution: "FITX", license: "x", width: null, height: null });
  assert.equal(full.ok, false);
  assert.deepEqual(fake.storage.at(-1), ["remove", "exercise-media", ["admin/bench_press/still-AbCdEf123456.jpg"]]);
});

test("deleting an exercise removes its uploaded files only after the database agreed", async () => {
  fake.handler = () => ({ data: null, error: { code: "FXC01", message: "in use" } });
  const inUse = await outcome(training.deleteExercise(form([["exerciseId", "fitx-squat"]])));
  assert.equal(inUse.error.url, "/training/exercises/fitx-squat?state=in_use");
  assert.equal(fake.storage.length, 0);
  fake.handler = () => ({ data: ["admin/fitx-squat/video-AbCdEf123456.mp4"], error: null });
  const done = await outcome(training.deleteExercise(form([["exerciseId", "fitx-squat"]])));
  assert.equal(done.error.url, "/training?state=deleted");
  assert.deepEqual(fake.storage.at(-1), ["remove", "exercise-media", ["admin/fitx-squat/video-AbCdEf123456.mp4"]]);
});

test("food portions and photos go through their functions; a replaced Admin photo is deleted", async () => {
  const saved = await nutrition.saveFoodPortions("2706538", { status: "idle" }, form([["portion_label", "1 idli"], ["portion_unit", "piece"], ["portion_grams", "39"], ["portion_measured", "false"], ["portion_default", "0"]]));
  assert.equal(saved.status, "saved");
  assert.deepEqual(rpcCalls("fitx_admin_op_set_food_portions")[0].args.p_portions, [{ label: "1 idli", unit: "piece", grams: 39, is_default: true, is_estimate: true }]);

  fake.handler = (call) => (call.rpc === "fitx_admin_op_set_food_image" ? { data: "https://example-project.supabase.co/storage/v1/object/public/food-media/admin/2706538/photo-OldOld123456.jpg", error: null } : { data: null, error: null });
  const photo = await nutrition.finishFoodImageUpload({ ownerId: "2706538", kind: "food_photo", path: "admin/2706538/photo-AbCdEf123456.jpg", alt: "", attribution: "Photo: FITX", license: "FITX own work" });
  assert.equal(photo.ok, true);
  assert.match(rpcCalls("fitx_admin_op_set_food_image")[0].args.p_image_url, /food-media\/admin\/2706538\/photo-AbCdEf123456\.jpg$/);
  assert.deepEqual(fake.storage.at(-1), ["remove", "food-media", ["admin/2706538/photo-OldOld123456.jpg"]]);
});

test("plans: a code that is taken is refused before the function; prices never sent on an edit", async () => {
  fake.handler = (call) => (call.table === "billing_plans" ? { data: { code: "premium" }, error: null } : { data: null, error: null });
  const taken = await billing.savePlan(null, { status: "idle" }, form([["code", "premium"], ["name", "Premium"], ["price", "199"], ["billing_period", "monthly"], ["billing_interval", "1"]]));
  assert.equal(taken.fieldErrors.code, "That code is taken.");
  assert.equal(rpcCalls("fitx_admin_op_save_billing_plan").length, 0);

  fake.handler = (call) =>
    call.table === "billing_plans"
      ? { data: { code: "premium", name: "Premium", amount_paise: 19900, billing_period: "monthly", billing_interval: 1, is_active: true, razorpay_plan_id_test: "plan_T1", razorpay_plan_id_live: null, features: [], sort_order: 0 }, error: null }
      : { data: "premium", error: null };
  const edited = await billing.savePlan("premium", { status: "idle" }, form([["code", "premium"], ["name", "Premium plus"], ["price", "1"], ["razorpay_plan_id_test", "plan_Other"]]));
  assert.equal(edited.status, "saved");
  const [call] = rpcCalls("fitx_admin_op_save_billing_plan");
  assert.equal(call.args.p_plan.razorpay_plan_id_test, "plan_T1");
  assert.equal("amount_paise" in call.args.p_plan, false);
});

test("the CSV export answers unknown reports with 400 and audits each export", async () => {
  const unknown = await exportRoute.GET(new Request("https://admin.example/reports/export?kind=people"));
  assert.equal(unknown.status, 400);
  const report = {
    generated_at: "", days: 90, from: "2026-08-23", to: "2026-11-20", accounts_total: 1, accounts_before: 0, daily: [],
    workouts: { completed: 0, abandoned: 0, members: 0, avg_minutes: null, top_exercises: [], activities_by_sport: {}, programme_enrolments_active: 0, programme_enrolments_started: 0 },
    nutrition: { meals: 0, members: 0, barcode_meals: 0, by_source: [], by_slot: {}, custom_foods_created: 0, saved_meals_created: 0, routines_created: 0, water_entries: 0 },
    subscriptions: { by_status: {}, paying_now: 0 }, monthly: [],
  };
  fake.handler = (call) => (call.rpc === "fitx_admin_op_report" ? { data: report, error: null } : { data: 1, error: null });
  const response = await exportRoute.GET(new Request("https://admin.example/reports/export?kind=monthly&days=365"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /fitx-monthly-2026-11-20-365d\.csv/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(rpcCalls("fitx_admin_op_report")[0].args.p_days, 365);
  assert.deepEqual(rpcCalls("fitx_admin_op_log_event")[0].args.p_details, { kind: "monthly", days: 365 });
});

test("every content page and action asks for its section's permission", async () => {
  const root = new URL("../src/app/(control)/", import.meta.url);
  const expected = { training: "content.manage", nutrition: "nutrition.manage", reports: "reports.view" };
  for (const [section, permission] of Object.entries(expected)) {
    const files = (await readdir(new URL(`${section}/`, root), { recursive: true })).filter((name) => /(page\.tsx|actions\.ts|route\.ts)$/.test(name));
    assert.ok(files.length >= 1, section);
    for (const name of files) {
      const source = await readFile(new URL(`${section}/${name}`, root), "utf8");
      for (const match of source.matchAll(/requireAdmin\("([a-z.]+)"\)/g)) assert.equal(match[1], permission, `${section}/${name}`);
    }
  }
  const billingActions = await readFile(new URL("billing/actions.ts", root), "utf8");
  assert.match(billingActions, /requireAdmin\("billing\.manage"\)/);
  for (const name of ["plans/new/page.tsx", "plans/[code]/page.tsx"]) {
    assert.match(await readFile(new URL(`billing/${name}`, root), "utf8"), /requireAdmin\("billing\.manage"\)/, name);
  }
});
