// Flow 13: Workout planning. A gym workout is built by body area (the page's Chest anatomy tile opens the builder, Arms
// is added there on the builder's anatomy tiles, an Abs exercise from the paged picker) and saved; it leads the page as
// Today's workout; its compact plan row has Start and a menu (Edit, Duplicate, Delete; keyboard and Escape); its plan
// preview shows the summary, what it needs and each exercise, and an exercise opens its details there. A gym programme is followed with today as a training day: the programme card's day strip, the
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
      // The builder's areas are anatomy tiles (phase 7.4): the body map cropped to each area, with a real count, no photos.
      const art = await tiles.evaluate((group) => [...group.querySelectorAll("button")].map((button) => ({ map: Boolean(button.querySelector("svg")), photo: Boolean(button.querySelector("img")), text: button.textContent ?? "" })));
      t.expect(art.length >= 8 && art.every((tile) => tile.map && !tile.photo), "the builder offers every area as an anatomy tile", art);
      t.expect(art.every((tile) => /\d[\d,]* you can do$/.test(tile.text)), "each tile says how many exercises fit the equipment", art.map((tile) => tile.text));
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
      // Each plan once in Your plans: a dated plan's planner item joins its row (with today's Start keeping the item),
      // so the "Scheduled" list above the rows never repeats it.
      const event = await standin.one(`select count(*)::int n from public.planner_events e join public.workout_plans p on p.id = e.workout_plan_id
          where p.user_id = '${account.id}' and p.title like 'Chest and arms%' and e.status = 'scheduled'`);
      t.note("the plan's scheduled planner items", event);
      const yourPlans = page.locator("section#plans");
      await yourPlans.locator("article[id^='workout-plan-']").first().waitFor({ timeout: 15000 });
      t.expect((await yourPlans.locator("li").filter({ hasText: "Chest and arms" }).count()) === 0, "Your plans does not list the plan again under Scheduled");
      t.expect((await yourPlans.locator("article[id^='workout-plan-']").filter({ hasText: "Chest and arms" }).count()) === 1, "the plan has one row");
      // A plan is one compact row (phase 7.4): its name and day, Start, and a menu with Edit, Duplicate and Delete.
      const box = await card.boundingBox();
      t.expect(box && box.height <= 80, "a plan row stays on one line", box);
      const more = card.getByRole("button", { name: /^More actions for Chest and arms/ });
      t.expect((await more.getAttribute("aria-haspopup")) === "menu" && (await more.getAttribute("aria-expanded")) === "false", "the row's menu button says what it opens");
      await more.click();
      const menu = card.getByRole("menu");
      await menu.waitFor();
      const items = await menu.getByRole("menuitem").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent));
      t.expect(items.length === 3 && /^Edit Chest and arms/.test(items[0]) && /^Duplicate /.test(items[1]) && /^Delete /.test(items[2]), "the menu offers Edit, Duplicate and Delete for the plan", items);
      t.expect(await page.evaluate(() => document.activeElement?.getAttribute("role") === "menuitem"), "opening the menu moves focus into it");
      await page.keyboard.press("ArrowDown");
      t.expect(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("Duplicate")), "arrow keys move through the menu");
      await t.checkpoint("plan row menu", { fullPage: false });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached", timeout: 5000 });
      t.expect(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("More actions for")), "Escape closes the menu and returns focus to its button");
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
      // Compact (phase 7.4): leaving and planning ahead sit in the card's menu, not as buttons of their own.
      t.expect((await card.getByRole("button", { name: "Leave programme" }).count()) === 0, "Leave programme is not a button on the card");
      await card.getByRole("button", { name: "More programme actions" }).click();
      await card.getByRole("menu").getByRole("menuitem", { name: "Leave programme" }).waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await card.getByRole("menu").waitFor({ state: "detached", timeout: 5000 });
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
