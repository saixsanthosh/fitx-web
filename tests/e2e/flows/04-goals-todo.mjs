// Flow 4: Goals and To-Do, both on Home. The old Goals addresses land on Home; a daily (protein), a weekly
// (workouts) and a long-term (weight) goal are created there; a To-Do linked to a saved workout is started from
// its Start link and the workout finished, which ticks the To-Do; logged food, the finished workout and a new
// weigh-in move the three goals; the week plan opens from Home, and what is added and ticked there shows on Home's
// To-Do list when it closes; widgets added, moved and hidden in Customise stay
// arranged after a reload.
import { kolkataDate, signInUi } from "./common.mjs";

async function newGoal(t, template, fill) {
  const page = t.page;
  await page.getByRole("button", { name: /^(New goal|Create your first goal)$/ }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: new RegExp(`^${template}`) }).click();
  await fill(sheet);
  await sheet.getByRole("button", { name: "Create goal" }).click();
  await sheet.waitFor({ state: "detached", timeout: 15000 });
}

async function goalProgress(t, title) {
  const bar = t.page.getByRole("progressbar", { name: `Progress for ${title}` });
  await bar.waitFor({ timeout: 15000 });
  return { percent: Number(await bar.getAttribute("aria-valuenow")), text: await bar.getAttribute("aria-valuetext") };
}

