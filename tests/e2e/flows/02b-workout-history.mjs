// Flow 2b: Workout history and records. A finished and an abandoned workout (seeded) are listed in the history, the
// abandoned one marked as not counted; the finished one's record shows its totals, the muscles it trained, its sets
// (one counted by the camera) and the record it holds, and takes a note; the abandoned one's record trains no muscle
// and can be repeated as a new plan, which opens in its plan preview on Workouts; opening a finished session's live page sends the member to its record.
import { randomUUID } from "node:crypto";
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "02b-workout-history",
  title: "Workout history: list, record with muscles and sets, note, abandoned not counted, repeat, closed-session redirect",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "history", prefs: { workout_location: "gym", fitness_level: "intermediate" } });
    const uid = account.id;
    const done = randomUUID();
    const quit = randomUUID();
    const bench = randomUUID();
    const push = randomUUID();
    const squat = randomUUID();
    await standin.sql(`
      insert into public.workout_sessions (id, user_id, name, status, started_at, completed_at, duration_seconds, total_volume) values
        ('${done}', '${uid}', 'Record check push', 'completed', now() - interval '2 days', now() - interval '2 days' + interval '46 minutes', 2400, 1440),
        ('${quit}', '${uid}', 'Record check legs', 'abandoned', now() - interval '1 day', null, 600, 0);
      insert into public.workout_session_exercises (id, user_id, session_id, exercise_id, exercise_name, sort_order, target_sets, reps_min, reps_max, rest_seconds) values
        ('${bench}', '${uid}', '${done}', 'bench_press', 'Barbell Bench Press', 0, 3, 8, 10, 90),
        ('${push}', '${uid}', '${done}', 'push_up', 'Push-Up', 1, 2, 8, 12, 60),
        ('${squat}', '${uid}', '${quit}', 'bodyweight_squat', 'Bodyweight Squat', 0, 2, 12, 20, 60);
      insert into public.workout_sets (user_id, session_exercise_id, set_number, target_reps, reps, weight_kg, completed_at, rep_source) values
        ('${uid}', '${bench}', 1, 9, 8, 60, now() - interval '2 days' + interval '5 minutes', 'manual'),
        ('${uid}', '${bench}', 2, 9, 8, 60, now() - interval '2 days' + interval '9 minutes', 'manual'),
        ('${uid}', '${bench}', 3, 9, 8, 60, now() - interval '2 days' + interval '13 minutes', 'manual'),
        ('${uid}', '${push}', 1, 10, 12, 0, now() - interval '2 days' + interval '30 minutes', 'camera'),
        ('${uid}', '${push}', 2, 10, null, 0, null, null),
        ('${uid}', '${squat}', 1, 16, 15, 0, now() - interval '1 day' + interval '4 minutes', 'manual'),
        ('${uid}', '${squat}', 2, 16, null, 0, null, null);
      insert into public.personal_records (user_id, exercise_id, exercise_name, best_weight_kg, best_reps, estimated_one_rep_max, session_id, achieved_at)
        values ('${uid}', 'bench_press', 'Barbell Bench Press', 60, 8, 76, '${done}', now() - interval '2 days');
    `);
    await signInUi(t, account);

    await t.step("the history lists finished and abandoned workouts", async () => {
      await t.goto("/workouts/history", { label: "workout history" });
      await page.getByRole("heading", { name: "Workout history", level: 1 }).waitFor({ timeout: 15000 });
      const finished = page.getByRole("link", { name: /Record check push/ });
      const abandoned = page.getByRole("link", { name: /Record check legs/ });
      await finished.waitFor({ timeout: 15000 });
      const finishedText = await textOf(finished);
      const abandonedText = await textOf(abandoned);
      t.note("history rows", { finishedText, abandonedText });
      t.expect(/Chest/.test(finishedText) && /4 sets/.test(finishedText), "the finished row should show its sets and the chest it trained", finishedText);
      t.expect(/Abandoned · not counted/.test(abandonedText), "the abandoned row should say it is not counted", abandonedText);
      t.expect(!/Abandoned/.test(finishedText), "the finished row is not marked abandoned", finishedText);
      await t.checkpoint("workout history");
    });

    await t.step("a finished workout's record: totals, muscles, sets, records and a note", async () => {
      await Promise.all([
        page.waitForURL(`**/workouts/history/${done}`, { timeout: 20000 }),
        page.getByRole("link", { name: /Record check push/ }).click(),
      ]);
      await page.getByRole("heading", { name: "Record check push", level: 1 }).waitFor({ timeout: 15000 });
      const totals = await textOf(page.locator("dl[aria-label='Workout totals']"));
      t.note("totals", totals);
      // The labels are drawn in capitals, so match them case-insensitively.
      t.expect(/sets\s*4\b/i.test(totals) && /total volume\s*1,?440\s*kg/i.test(totals), "totals should come from the logged sets", totals);
      const map = page.getByRole("img", { name: /Muscles trained in this session/ });
      await map.waitFor({ timeout: 10000 });
      t.expect(/chest/i.test((await map.getAttribute("aria-label")) ?? ""), "the body map should name the chest", await map.getAttribute("aria-label"));
      t.expect(await page.getByText("60 kg × 8").first().isVisible(), "the bench press sets should be listed");
      t.expect(await page.getByText("Counted by camera").first().isVisible(), "the camera-counted set should be marked");
      t.expect(await page.getByText("1 planned set wasn’t done.").isVisible(), "the push-up set that was not done should be reported");
      t.expect(await page.getByRole("heading", { name: "Personal records this workout holds" }).isVisible(), "the record it holds should be listed");
      await t.checkpoint("finished workout record");
      const note = page.getByRole("textbox", { name: /How it went/ });
      await note.fill("Felt strong on the last set.");
      await page.getByRole("button", { name: "Save note" }).click();
      await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
      const row = await standin.one(`select notes from public.workout_sessions where id = '${done}'`);
      t.expect(row?.notes === "Felt strong on the last set.", "the note should be saved on the session", row);
    });

    await t.step("an abandoned workout's record is not counted and can be repeated", async () => {
      await t.goto(`/workouts/history/${quit}`, { label: "abandoned record" });
      await page.getByRole("heading", { name: "Record check legs", level: 1 }).waitFor({ timeout: 15000 });
      t.expect(await page.getByText("Abandoned · not counted").first().isVisible(), "the record should say it is not counted");
      t.expect((await page.getByRole("heading", { name: "Muscles trained" }).count()) === 0, "an abandoned workout trains no muscle on the map");
      t.expect(await page.getByText("15 reps").first().isVisible(), "its completed set is kept");
      await t.checkpoint("abandoned workout record");
      await Promise.all([
        page.waitForURL("**/workouts?plan=*", { timeout: 30000 }),
        page.getByRole("button", { name: "Repeat this workout" }).click(),
      ]);
      const planId = new URL(page.url()).searchParams.get("plan");
      const plan = await standin.one(`select p.title, p.status, p.planned_for, string_agg(e.exercise_id, ',' order by e.sort_order) exercises
          from public.workout_plans p join public.workout_plan_exercises e on e.plan_id = p.id where p.id = '${planId}' and p.user_id = '${uid}' group by p.id`);
      t.note("repeated plan", plan);
      t.expect(plan?.title === "Record check legs" && plan.status === "draft" && plan.exercises === "bodyweight_squat", "repeating should save a draft copy of the workout", plan);
      const preview = page.getByRole("dialog", { name: /^Record check legs/ });
      await preview.getByRole("button", { name: "Begin workout" }).waitFor({ timeout: 20000 });
      t.expect((await preview.getByRole("region", { name: /^Exercises/ }).getByRole("listitem").count()) === 1, "the copy's preview should list its one exercise");
      await t.checkpoint("repeated workout in plans");
    });

    await t.step("a finished session's live page opens its record", async () => {
      await page.goto(`/workouts/active?session=${done}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`**/workouts/history/${done}`, { timeout: 20000 });
      await page.getByRole("heading", { name: "Record check push", level: 1 }).waitFor({ timeout: 15000 });
      await t.checkpoint("closed session redirected to its record");
    });
  },
};
