// Flow 13: the connected experience. A member with a finished workout, an abandoned one, a run and food with an
// unknown protein value opens Home: the Today ring leads and says what its totals leave out; Today's plan and
// Muscles this week, added in Customise, count the run and only the finished workout's muscles. Progress shows this week (with no comparison in the member's first week),
// Focus next and the trends, and a measurement logged there in pounds is saved in kg and becomes the profile weight; /progress/muscles lists the share of the work, and choosing a muscle shows the
// workout behind it with a link to its record. Nothing is counted from the abandoned workout.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "13-connected-home",
  title: "Connected Home and Progress: today's plan, muscles from logged sets, trends and focus next",
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
      insert into public.activities (user_id, client_id, sport, title, started_at, ended_at, elapsed_seconds, moving_seconds, distance_m)
        values (${user}, gen_random_uuid(), 'run', 'Morning run', now() - interval '3 hours', now() - interval '150 minutes', 1800, 1740, 5200);
      insert into public.meals (user_id, date, meal, food_name, calories, protein, carbs, fat, nutrition_snapshot)
        values (${user}, (now() at time zone 'Asia/Kolkata')::date, 'Breakfast', 'Oats with milk', 380, 14, 60, 8, '{"value_basis":"compiled"}'),
               (${user}, (now() at time zone 'Asia/Kolkata')::date, 'Lunch', 'Packaged wrap', 420, null, null, 12, '{"value_basis":"label","missing":["protein","carbs"]}');`);
    t.note("seeded", { finished: finished?.id });
    await signInUi(t, account);

    await t.step("Today's plan, added in Customise, counts this week's run", async () => {
      await t.goto("/dashboard", { label: "home" });
      const first = await page.locator("[data-widget]").evaluateAll((items) => items.map((item) => item.getAttribute("data-widget")));
      t.expect(first[0] === "today", "the Today ring should lead Home", first);
      t.expect(!first.includes("plan") && !first.includes("muscles"), "a new Home starts minimal", first);
      await page.getByRole("button", { name: "Customise" }).click();
      const sheet = page.getByRole("dialog", { name: "Customise Home" });
      await sheet.getByRole("button", { name: "Add Today's plan to Home" }).click();
      await sheet.getByRole("button", { name: "Add Muscles this week to Home" }).click();
      await sheet.getByText("Saved", { exact: true }).waitFor({ timeout: 15000 });
      await sheet.getByRole("button", { name: "Done" }).click();
      const plan = page.locator("[data-widget=plan]");
      await plan.locator("ol[aria-label^='Workouts and activities']").waitFor({ timeout: 20000 });
      const order = await page.locator("[data-widget]").evaluateAll((items) => items.map((item) => item.getAttribute("data-widget")));
      const text = await textOf(plan);
      t.note("home order and plan", { order, text: text.slice(0, 400) });
      t.expect(order[0] === "today" && order.includes("plan"), "the ring stays first and Today's plan is added", order);
      t.expect(/1 activity, 5\.20 km/.test(text), "the run should count in this week's line", text);
      t.expect(/1 workout\b/.test(text), "only the finished workout counts this week", text);
      await t.checkpoint("home with today's plan");
    });

    await t.step("Muscles this week shows the finished workout's muscles only", async () => {
      const muscles = page.locator("[data-widget=muscles]");
      await muscles.getByText("Chest").first().waitFor({ timeout: 20000 });
      const text = await textOf(muscles);
      t.note("muscles widget", text);
      t.expect(/Chest/.test(text) && /3 direct/.test(text), "bench press sets count for the chest", text);
      t.expect(!/Quadriceps/.test(text), "the abandoned squat sets must not count", text);
    });

    await t.step("Today says which totals leave a food out", async () => {
      const today = page.locator("[data-widget=today]");
      await today.getByText(/kcal/).first().waitFor({ timeout: 15000 });
      const text = await textOf(today);
      t.note("today widget", text);
      t.expect(/1 food has no protein value/.test(text), "the unknown protein should be named, not counted as 0", text);
      t.expect(/Scan barcode/.test(text) && /Log food/.test(text), "the log and scan shortcuts should be there", text);
    }, { soft: true });

    await t.step("Progress shows this week, no comparison in the first week, and links each workout to its record", async () => {
      await t.goto("/progress", { label: "progress" });
      await page.getByRole("heading", { name: "This week so far" }).waitFor({ timeout: 20000 });
      await page.getByText("Workouts a week").first().waitFor({ timeout: 20000 });
      const band = await textOf(page.locator("dl[aria-label='This week so far']"));
      t.note("week band", band);
      t.expect(/workouts\s*1\b/i.test(band), "one workout this week", band);
      t.expect(/distance\s*5\.2/i.test(band), "the run's distance", band);
      // The account was made today: there is no last week to set against, so no "Last week: 0" comparison.
      t.expect(!/Last (week|Monday):/.test(band), "a member in their first week sees no comparison with last week", band);
      t.expect(await page.getByText("Against the same days last week").count() === 0, "no comparison note in the first week");
      const link = await page.locator("a[href^='/workouts/history/']").first().getAttribute("href");
      t.expect(link === `/workouts/history/${finished?.id}`, "the recent workout should open its record", { link });
      t.expect(await page.locator("#focus-next").count() === 1, "Focus next should be on Progress");
      t.expect(await page.getByRole("link", { name: /Muscle map/ }).count() > 0, "Progress links to the muscle map");
      t.expect(await page.getByText("Calories a logged day").count() === 0, "food averages stay on Nutrition, not repeated on Progress");
      await t.checkpoint("progress trends");
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
