// Flow 13: the connected experience, on Progress (Home keeps only the greeting and the daily quote). A member with a
// finished workout, an abandoned one, a run with a recorded calorie estimate and food with an unknown protein value
// opens Progress: this week counts only the finished workout and the run, calories burned are the run's estimate and
// say so, there is no comparison in the member's first week, the Month and Year filters change the period and the
// charts, each recent workout links to its record, and a measurement logged there in pounds is saved in kg and
// becomes the profile weight; /progress/muscles lists the share of the work, and choosing a muscle shows the
// workout behind it with a link to its record. Nothing is counted from the abandoned workout.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "13-connected-home",
  title: "Connected Progress: this week from logs only, period filters, weigh-in in pounds, muscle analytics",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "connected", profile: { weight: 64, target_weight: 60 } });
    const user = `'${account.id}'`;
    // A finished upper-body workout an hour ago, and an abandoned leg workout (which must never count).
    const finished = await standin.one(`
      with s as (insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds, total_volume)
        values (${user}, 'Upper strength', 'completed', now() - interval '70 minutes', now() - interval '20 minutes', 2700, 1440) returning id),
      e as (insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order)
        select ${user}, s.id, 'bench_press', 'Bench Press', 0 from s returning id)
      insert into public.workout_sets (user_id, session_exercise_id, set_number, reps, weight_kg, completed_at)
        select ${user}, e.id, n, 8, 60, now() - interval '60 minutes' + n * interval '3 minutes' from e, generate_series(1, 3) n
      returning (select id from s)::text as id`);
    await standin.sql(`
      with s as (insert into public.workout_sessions (user_id, name, status, started_at, duration_seconds)
        values (${user}, 'Abandoned legs', 'abandoned', now() - interval '5 hours', 600) returning id),
      e as (insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order)
        select ${user}, s.id, 'barbell_back_squat', 'Barbell Back Squat', 0 from s returning id)
      insert into public.workout_sets (user_id, session_exercise_id, set_number, reps, weight_kg, completed_at)
        select ${user}, e.id, n, 5, 80, now() - interval '290 minutes' from e, generate_series(1, 3) n;
      insert into public.activities (user_id, client_id, sport, title, started_at, ended_at, elapsed_seconds, moving_seconds, distance_m, kcal_estimate)
        values (${user}, gen_random_uuid(), 'run', 'Morning run', now() - interval '3 hours', now() - interval '150 minutes', 1800, 1740, 5200, 320);
      insert into public.meals (user_id, date, meal, food_name, calories, protein, carbs, fat, nutrition_snapshot)
        values (${user}, (now() at time zone 'Asia/Kolkata')::date, 'Breakfast', 'Oats with milk', 380, 14, 60, 8, '{"value_basis":"compiled"}'),
               (${user}, (now() at time zone 'Asia/Kolkata')::date, 'Lunch', 'Packaged wrap', 420, null, null, 12, '{"value_basis":"label","missing":["protein","carbs"]}');`);
    t.note("seeded", { finished: finished?.id });
    await signInUi(t, account);

    await t.step("Progress shows this week from the finished workout and the run, with no comparison in the first week", async () => {
      await t.goto("/progress", { label: "progress" });
      const overview = page.locator("section[aria-labelledby='overview-title']");
      await overview.locator("dl").getByText("Workouts").waitFor({ timeout: 20000 });
      await page.locator("section[aria-labelledby='training-title'] a[href^='/workouts/history/']").first().waitFor({ timeout: 20000 });
      await t.settle(1200);
      const stats = await textOf(overview.locator("dl"));
      t.note("this week", stats);
      t.expect(/Workouts\s*1\b/.test(stats), "one workout this week: the abandoned one does not count", stats);
      t.expect(/Volume\s*1,440\b/.test(stats) && /kg/.test(stats), "the finished workout's 3 x 8 x 60 kg", stats);
      t.expect(/Distance\s*5\.2\b/.test(stats), "the run's distance", stats);
      t.expect(/Burned\s*320\b[^A-Z]*kcal\s*est\./.test(stats) && /From 1 activity/.test(stats), "calories burned only from the run's recorded estimate, labelled", stats);
      // The account was made today: there is no last week to set against, so no "vs last week" (never a drop to 0).
      t.expect(!/vs last week|Same as last week/.test(stats), "a member in their first week sees no comparison with last week", stats);
      const link = await page.locator("section[aria-labelledby='training-title'] a[href^='/workouts/history/']").first().getAttribute("href");
      t.expect(link === `/workouts/history/${finished?.id}`, "the recent workout should open its record", { link });
      t.expect(await page.locator("#focus-next").count() === 1, "Focus next should be on Progress");
      t.expect(await page.getByRole("link", { name: /Muscle map/ }).count() > 0, "Progress links to the muscle map");
      const food = await textOf(page.locator("section[aria-labelledby='food-title']"));
      t.note("nutrition on progress", food.slice(0, 300));
      t.expect(/Calories\s*800\s*kcal a day/.test(food), "today's 380 + 420 kcal, the only logged day", food);
      t.expect(/Protein\s*14\s*g a day/.test(food) && /left out/.test(food), "the wrap's unknown protein is left out, not counted as 0", food);
      await t.checkpoint("progress week");
    });

    await t.step("the Month and Year filters change the period and the charts", async () => {
      const label = page.locator("[class*='periodLabel']");
      const before = (await label.innerText()).trim();
      await page.getByRole("radiogroup", { name: "Period" }).getByText("Month", { exact: true }).click();
      await page.waitForFunction(() => /\d{4}$/.test(document.querySelector("[class*='periodLabel']")?.textContent?.trim() ?? ""), null, { timeout: 15000 });
      const month = (await label.innerText()).trim();
      const days = await page.locator("ol[aria-label^='Days of'] > li[aria-label]").count();
      await t.checkpoint("progress month");
      await page.getByRole("radiogroup", { name: "Period" }).getByText("Year", { exact: true }).click();
      await page.locator("ol[aria-label^='Active days each month']").waitFor({ timeout: 15000 });
      await t.settle(1200);
      const year = (await label.innerText()).trim();
      const stats = await textOf(page.locator("section[aria-labelledby='overview-title'] dl"));
      t.note("periods", { before, month, year, days, stats });
      t.expect(before === "This week" && /^[A-Z][a-z]+ \d{4}$/.test(month) && /^\d{4}$/.test(year), "the label follows the period", { before, month, year });
      t.expect(days >= 28 && days <= 31, "the month calendar has a ring for every day", days);
      t.expect(/Workouts\s*1\b/.test(stats), "the year still counts the one finished workout", stats);
      await page.getByRole("button", { name: "Previous year" }).click();
      await page.waitForFunction((current) => document.querySelector("[class*='periodLabel']")?.textContent?.trim() === String(Number(current) - 1), year, { timeout: 15000 });
      await t.settle(1200);
      const last = await textOf(page.locator("section[aria-labelledby='overview-title'] dl"));
      t.expect(/Workouts\s*0\b/.test(last), "last year, before the account, has no workouts", last);
      await t.checkpoint("progress year");
      await page.getByRole("radiogroup", { name: "Period" }).getByText("Week", { exact: true }).click();
    });

    await t.step("Log measurement: a weigh-in in pounds and a waist size, saved in kg and made the profile weight", async () => {
      await standin.sql(`update public.user_preferences set weight_unit = 'lb' where user_id = ${user}`);
      await t.goto("/progress", { label: "progress in lb" });
      const body = page.locator("section[aria-labelledby='body-title']");
      const open = body.getByRole("button", { name: "Log measurement" });
      await open.waitFor({ timeout: 20000 });
      await body.getByText(/\blb\b/).first().waitFor({ timeout: 20000 });
      await open.click();
      const sheet = page.getByRole("dialog", { name: "Log measurement" });
      await sheet.waitFor({ timeout: 10000 });
      await sheet.getByLabel("Weight (lb)").fill("140");
      await sheet.getByLabel("Measurement", { exact: true }).selectOption("waist");
      await sheet.getByLabel("Size (cm)").fill("81.5");
      await t.checkpoint("log measurement sheet");
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await sheet.waitFor({ state: "hidden", timeout: 15000 });
      await page.waitForFunction(() => document.activeElement?.textContent?.includes("Log measurement"), null, { timeout: 5000 }).catch(() => undefined);
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      t.expect(/Log measurement/.test(focused), "focus returns to Log measurement when the sheet closes", { focused });
      const saved = await standin.one(`select b.weight::text weight, b.measurements->>'waist' waist, p.weight::text profile_weight,
          (select count(*) from public.body_metrics x where x.user_id = p.id)::int rows
        from public.profiles p join public.body_metrics b on b.user_id = p.id
        where p.id = ${user} and b.note is distinct from 'Starting weight' order by b.created_at desc limit 1`);
      t.note("saved measurement", saved);
      t.expect(Number(saved?.weight) === 63.5, "140 lb is saved as 63.5 kg", saved);
      t.expect(Number(saved?.waist) === 81.5, "the waist size is saved in cm", saved);
      t.expect(Number(saved?.profile_weight) === 63.5, "the weigh-in becomes the profile weight", saved);
      t.expect(Number(saved?.rows) === 2, "one new row next to the starting weigh-in", saved);
      await body.getByText("140.0").first().waitFor({ timeout: 15000 });
      const text = await textOf(body);
      t.note("body section", text.slice(0, 400));
      t.expect(/140\.0\s*lb/.test(text), "the latest weight shows in pounds", text);
      t.expect(/Waist\s*81\.5 cm/i.test(text), "the waist size is listed", text);
      t.expect(!/profile weight didn't update/.test(text), "no profile-weight notice when the profile copy saved", text);
      await t.checkpoint("progress after logging");
    });

    await t.step("Muscle analytics: share of the work, and the workout behind a muscle", async () => {
      await t.goto("/progress/muscles?period=week", { label: "muscles" });
      const chest = page.getByRole("button", { name: /^Chest/ }).last();
      await chest.waitFor({ timeout: 20000 });
      await chest.click();
      await page.getByRole("heading", { name: "Chest", level: 2 }).waitFor({ timeout: 15000 });
      const main = await textOf(page.locator("main"));
      const row = await textOf(chest);
      t.note("chest row", row);
      t.expect(/50%/.test(row) && /3 direct sets/.test(row), "bench press: the chest has half the work (its shoulders and triceps share the rest)", row);
      t.expect(!/Abandoned legs/.test(main), "the abandoned workout must not appear", main.slice(0, 600));
      const record = await page.locator(`a[href='/workouts/history/${finished?.id}']`).count();
      t.expect(record > 0, "the chest's workout should link to its record");
      t.expect(new URL(page.url()).searchParams.get("muscle") === "chest", "the choice should be kept in the address", page.url());
      await t.checkpoint("muscle analytics");
    });
  },
};