export const flow = {
  id: "04-goals-todo",
  title: "Goals and To-Do on Home: goals follow logs, a linked To-Do ticks itself, widgets stay arranged",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Nikhil Rao", tag: "goals", profile: { weight: 72, target_weight: 70 } });
    const today = kolkataDate();
    const plan = await standin.one(`with p as (insert into public.workout_plans (user_id, title, split, workout_location, status)
        values ('${account.id}', 'Evening push-ups', 'custom', 'home', 'draft') returning id)
      insert into public.workout_plan_exercises (user_id, plan_id, exercise_id, exercise_name, sort_order, target_sets, reps_min, reps_max, rest_seconds)
        select '${account.id}', p.id, 'push_up', 'Push-Up', 0, 2, 8, 12, 60 from p returning plan_id`);
    await signInUi(t, account);

    await t.step("the old Goals addresses open the matching place on Home", async () => {
      const landed = {};
      for (const [from, to] of [["/goals", "/dashboard?panel=goals"], ["/goals?tab=today", "/dashboard?panel=todo"], ["/goals?tab=week", "/dashboard?panel=week"], ["/planner", "/dashboard?panel=week"], ["/tasks", "/dashboard?panel=todo"]]) {
        await t.goto(from, { label: `old ${from}` });
        landed[from] = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
        t.expect(landed[from] === to, `${from} should land on ${to}`, landed[from]);
      }
      // ?panel=week opens the week plan over Home.
      await page.goto("/dashboard?panel=week", { waitUntil: "domcontentloaded" });
      const week = page.getByRole("dialog", { name: "Week" });
      await week.getByRole("group", { name: "Choose a day" }).waitFor({ timeout: 15000 });
      await t.checkpoint("week plan from ?panel=week", { fullPage: false });
      await week.getByRole("button", { name: "Close" }).click();
      await week.waitFor({ state: "hidden", timeout: 10000 });
      t.expect(new URL(page.url()).search === "", "closing the week plan leaves Home's plain address", page.url());
      // A template link opens the goal editor on that template, once.
      await t.goto("/goals?tab=goals&new=water_day", { label: "template link" });
      const editor = page.getByRole("dialog", { name: "New goal" });
      await editor.getByLabel(/^Target/).waitFor({ timeout: 15000 });
      t.expect(new URL(page.url()).searchParams.get("new") === null, "the template is used once and dropped from the address", page.url());
      await editor.getByRole("button", { name: "Cancel" }).click();
      t.note("old addresses", landed);
    });

    await t.step("create a daily, a weekly and a long-term goal", async () => {
      await t.goto("/dashboard?panel=goals", { label: "goals on home" });
      await newGoal(t, "Daily protein", async (sheet) => { await sheet.getByLabel(/^Target/).fill("60"); });
      await newGoal(t, "Workouts per week", async (sheet) => { await sheet.getByLabel(/^Target/).fill("3"); });
      await newGoal(t, "Reach a weight", async (sheet) => {
        await sheet.getByLabel(/^Starting weight/).fill("72");
        await sheet.getByLabel(/^Target weight/).fill("70");
      });
      const goals = await standin.sql(`select title, metric, period, target_value::text, baseline_value::text from public.goals where user_id = '${account.id}' order by created_at`);
      t.note("goals created", goals);
      t.expect(goals.some((goal) => goal.metric === "protein_g" && goal.period === "daily"), "a daily protein goal", goals);
      t.expect(goals.some((goal) => goal.metric === "workouts_completed" && goal.period === "weekly"), "a weekly workouts goal", goals);
      t.expect(goals.some((goal) => goal.metric === "body_weight_kg" && goal.period === "long_term"), "a long-term weight goal", goals);
      t.goals = goals;
      await t.checkpoint("three goals");
    });

    await t.step("a To-Do linked to the saved workout gets a Start link", async () => {
      await t.goto("/dashboard?panel=todo", { label: "to-do on home" });
      await page.locator("#home-todo").getByRole("button", { name: "More options" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("What").fill("Evening push-ups");
      await sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Type" }) }).locator("label").filter({ hasText: /^Workout$/ }).click();
      await sheet.getByLabel(/^Saved workout/).selectOption({ label: "Evening push-ups" });
      await sheet.getByRole("textbox", { name: "Day", exact: true }).fill(today);
      await t.checkpoint("to-do linked to a workout", { fullPage: false });
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await sheet.waitFor({ state: "detached", timeout: 15000 });
      const start = page.getByRole("link", { name: "Start Evening push-ups" }).first();
      await start.waitFor({ timeout: 15000 });
      const href = await start.getAttribute("href");
      const event = await standin.one(`select id, workout_plan_id, status, local_date::text from public.planner_events where user_id = '${account.id}' and title = 'Evening push-ups'`);
      t.note("linked To-Do", { href, event });
      t.expect(event?.workout_plan_id === plan.plan_id && href?.includes(`plan=${plan.plan_id}`) && href.includes(`event=${event.id}`), "the Start link should name the plan and the To-Do", { href, event });
      t.eventId = event.id;
    });

    await t.step("starting from the To-Do and finishing the workout ticks the To-Do", async () => {
      await page.getByRole("link", { name: "Start Evening push-ups" }).first().click();
      await page.waitForURL("**/workouts?plan=*", { timeout: 15000 });
      await t.settle();
      // The To-Do's link opens the plan's preview first; Begin workout starts it with the To-Do kept on the session.
      const preview = page.getByRole("dialog", { name: "Evening push-ups" });
      const begin = preview.getByRole("button", { name: "Begin workout" });
      await begin.waitFor({ timeout: 15000 });
      await t.checkpoint("workouts opened from the To-Do: the plan preview");
      await Promise.all([
        page.waitForURL("**/workouts/active?session=*", { timeout: 30000 }),
        begin.click(),
      ]);
      const session = new URL(page.url()).searchParams.get("session");
      const linked = await standin.one(`select planner_event_id from public.workout_sessions where id = '${session}'`);
      t.expect(linked?.planner_event_id === t.eventId, "the session should remember the To-Do it was started from", linked);
      const reps = page.getByRole("spinbutton", { name: "Push-Up set 1 repetitions", exact: true });
      await reps.fill("10");
      await reps.locator("xpath=..").getByRole("button", { name: "Complete set" }).click();
      await reps.locator("xpath=..").getByRole("button", { name: "Mark set incomplete" }).waitFor();
      await page.getByRole("button", { name: "Finish workout" }).click();
      await page.getByRole("heading", { name: "Workout complete" }).waitFor({ timeout: 30000 });
      await t.goto("/dashboard?panel=todo", { label: "to-do after the workout" });
      const box = page.getByRole("checkbox", { name: /^Evening push-ups: / });
      await box.waitFor({ timeout: 15000 });
      t.expect(await box.isChecked(), "the To-Do should be ticked once its workout is finished");
      const event = await standin.one(`select status, completed_at from public.planner_events where id = '${t.eventId}'`);
      t.expect(event?.status === "completed", "the planner item should be completed", event);
      await t.checkpoint("to-do ticked");
    });

    await t.step("an item added and ticked in the week sheet shows on Home's To-Do list once the sheet closes", async () => {
      await t.goto("/dashboard?panel=todo", { label: "week sheet edits" });
      const panel = page.locator("#home-todo");
      await panel.getByRole("checkbox", { name: /^Evening push-ups: / }).waitFor({ timeout: 15000 });
      await panel.getByRole("button", { name: "Week" }).click();
      const week = page.getByRole("dialog", { name: "Week" });
      await week.getByRole("group", { name: "Choose a day" }).waitFor({ timeout: 15000 });
      await week.getByRole("button", { name: /^Add to / }).click();
      const editor = page.getByRole("dialog", { name: "Add to your day" });
      await editor.getByLabel("What").fill("Evening stretch");
      await editor.getByRole("button", { name: "Add", exact: true }).click();
      await editor.waitFor({ state: "detached", timeout: 15000 });
      const inSheet = week.getByRole("checkbox", { name: /^Evening stretch: / });
      await inSheet.waitFor({ timeout: 15000 });
      await inSheet.check();
      await week.getByRole("checkbox", { name: "Evening stretch: done" }).waitFor({ timeout: 15000 });
      await t.settle(1000);
      await week.getByRole("button", { name: "Close" }).click();
      await week.waitFor({ state: "hidden", timeout: 10000 });
      const onHome = panel.getByRole("checkbox", { name: /^Evening stretch: / });
      await onHome.waitFor({ timeout: 15000 });
      const ticked = await onHome.isChecked();
      const event = await standin.one(`select status from public.planner_events where user_id = '${account.id}' and title = 'Evening stretch'`);
      t.note("week sheet item", { ticked, event });
      t.expect(event?.status === "completed", "the item ticked in the week sheet should be saved as done", event);
      t.expect(ticked, "Home's To-Do list should show the week sheet's new, ticked item without a reload");
      await t.checkpoint("to-do after the week sheet", { fullPage: false });
    });

    await t.step("logged food moves the daily protein goal", async () => {
      await t.goto("/nutrition", { label: "log food for goals" });
      await page.getByRole("textbox", { name: "Search foods" }).fill("100 g paneer");
      await page.getByRole("button", { name: "Search food" }).click();
      await page.getByText("Loading foods…").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
      await t.settle(2000);
      const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Add to log", exact: true }) }).first();
      if (await panel.getByText("Choose a food").isVisible().catch(() => false)) await page.locator("div[aria-live=polite] button[aria-pressed]").first().click();
      await panel.getByRole("button", { name: "Add to log" }).click();
      await t.settle(2000);
      const logged = await standin.one(`select food_name, protein::text from public.meals where user_id = '${account.id}' order by created_at desc limit 1`);
      t.note("logged for the protein goal", logged);
      await t.goto("/dashboard?panel=goals", { label: "goals after food" });
      const protein = t.goals.find((goal) => goal.metric === "protein_g").title;
      const progress = await goalProgress(t, protein);
      t.note("protein goal", progress);
      t.expect(progress.percent > 0 && new RegExp(`^${Math.round(Number(logged.protein))}`).test(progress.text ?? ""), `the protein goal should count ${logged?.protein} g`, progress);
    });

    await t.step("the finished workout counts toward the weekly goal", async () => {
      const workouts = t.goals.find((goal) => goal.metric === "workouts_completed").title;
      const progress = await goalProgress(t, workouts);
      t.note("weekly workouts goal", progress);
      t.expect(/^1\b/.test(progress.text ?? "") && progress.percent === 33, "one of three workouts should be counted", progress);
    });

    await t.step("a new weigh-in moves the long-term weight goal", async () => {
      await t.goto("/dashboard", { label: "log weight on Home" });
      const widget = page.locator("[data-widget=weight]");
      await widget.getByRole("button", { name: "Log weight" }).click();
      await widget.getByLabel("Weight in kilograms").fill("71");
      await widget.getByRole("button", { name: "Save" }).click();
      await widget.getByText("71.0").first().waitFor({ timeout: 15000 }).catch(() => undefined);
      await t.goto("/dashboard?panel=goals", { label: "goals after weigh-in" });
      const weight = t.goals.find((goal) => goal.metric === "body_weight_kg").title;
      const progress = await goalProgress(t, weight);
      t.note("weight goal", progress);
      t.expect(progress.percent === 50, "72 → 71 of a 72 → 70 goal is 50%", progress);
      await t.checkpoint("goals after logging");
    });

    await t.step("Home widgets added, moved and hidden in Customise stay arranged after reload", async () => {
      await t.goto("/dashboard", { label: "arrange home" });
      const order = async () => page.locator("[data-widget]").evaluateAll((items) => items.map((item) => item.getAttribute("data-widget")));
      const before = await order();
      t.expect(before[0] === "today" && JSON.stringify(before) === JSON.stringify(["today", "weight", "water"]), "a new Home: the Today ring, then weight and water", before);
      t.expect(await page.locator("#home-todo").count() === 1 && await page.locator("#home-goals").count() === 1, "To-Do and Goals sit on Home");
      await page.getByRole("button", { name: "Customise" }).click();
      const sheet = page.getByRole("dialog", { name: "Customise Home" });
      await sheet.getByRole("button", { name: "Add Macros to Home" }).click();
      await sheet.getByRole("button", { name: "Add This week to Home" }).click();
      await sheet.getByRole("button", { name: "Move Macros up" }).click();
      await sheet.getByRole("button", { name: "Move Macros up" }).click();
      const hide = sheet.getByRole("button", { name: /^Hide / }).last();
      const hidden = (await hide.getAttribute("aria-label")).replace(/^Hide /, "");
      await hide.click();
      await sheet.getByText("Saved", { exact: true }).waitFor({ timeout: 15000 });
      await t.checkpoint("customise home", { fullPage: false });
      await sheet.getByRole("button", { name: "Done" }).click();
      const arranged = await order();
      await page.reload();
      await t.settle();
      await page.locator("[data-widget]").first().waitFor({ timeout: 15000 });
      const afterReload = await order();
      const stored = await standin.one(`select dashboard_layout::text from public.user_preferences where user_id = '${account.id}'`);
      t.note("home layout", { before, arranged, afterReload, hidden, stored });
      t.expect(JSON.stringify(arranged) !== JSON.stringify(before), "the arrangement should change", { before, arranged });
      t.expect(JSON.stringify(afterReload) === JSON.stringify(arranged), "the arrangement should survive a reload", { arranged, afterReload });
      t.expect(arranged[0] === "today", "the Today ring stays first", arranged);
      t.expect(arranged.includes("macros") && arranged.indexOf("macros") < arranged.indexOf("weight"), "Macros should be added and moved above Weight", { before, arranged });
      t.expect(hidden === "This week" && !arranged.includes("week"), "This week, hidden again, should be gone", { hidden, arranged });
      await t.checkpoint("home arranged after reload");
    });
  },
};
