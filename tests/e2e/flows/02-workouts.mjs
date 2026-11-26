// Flow 2: Workouts (the Gym tab; flow 18 covers Home and the setup). Gym equipment edited and saved; a gym programme followed
// (today planned and shown as Today's workout with its exercises), today's day opened from the programme card in
// its plan preview and begun there; a set logged with reps and load, an exercise
// swapped, the session paused and resumed, then finished: history, personal records and today's planner item
// ticked. A gym custom workout with a timed movement runs its set timer. A finished session is repeated from history.
import { hasFocus, kolkataDate, signInUi, textOf } from "./common.mjs";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function currentExercise(page) {
  return (await page.locator("#current-exercise-title").innerText()).trim();
}

/** Fills the first open set of the current exercise (addressed by its labels) and ticks it. */
async function logSet(t, { weight, reps }) {
  const page = t.page;
  const name = await currentExercise(page);
  const number = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button[aria-label='Complete set']")].find((item) => item.offsetParent !== null);
    const input = button?.parentElement?.querySelector("input[aria-label*=' set ']");
    const match = / set (\d+) /.exec(input?.getAttribute("aria-label") ?? "");
    return match ? Number(match[1]) : null;
  });
  t.expect(number !== null, `no open set to log for ${name}`);
  const repsBox = page.getByRole("spinbutton", { name: `${name} set ${number} repetitions`, exact: true });
  const weightBox = page.getByRole("spinbutton", { name: `${name} set ${number} weight in kg`, exact: true });
  if (weight !== undefined && (await weightBox.isEnabled())) await weightBox.fill(String(weight));
  if (reps !== undefined) await repsBox.fill(String(reps));
  const typed = { weight: await weightBox.inputValue(), reps: await repsBox.inputValue() };
  await repsBox.locator("xpath=..").getByRole("button", { name: "Complete set" }).click();
  await repsBox.locator("xpath=..").getByRole("button", { name: "Mark set incomplete" }).waitFor({ timeout: 10000 });
  const skip = page.getByRole("button", { name: "Skip rest" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  return { name, number, typed };
}

export const flow = {
  id: "02-workouts",
  title: "Workouts: equipment, programme day, log, swap, pause, finish, timed set, repeat",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Arjun Das", tag: "workouts", prefs: { workout_location: "both", fitness_level: "intermediate" } });
    const today = kolkataDate();
    const weekday = WEEKDAY[new Date(`${today}T12:00:00+05:30`).getUTCDay()];
    let sessionId = null;
    await signInUi(t, account);

    await t.step("Workouts has Home and Gym tabs; a member who trains at both opens on Gym", async () => {
      await t.goto("/workouts", { label: "workouts" });
      await page.getByRole("heading", { name: "Workouts", level: 1 }).waitFor();
      await page.getByRole("heading", { name: "Gym equipment" }).waitFor();
      const modes = page.getByRole("tablist", { name: "Workout mode" });
      t.expect((await modes.getByRole("tab").count()) === 2, "the Home and Gym tabs are at the top");
      t.expect((await modes.getByRole("tab", { name: "Gym" }).getAttribute("aria-selected")) === "true", "Gym is open for a member who trains at both");
      // The member has a saved home list, so the first-time setup counts as done and stays out of the way.
      t.expect((await page.getByRole("region", { name: "Where do you train?" }).count()) === 0, "no setup for a member with a saved list");
      t.expect((await page.getByRole("heading", { name: "Your home equipment" }).count()) === 0, "home equipment is not on this page");
      await page.getByRole("region", { name: "Today" }).getByText("Nothing planned today").waitFor();
      // Train by area (phase 7.4): anatomy tiles (the body map cropped to each area), each opening the builder; no photos.
      const areas = page.getByRole("group", { name: "Train by area" });
      t.expect((await areas.getByRole("button").count()) >= 8, "every body area should be offered");
      const tiles = await areas.evaluate((group) => [...group.querySelectorAll("button")].map((button) => ({
        area: button.getAttribute("data-focus-area"), popup: button.getAttribute("aria-haspopup"), map: Boolean(button.querySelector("svg")), photo: Boolean(button.querySelector("img")),
      })));
      t.expect(tiles.every((tile) => tile.area && tile.popup === "dialog" && tile.map && !tile.photo), "each area tile is an anatomy tile that opens the builder", tiles);
      // The Programme heading only ever stands over programmes (it goes when none is published).
      const programmeHeading = await page.getByRole("heading", { name: "Programme", exact: true }).count();
      const programmeCards = await page.locator("#programme article").count();
      t.expect(programmeHeading === 0 || programmeCards > 0, "no Programme heading with nothing under it", { programmeHeading, programmeCards });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      t.expect(sideways <= 0, "the page should not scroll sideways", { sideways });
      await t.checkpoint("workouts gym page");
    });

    await t.step("edit and save the gym equipment list", async () => {
      await page.getByRole("button", { name: "Edit equipment" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      const kettlebell = sheet.getByRole("button", { name: "Kettlebell", exact: true });
      if ((await kettlebell.getAttribute("aria-pressed")) !== "true") await kettlebell.click();
      await t.checkpoint("equipment editor", { fullPage: false });
      await sheet.getByRole("button", { name: "Save list" }).click();
      await sheet.waitFor({ state: "detached", timeout: 10000 });
      // What saving did is said on the list's own card, beside Edit equipment (D6); no programme is followed yet.
      await page.getByRole("region", { name: "Gym equipment" }).getByRole("status").filter({ hasText: "List saved." }).waitFor({ timeout: 10000 });
      const row = await standin.one(`select equipment_keys::text keys from public.user_equipment_profiles where user_id = '${account.id}' and context = 'gym'`);
      t.expect(/kettlebell/.test(row?.keys ?? ""), "the saved gym list should include the kettlebell", row);
    });

    await t.step("follow a gym programme with today as a training day", async () => {
      const follow = page.getByRole("button", { name: "Follow", exact: true }).first();
      await follow.waitFor({ timeout: 15000 });
      await follow.click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      const day = sheet.getByRole("button", { name: weekday, exact: true });
      if ((await day.getAttribute("aria-pressed")) !== "true") await day.click();
      await t.checkpoint("follow programme sheet", { fullPage: false });
      await sheet.getByRole("button", { name: "Start programme" }).click();
      await sheet.waitFor({ state: "detached", timeout: 20000 });
      const card = page.getByRole("region", { name: "Your programme" });
      await card.waitFor({ timeout: 15000 });
      // What following planned is said on the new programme card, where the Follow sheet closed (D6).
      await card.getByRole("status").filter({ hasText: /^Planned \d+ workouts? for the next 7 days\./ }).waitFor({ timeout: 15000 });
      const text = await textOf(card);
      t.note("programme card", text);
      t.expect(/Today/.test(text), "today should be one of the planned programme days", text);
      const planned = await standin.sql(`select p.id, p.planned_for::text, p.title, e.id event_id, e.status from public.workout_plans p
          left join public.planner_events e on e.workout_plan_id = p.id where p.user_id = '${account.id}' order by p.planned_for`);
      t.note("planned programme days", planned);
      t.expect(planned.some((row) => row.planned_for === today && row.event_id && row.status === "scheduled"), "today's programme day should be on the planner", planned);
      // Today's workout leads the page: the programme day, each exercise as a row with sets × reps.
      const todayCard = page.getByRole("region", { name: "Today" });
      const rows = todayCard.getByRole("list", { name: /^Exercises in / }).getByRole("listitem");
      await rows.first().waitFor({ timeout: 15000 });
      const todayText = await textOf(todayCard);
      t.note("today card", todayText.slice(0, 300));
      t.expect(/Day \d+ of \d+/i.test(todayText) && /×/.test(todayText), "Today should show the programme day and its sets", todayText.slice(0, 300));
      t.expect(await todayCard.getByRole("button", { name: "Start workout" }).isEnabled(), "Today's workout can be started");
      // Compact (phase 7.4): at most four exercises on the card, the rest under "and N more" (the preview lists them all).
      t.expect((await rows.count()) <= 4, "Today lists at most four exercises", { rows: await rows.count() });
      // The programme card: a ring of sessions done, and one visible action besides the journey link.
      t.expect((await card.getByRole("img", { name: /^Sessions done: 0 of \d+, completed workouts only$/ }).count()) === 1, "the card shows sessions done as a ring with its meaning");
      for (const gone of ["Leave programme", "Plan the next 7 days"]) t.expect((await card.getByRole("button", { name: gone }).count()) === 0, `${gone} sits in the card's menu`);
      await t.checkpoint("programme followed");
    });

    await t.step("start today's programme day", async () => {
      const card = page.getByRole("region", { name: "Your programme" });
      await card.getByRole("button", { name: /^Start/ }).first().click();
      // Every plan opens in its preview first: the exercises in order, then Begin workout.
      const preview = page.getByRole("dialog");
      const begin = preview.getByRole("button", { name: "Begin workout" });
      await begin.waitFor({ timeout: 20000 });
      const exercises = await preview.getByRole("region", { name: /^Exercises/ }).getByRole("listitem").count();
      t.expect(exercises > 0, "the preview should list the day's exercises", { exercises });
      await t.checkpoint("plan preview", { fullPage: false });
      await Promise.all([
        page.waitForURL("**/workouts/active?session=*", { timeout: 30000 }),
        begin.click(),
      ]);
      sessionId = new URL(page.url()).searchParams.get("session");
      await page.locator("#current-exercise-title").waitFor({ timeout: 20000 });
      await t.checkpoint("active session");
    });

    await t.step("log a set with load and reps", async () => {
      const logged = await logSet(t, { weight: 12.5, reps: 10 });
      const sets = await standin.sql(`select exercise_name, set_number, weight_kg::text, reps from public.workout_sets s
          join public.workout_session_exercises x on x.id = s.session_exercise_id where x.session_id = '${sessionId}' and s.completed_at is not null`);
      t.note("logged", { logged, sets });
      t.expect(sets.length === 1 && Number(sets[0].reps) === 10 && Number(sets[0].set_number) === logged.number, "the completed set should be saved with the reps typed", sets);
      if (logged.typed.weight) t.expect(Number(sets[0].weight_kg) === Number(logged.typed.weight), "the load typed should be saved", sets);
    });

    await t.step("swap the next exercise", async () => {
      await page.getByRole("button", { name: "Next exercise" }).first().click();
      const before = await currentExercise(page);
      await page.getByRole("button", { name: "Swap", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor({ timeout: 10000 });
      await t.checkpoint("swap sheet", { fullPage: false });
      const options = sheet.getByRole("button").filter({ hasText: "Same muscles" });
      t.expect((await options.count()) > 0, "the swap sheet should offer alternatives");
      await options.first().click();
      await sheet.waitFor({ state: "detached", timeout: 15000 });
      await page.waitForFunction((old) => document.querySelector("#current-exercise-title")?.textContent?.trim() !== old, before, { timeout: 15000 });
      const after = await currentExercise(page);
      t.note("swapped", { before, after });
      const stored = await standin.sql(`select exercise_name from public.workout_session_exercises where session_id = '${sessionId}' order by sort_order`);
      t.expect(stored.some((row) => row.exercise_name === after) && !stored.some((row) => row.exercise_name === before), "the swap should be saved to the session", stored);
      await logSet(t, { weight: 8, reps: 12 });
    });

    await t.step("pause and resume the session", async () => {
      await page.getByRole("button", { name: "Pause session" }).click();
      await page.getByText("Session paused").waitFor({ timeout: 10000 });
      // The clock's button stays focusable while it saves and keeps the focus as it turns into Resume (bug 84).
      t.expect(await hasFocus(page.getByRole("button", { name: "Resume", exact: true })), "after Pause session, the focus stays on the clock's button, now Resume");
      const paused = await standin.one(`select paused_at is not null paused from public.workout_sessions where id = '${sessionId}'`);
      t.expect(paused?.paused === "t", "the pause should be saved", paused);
      const clock = await page.locator("section").filter({ hasText: "Elapsed training time" }).first().innerText();
      await page.waitForTimeout(2200);
      const clockLater = await page.locator("section").filter({ hasText: "Elapsed training time" }).first().innerText();
      t.expect(clock === clockLater, `the training clock should hold while paused (${clock} vs ${clockLater})`);
      await t.checkpoint("session paused", { fullPage: false });
      await page.getByRole("button", { name: "Resume workout" }).click();
      await page.getByText("Session paused").waitFor({ state: "detached", timeout: 10000 });
      // The banner and its button go: the focus moves to the clock's button, Pause session again (bug 84).
      t.expect(await hasFocus(page.getByRole("button", { name: "Pause session" })), "after Resume workout, the focus is on Pause session");
    });

    await t.step("finish: history, records and the planner item ticked", async () => {
      await page.getByRole("button", { name: "Finish workout" }).click();
      await page.getByRole("heading", { name: "Workout complete" }).waitFor({ timeout: 30000 });
      await t.checkpoint("workout complete");
      const row = await standin.one(`select s.status, s.duration_seconds, s.total_volume::text,
          (select count(*) from public.personal_records r where r.user_id = s.user_id)::int records,
          (select string_agg(e.status, ',') from public.planner_events e join public.workout_plans p on p.id = e.workout_plan_id where p.id = s.plan_id) planner
        from public.workout_sessions s where s.id = '${sessionId}'`);
      t.note("finished session", row);
      t.expect(row?.status === "completed", "the session should be completed", row);
      t.expect(Number(row.records) >= 1, "personal records should be written", row);
      t.expect(/completed/.test(row.planner ?? ""), "today's planner item should be ticked", row);
      await t.goto("/workouts", { label: "workouts after finishing" });
      const history = page.getByRole("region", { name: "History" });
      t.expect((await history.getByRole("button", { name: /^Repeat / }).count()) >= 1, "the finished session should be in Recent history");
      await t.checkpoint("history after finishing");
    });

    await t.step("a gym custom workout with a timed set", async () => {
      await page.getByRole("button", { name: "New workout" }).click();
      await page.getByRole("dialog", { name: "Build by body area" }).getByRole("group", { name: "Start from" }).getByRole("button", { name: "Blank" }).click();
      const search = page.getByRole("textbox", { name: "Search exercises to add" });
      await search.fill("plank");
      const plank = page.locator("label").filter({ has: page.locator("input[type=checkbox]") }).filter({ hasText: /^Plank$|Plank/ }).first();
      await plank.click();
      // The builder holds only this exercise. Match its fields by the end of their names: the picker label's text now
      // starts with the thumbnail's "AI" tag, so it no longer gives the exercise's name. Waiting for the fields makes the
      // 5 s, 1 set plan apply every time (with the 30 s default the set timer raced this step's waits).
      const seconds = page.getByRole("spinbutton", { name: /target duration in seconds$/ }).first();
      await seconds.waitFor({ timeout: 10000 });
      await seconds.fill("5");
      const sets = page.getByRole("spinbutton", { name: /target sets$/ }).first();
      await sets.waitFor({ timeout: 10000 });
      await sets.fill("1");
      await t.checkpoint("custom workout builder");
      await Promise.all([
        page.waitForURL("**/workouts/active?session=*", { timeout: 30000 }),
        page.getByRole("button", { name: "Save and start" }).click(),
      ]);
      await page.locator("#current-exercise-title").waitFor({ timeout: 20000 });
      const start = page.getByRole("button", { name: "Start timer" });
      t.expect(await start.isVisible(), "a timed movement should offer a set timer");
      await start.click();
      await page.getByRole("timer").first().waitFor({ timeout: 5000 });
      await t.checkpoint("set timer running", { fullPage: false });
      await page.getByRole("button", { name: "Start timer" }).waitFor({ timeout: 15000 }).catch(() => undefined);
      const duration = page.getByRole("spinbutton", { name: /duration in seconds/ }).first();
      await page.waitForFunction(() => {
        const box = [...document.querySelectorAll("input[aria-label*='duration in seconds']")][0];
        return box && Number(box.value) > 0;
      }, null, { timeout: 15000 });
      t.note("timed set seconds", await duration.inputValue());
      await page.getByRole("button", { name: "Complete set" }).first().click();
      await page.getByRole("button", { name: "Mark set incomplete" }).first().waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Finish workout" }).click();
      await page.getByRole("heading", { name: "Workout complete" }).waitFor({ timeout: 30000 });
      const timed = await standin.one(`select s.duration_seconds from public.workout_sets s join public.workout_session_exercises x on x.id = s.session_exercise_id join public.workout_sessions w on w.id = x.session_id
          where w.user_id = '${account.id}' and s.duration_seconds is not null order by s.completed_at desc limit 1`);
      t.note("stored timed set", timed);
      t.expect(Number(timed?.duration_seconds) > 0, "the timed set's seconds should be saved", timed);
    });

    await t.step("repeat a finished workout from history", async () => {
      await t.goto("/workouts", { label: "repeat from history" });
      const before = await standin.one(`select count(*)::int n from public.workout_sessions where user_id = '${account.id}'`);
      await page.getByRole("button", { name: /^Repeat / }).first().click();
      await page.getByRole("button", { name: "Save and start" }).waitFor({ timeout: 15000 });
      await t.checkpoint("repeat opens the builder", { fullPage: false });
      await Promise.all([
        page.waitForURL("**/workouts/active?session=*", { timeout: 30000 }),
        page.getByRole("button", { name: "Save and start" }).click(),
      ]);
      await page.locator("#current-exercise-title").waitFor({ timeout: 20000 });
      const after = await standin.one(`select count(*)::int n from public.workout_sessions where user_id = '${account.id}'`);
      t.expect(Number(after.n) === Number(before.n) + 1, "repeating should start a new session", { before, after });
      t.dialogAnswer = "accept";
      const repeated = new URL(page.url()).searchParams.get("session");
      await page.getByRole("button", { name: "Abandon" }).click();
      // The abandoned state keeps the page's one h1, "Workout", over its own h2 (bug 94).
      await page.getByRole("heading", { level: 2, name: "Workout abandoned" }).waitFor({ timeout: 15000 });
      const h1s = (await page.getByRole("heading", { level: 1 }).allInnerTexts()).map((text) => text.trim());
      t.expect(h1s.length === 1 && h1s[0] === "Workout", "the abandoned workout's page has one h1, Workout", h1s);
      const row = await standin.one(`select status from public.workout_sessions where id = '${repeated}'`);
      t.expect(row?.status === "abandoned", "abandoning should mark the repeated session abandoned", row);
    });

    await t.step("personal records show on Progress", async () => {
      await t.goto("/progress", { label: "progress" });
      const records = await standin.sql(`select exercise_name, best_weight_kg::text, best_reps from public.personal_records where user_id = '${account.id}'`);
      t.note("personal records", records);
      const text = await textOf(page.locator("main"));
      t.expect(records.some((record) => text.includes(record.exercise_name)), "Progress should list a personal record", text.slice(0, 600));
      await t.checkpoint("progress with records");
    });
  },
};
