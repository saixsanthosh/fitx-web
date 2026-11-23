// Flow 13: Workout planning. A gym workout is built by body area (the page's Chest tile opens the builder, Arms is
// added there, an Abs exercise from the paged picker) and saved; it leads the page as Today's workout; its plan preview shows the summary, what it needs and each exercise, and an exercise opens
// its details there. A gym programme is followed with today as a training day: the programme card's day strip, the
// whole journey by week (rest days as planned recovery), then pausing (its coming days are removed) and resuming (the
// next week is planned again from today).
import { kolkataDate, signInUi, textOf } from "./common.mjs";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const flow = {
  id: "13-planning",
  title: "Planning: build by body area, plan preview, programme journey, pause and resume",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "planning", prefs: { workout_location: "gym", fitness_level: "intermediate" } });
    const today = kolkataDate();
    const weekday = WEEKDAY[new Date(`${today}T12:00:00+05:30`).getUTCDay()];
    await signInUi(t, account);

    await t.step("build a gym workout by body area", async () => {
      await t.goto("/workouts", { label: "workouts" });
      // The To-Do week view is gone (its address opens Workouts), so Your plans has no "Week" link any more.
      await page.getByRole("heading", { name: "Your plans" }).waitFor({ timeout: 20000 });
      t.expect((await page.getByRole("link", { name: "Week", exact: true }).count()) === 0, "no Week link to the removed week view");
      await page.getByRole("group", { name: "Train by area" }).getByRole("button", { name: /^Chest/ }).click();
      const builder = page.getByRole("dialog", { name: "Build by body area" });
      await builder.waitFor();
      await builder.getByText("Training: Chest").waitFor();
      await builder.getByRole("button", { name: "Change areas" }).click();
      const tiles = builder.getByRole("group", { name: "Body areas to train" });
      await tiles.getByRole("button", { name: /^Arms/ }).click();
      t.expect((await tiles.getByRole("button", { name: /^Chest/ }).getAttribute("aria-pressed")) === "true", "the Chest tile should be selected");
      const sets = builder.getByRole("spinbutton", { name: / target sets$/ });
      await sets.first().waitFor({ timeout: 10000 });
      const generated = await sets.count();
      t.expect(generated >= 3, "choosing areas should generate a workout", { generated });
      await t.checkpoint("built by body area", { fullPage: false });
      // Add an abs exercise to the generated workout from the picker, filtered by area.
      await builder.getByRole("group", { name: "Body area", exact: true }).getByRole("button", { name: "Abs", exact: true }).click();
      const results = builder.getByRole("list", { name: "Exercises to add" });
      await results.locator("label").filter({ has: page.locator("input[type=checkbox]:not(:checked)") }).first().click();
      await page.waitForFunction((count) => document.querySelectorAll("input[aria-label$=' target sets']").length === count + 1, generated, { timeout: 10000 });
      await builder.getByRole("button", { name: "Save workout" }).click();
      await builder.waitFor({ state: "detached", timeout: 20000 });
      const plan = await standin.one(`select p.title, count(e.*)::int exercises from public.workout_plans p join public.workout_plan_exercises e on e.plan_id = p.id
          where p.user_id = '${account.id}' group by p.id, p.title order by p.created_at desc limit 1`);
      t.note("saved plan", plan);
      t.expect(plan?.title?.startsWith("Chest and arms") && Number(plan.exercises) === generated + 1, "the plan should be saved with the added exercise", plan);
    });

    await t.step("today's workout card, then the plan preview: summary, equipment, exercises and an exercise's details", async () => {
      const todayCard = page.getByRole("region", { name: "Today" });
      await todayCard.getByRole("heading", { name: /^Chest and arms/ }).waitFor({ timeout: 15000 });
      const todayRows = todayCard.getByRole("list", { name: /^Exercises in / }).getByRole("listitem");
      await todayRows.first().waitFor({ timeout: 15000 });
      t.expect((await todayRows.count()) >= 4, "Today should list the plan's exercises", { rows: await todayRows.count() });
      await t.checkpoint("today's workout card");
      const card = page.locator("article[id^='workout-plan-']").filter({ hasText: "Chest and arms" }).first();
      await card.getByRole("button", { name: /^Start/ }).click();
      const preview = page.getByRole("dialog", { name: /^Chest and arms/ });
      await preview.getByRole("button", { name: "Begin workout" }).waitFor({ timeout: 15000 });
      const text = await textOf(preview);
      t.expect(/You’ll need/.test(text) && /estimate/.test(text), "the preview should list what is needed and the time as an estimate", text.slice(0, 400));
      const rows = preview.getByRole("region", { name: /^Exercises/ }).getByRole("listitem");
      t.expect((await rows.count()) >= 4, "the preview should list every exercise in order");
      await t.checkpoint("plan preview", { fullPage: false });
      await rows.first().getByRole("button").click();
      const info = page.getByRole("dialog").filter({ has: page.getByRole("link", { name: "Open full exercise page" }) });
      await info.getByRole("heading", { name: "How to do it" }).waitFor({ timeout: 15000 });
      await t.checkpoint("exercise details from the preview", { fullPage: false });
      await info.getByRole("button", { name: "Back" }).click();
      await info.waitFor({ state: "detached", timeout: 10000 });
      await preview.getByRole("button", { name: "Close", exact: true }).click();
      await preview.waitFor({ state: "detached", timeout: 10000 });
    });

    await t.step("follow a gym programme: the day strip and the whole journey", async () => {
      await page.getByRole("button", { name: "Follow", exact: true }).first().click();
      const sheet = page.getByRole("dialog");
      const day = sheet.getByRole("button", { name: weekday, exact: true });
      if ((await day.getAttribute("aria-pressed")) !== "true") await day.click();
      await sheet.getByRole("button", { name: "Start programme" }).click();
      await sheet.waitFor({ state: "detached", timeout: 20000 });
      const card = page.getByRole("region", { name: "Your programme" });
      await card.waitFor({ timeout: 15000 });
      const selected = await card.getByRole("tab", { selected: true }).getAttribute("aria-label");
      t.expect(/^Today/.test(selected ?? ""), "today should be the chosen day in the strip", { selected });
      t.expect(/plan · \d+ training days? and \d+ rest days?/.test(await textOf(card)), "the card should give the plan's length and its rest days");
      await t.checkpoint("programme card with its day strip");
      await card.getByRole("link", { name: "See the whole programme" }).click();
      await page.waitForURL("**/workouts/programme", { timeout: 15000 });
      await page.getByRole("heading", { name: /^Week 1/ }).waitFor({ timeout: 15000 });
      const rest = page.getByRole("button", { name: /rest day$/ }).first();
      if (await rest.count()) {
        await rest.click();
        await page.getByText("Recovery is part of your plan").first().waitFor({ timeout: 5000 });
      }
      await t.checkpoint("the whole programme by week");
    });

    await t.step("pause and resume the programme", async () => {
      await t.goto("/workouts", { label: "workouts again" });
      const card = page.getByRole("region", { name: "Your programme" });
      await card.waitFor({ timeout: 15000 });
      t.dialogAnswer = "accept";
      await card.getByRole("button", { name: "Pause", exact: true }).click();
      await card.getByRole("button", { name: "Resume programme" }).waitFor({ timeout: 20000 });
      const paused = await standin.one(`select e.status, (select count(*) from public.workout_plans p where p.programme_enrolment_id = e.id and p.planned_for >= '${today}')::int ahead
          from public.programme_enrolments e where e.user_id = '${account.id}' order by e.created_at desc limit 1`);
      t.note("paused", paused);
      t.expect(paused?.status === "paused" && Number(paused.ahead) === 0, "pausing should keep the enrolment and remove its coming days", paused);
      await t.checkpoint("programme paused", { fullPage: false });
      await card.getByRole("button", { name: "Resume programme" }).click();
      await card.getByRole("button", { name: "Pause", exact: true }).waitFor({ timeout: 30000 });
      await page.waitForFunction(() => !document.body.textContent?.includes("Planning your next days"), null, { timeout: 30000 });
      const resumed = await standin.one(`select e.status, (select count(*) from public.workout_plans p where p.programme_enrolment_id = e.id and p.planned_for = '${today}')::int today
          from public.programme_enrolments e where e.user_id = '${account.id}' order by e.created_at desc limit 1`);
      t.note("resumed", resumed);
      t.expect(resumed?.status === "active" && Number(resumed.today) === 1, "resuming should plan today's training day again, once", resumed);
      t.dialogAnswer = "dismiss";
    });
  },
};
