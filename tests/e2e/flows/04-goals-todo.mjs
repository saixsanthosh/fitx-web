// Flow 4: Goals live on Progress (Home keeps only the greeting and the daily quote; To-Do left the app). A goal
// template link opens the editor on Progress once; a daily (protein), a weekly (workouts) and a long-term (weight)
// goal are created there; logged food, a finished workout and a weigh-in logged on Progress move them; the old
// Goals and To-Do addresses end on Progress and Home without any To-Do. The redirect pages are onboarding-home's:
// that last step passes once its branch is merged.
import { signInUi, textOf } from "./common.mjs";

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
  title: "Goals on Progress: template links, goals follow food, workouts and weigh-ins; To-Do gone",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Nikhil Rao", tag: "goals", profile: { weight: 72, target_weight: 70 } });
    await signInUi(t, account);

    await t.step("a goal template link opens the editor on Progress, once", async () => {
      await t.goto("/progress?panel=goals&new=water_day", { label: "template link" });
      const editor = page.getByRole("dialog", { name: "New goal" });
      await editor.getByLabel(/^Target/).waitFor({ timeout: 20000 });
      const url = new URL(page.url());
      t.expect(url.pathname === "/progress" && url.searchParams.get("panel") === "goals" && url.searchParams.get("new") === null, "the template is used once and dropped from the address", page.url());
      await t.checkpoint("goal editor from a link", { fullPage: false });
      await editor.getByRole("button", { name: "Cancel" }).click();
      await editor.waitFor({ state: "hidden", timeout: 10000 });
      t.expect(await page.locator("#home-goals").count() === 1, "Goals sit on Progress");
    });

    await t.step("create a daily, a weekly and a long-term goal", async () => {
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
      await t.goto("/progress?panel=goals", { label: "goals after food" });
      const protein = t.goals.find((goal) => goal.metric === "protein_g").title;
      const progress = await goalProgress(t, protein);
      t.note("protein goal", progress);
      t.expect(progress.percent > 0 && new RegExp(`^${Math.round(Number(logged.protein))}`).test(progress.text ?? ""), `the protein goal should count ${logged?.protein} g`, progress);
    });

    await t.step("a finished workout counts toward the weekly goal", async () => {
      await standin.sql(`insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds)
        values ('${account.id}', 'Evening push-ups', 'completed', now() - interval '40 minutes', now() - interval '10 minutes', 1800)`);
      await t.goto("/progress?panel=goals", { label: "goals after a workout" });
      const workouts = t.goals.find((goal) => goal.metric === "workouts_completed").title;
      const progress = await goalProgress(t, workouts);
      t.note("weekly workouts goal", progress);
      t.expect(/^1\b/.test(progress.text ?? "") && progress.percent === 33, "one of three workouts should be counted", progress);
    });

    await t.step("a weigh-in logged on Progress moves the long-term weight goal", async () => {
      const body = page.locator("section[aria-labelledby='body-title']");
      await body.getByRole("button", { name: "Log measurement" }).click();
      const sheet = page.getByRole("dialog", { name: "Log measurement" });
      await sheet.getByLabel("Weight (kg)").fill("71");
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await sheet.waitFor({ state: "hidden", timeout: 15000 });
      await body.getByText("71.0").first().waitFor({ timeout: 15000 });
      await t.goto("/progress?panel=goals", { label: "goals after weigh-in" });
      const weight = t.goals.find((goal) => goal.metric === "body_weight_kg").title;
      const progress = await goalProgress(t, weight);
      t.note("weight goal", progress);
      t.expect(progress.percent === 50, "72 → 71 of a 72 → 70 goal is 50%", progress);
      await t.checkpoint("goals after logging");
    });

    await t.step("the old Goals and To-Do addresses end on Progress and Home, with no To-Do anywhere", async () => {
      const landed = {};
      for (const [from, to] of [["/goals", "/progress?panel=goals"], ["/goals?tab=goals&new=water_day", "/progress?panel=goals"], ["/tasks", "/dashboard"], ["/goals?tab=today", "/dashboard"]]) {
        await t.goto(from, { label: `old ${from}` });
        await t.settle(1000);
        const url = new URL(page.url());
        landed[from] = `${url.pathname}${url.search}`;
        t.expect(landed[from] === to, `${from} should end on ${to}`, landed[from]);
      }
      t.note("old addresses", landed);
      const main = await textOf(page.locator("main"));
      t.expect(await page.locator("#home-todo").count() === 0 && !/To-Do/.test(main), "Home shows no To-Do", main.slice(0, 300));
    }, { soft: true });
  },
};
