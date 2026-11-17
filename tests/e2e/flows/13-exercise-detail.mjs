// Flow 13: an exercise's page (/exercises/[id]). The Guide shows the photos as a numbered sequence, the catalogue's
// steps and a Report link that carries the exercise; a private note is saved, survives a reload and is removed;
// Muscles shows the body map, links each muscle to Browse by muscle and offers alternatives; History and Progress
// start empty, then show a completed session's sets, best set and estimated one-rep max (labelled as an estimate);
// the open tab is kept in ?tab=. A workout the member abandoned never shows.
import { signInUi, textOf } from "./common.mjs";

const EXERCISE = "bench_press";
const NOTE = "Seat on 4, pin at 7";

export const flow = {
  id: "13-exercise-detail",
  title: "Exercise page: guide, note, muscles, history and progress",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "exercise", prefs: { workout_location: "gym", fitness_level: "intermediate" } });
    await signInUi(t, account);
    const tab = (name) => page.getByRole("tab", { name, exact: true });

    await t.step("the Guide: name, details, photos in order, steps and the report link", async () => {
      await t.goto(`/exercises/${EXERCISE}`, { label: "exercise guide" });
      await page.getByRole("heading", { level: 1, name: "Barbell Bench Press" }).waitFor({ timeout: 20000 });
      t.expect((await tab("Guide").getAttribute("aria-selected")) === "true", "the Guide tab is open first");
      const about = await textOf(page.getByRole("list", { name: "About this exercise" }));
      t.expect(/Strength/.test(about) && /Compound/.test(about) && /Barbell and plates/.test(about), `the header names category, mechanic and equipment: ${about}`);
      const steps = page.locator("#exercise-steps > li");
      t.expect((await steps.count()) === 3, `the starter's three steps are listed (got ${await steps.count()})`);
      const report = page.getByRole("link", { name: "Report a problem with this exercise" });
      t.expect((await report.getAttribute("href")) === `/help?from=%2Fexercises%2F${EXERCISE}`, "Report a problem opens Help with this exercise");
      t.expect((await page.getByText(/Starting position|End position/).count()) === 0, "no photo is labelled as a start or end position");
      await t.checkpoint("exercise guide");
    });

    await t.step("a private note is saved, kept after a reload, and removed", async () => {
      await page.getByRole("button", { name: /Add a note/ }).click();
      await page.getByRole("textbox", { name: /Your note on/ }).fill(NOTE);
      await page.getByRole("button", { name: "Save note" }).click();
      await page.getByText("Note saved. Only you can see it.").waitFor({ timeout: 15000 });
      const stored = await standin.one(`select body from public.exercise_notes where user_id = '${account.id}' and exercise_id = '${EXERCISE}'`);
      t.expect(stored?.body === NOTE, "the note is stored for this member and exercise", stored);
      await t.goto(`/exercises/${EXERCISE}`, { label: "exercise guide after reload" });
      await page.getByText(NOTE).waitFor({ timeout: 20000 });
      await t.checkpoint("note kept");
      await page.getByRole("button", { name: /Edit your note/ }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete note" }).click();
      await page.getByText("Note removed.").waitFor({ timeout: 15000 });
      const left = await standin.one(`select count(*)::int n from public.exercise_notes where user_id = '${account.id}'`);
      t.expect(Number(left?.n) === 0, "the note is deleted", left);
    });

    await t.step("Muscles: the body map, muscle links and alternatives; the tab is kept in the address", async () => {
      await tab("Muscles").click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("tab") === "muscles", null, { timeout: 5000 });
      const map = await page.locator("[role=img][aria-label^='Muscles Barbell Bench Press works']").getAttribute("aria-label");
      t.expect(/Primary: chest/.test(map ?? ""), `the map names the primary muscle: ${map}`);
      t.expect((await page.locator("a[href='/exercises/muscles?muscle=chest']").count()) > 0, "the chest links to Browse by muscle");
      await page.getByRole("heading", { name: "Alternatives" }).waitFor();
      await page.getByRole("heading", { name: "Other equipment" }).waitFor({ timeout: 20000 });
      await t.checkpoint("exercise muscles");
    });

    await t.step("History and Progress start empty", async () => {
      await tab("History").click();
      await page.getByText("No sessions yet").waitFor({ timeout: 20000 });
      await tab("Progress").click();
      await page.getByText("No progress yet").waitFor({ timeout: 20000 });
      await t.checkpoint("exercise progress empty");
    });

    await t.step("a completed session shows its sets, best set and estimate; an abandoned one never does", async () => {
      await standin.sql(`
        with done as (insert into public.workout_sessions (user_id, name, status, started_at, completed_at)
            values ('${account.id}', 'Push day', 'completed', now() - interval '2 days', now() - interval '2 days' + interval '50 minutes') returning id),
          row as (insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order)
            select '${account.id}', id, '${EXERCISE}', 'Barbell Bench Press', 0 from done returning id)
        insert into public.workout_sets (user_id, session_exercise_id, set_number, reps, weight_kg, completed_at)
          select '${account.id}', row.id, n, 8, 60 + (n - 1) * 2.5, now() - interval '2 days' from row, generate_series(1, 3) n;
        with dropped as (insert into public.workout_sessions (user_id, name, status, started_at)
            values ('${account.id}', 'Abandoned push', 'abandoned', now() - interval '1 day') returning id),
          row as (insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order)
            select '${account.id}', id, '${EXERCISE}', 'Barbell Bench Press', 0 from dropped returning id)
        insert into public.workout_sets (user_id, session_exercise_id, set_number, reps, weight_kg, completed_at)
          select '${account.id}', row.id, 1, 5, 100, now() - interval '1 day' from row;`);
      await t.goto(`/exercises/${EXERCISE}?tab=history`, { label: "exercise history" });
      await page.getByRole("heading", { name: "Your sessions" }).waitFor({ timeout: 20000 });
      const history = await textOf(page.locator("section[aria-labelledby=exercise-history-heading]"));
      t.note("history", history.slice(0, 600));
      t.expect(/65 kg × 8/.test(history) && /Top set/.test(history), "the session's sets and top set are listed");
      t.expect(!/100 kg/.test(history) && !/Abandoned push/.test(history), "the abandoned workout is not listed");
      await t.checkpoint("exercise history");
      await tab("Progress").click();
      await page.getByRole("heading", { name: "Your progress" }).waitFor({ timeout: 20000 });
      const progress = await textOf(page.locator("section[aria-labelledby=exercise-progress-heading]"));
      t.note("progress", progress.slice(0, 600));
      t.expect(/Best set\s*65 kg × 8/.test(progress), "the best set is the heaviest completed set");
      t.expect(/Estimate/i.test(progress) && /not a tested max/.test(progress), "the one-rep max is labelled as an estimate");
      await t.checkpoint("exercise progress");
    });
  },
};
