// Flow 1: sign up with e-mail and password, onboarding v2 (body, goal, training, schedule, food with allergies,
// budget), the once-per-account intro film on the first app page (skipped), the short loader on reload, and
// Home showing the numbers that were saved.
import { choose, seeText, textOf } from "./common.mjs";

export const flow = {
  id: "01-signup-onboarding",
  title: "Sign up → onboarding v2 → film once → Home",
  schemes: (schemes) => schemes,
  async run(t, { standin }) {
    const account = standin.newCredentials("Asha Rao", "signup");
    let startingKcal = null;
    let userId = null;
    const page = await t.open({ consent: null });

    await t.step("sign-up page and the analytics choice", async () => {
      await t.goto("/signup", { label: "sign-up page" });
      const banner = page.getByRole("complementary", { name: "Cookie and analytics choices" });
      t.expect(await banner.isVisible(), "the cookie and analytics banner should show on a first visit");
      await t.checkpoint("sign-up page with privacy banner");
      await banner.getByRole("button", { name: "Essential only" }).click();
      t.expect(!(await banner.isVisible()), "the banner should close after choosing Essential only");
      const saved = await page.evaluate(() => window.localStorage.getItem("fitx-cookie-consent"));
      t.expect(saved === "essential", `the choice should be remembered (got ${saved})`);
    });

    await t.step("create the account with e-mail", async () => {
      await page.getByText("Other sign-up options").click();
      await page.getByLabel("Your name").fill(account.name);
      await page.getByLabel("Email address").fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await page.getByLabel("Confirm password").fill(account.password);
      await Promise.all([
        page.waitForURL("**/onboarding", { timeout: 30000 }),
        page.getByRole("button", { name: "Create account with email" }).click(),
      ]);
      await seeText(t, "Tell us about you");
      const row = await standin.one(`select u.id, p.name, p.onboarded from auth.users u join public.profiles p on p.id = u.id where u.email = '${account.email}'`);
      t.expect(row && row.onboarded === "f", "a profile row should exist and not be onboarded yet", row);
      userId = row.id;
      const cookies = await t.context.cookies();
      t.note("cookies after sign-up", cookies.map((cookie) => `${cookie.name}=${cookie.name.startsWith("sb-") ? "<session>" : cookie.value}`));
      t.expect(cookies.some((cookie) => cookie.name === "fitx_intro" && cookie.value === "play"), "the server should mark this device to play the film once (fitx_intro=play)");
    });

    await t.step("onboarding 1 of 6: about you", async () => {
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      t.expect((await name.inputValue()) === account.name, "the name from sign-up should be filled in");
      await t.checkpoint("onboarding about you (empty)");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "Check the highlighted answers.");
      await t.checkpoint("onboarding about you (validation)");
      await page.getByRole("textbox", { name: "Age" }).fill("29");
      await choose(t, "Sex for the calorie formula", "Female");
      await page.getByRole("textbox", { name: "Height", exact: true }).fill("162");
      await page.getByRole("textbox", { name: "Current weight", exact: true }).fill("68.5");
      await page.getByRole("textbox", { name: /^Target weight/ }).fill("62");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "What are you working toward?");
    });

    await t.step("onboarding 2 of 6: goal and activity", async () => {
      await choose(t, "Main goal", "Fat loss");
      await choose(t, "Daily activity", "Moderately active");
      const preview = page.getByText("kcal a day").first();
      await preview.waitFor();
      const previewText = await textOf(page.locator("div[aria-live=polite]").filter({ hasText: "Your starting targets" }));
      startingKcal = Number((/([\d,]+)\s*kcal a day/.exec(previewText)?.[1] ?? "").replace(/,/g, "")) || null;
      t.note("starting targets shown", previewText);
      t.expect(startingKcal && startingKcal > 1000 && startingKcal < 3500, `a plausible starting calorie target should show (${previewText})`);
      await t.checkpoint("onboarding goal");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "Where and how do you train?");
    });

    await t.step("onboarding 3 of 6: training and home equipment", async () => {
      await choose(t, "Where do you usually train?", "Gym and home");
      await choose(t, "Training experience", "Intermediate");
      for (const item of ["Dumbbells", "Resistance bands", "Weight bench"]) {
        const button = page.getByRole("button", { name: item, exact: true });
        await button.click();
        t.expect((await button.getAttribute("aria-pressed")) === "true", `${item} should be selected`);
      }
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Injuries or areas to go easy on" }) }).locator("label").filter({ hasText: "Knees" }).click();
      await t.checkpoint("onboarding training");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "How much time do you have?");
    });

    await t.step("onboarding 4 of 6: schedule", async () => {
      await choose(t, "Training days a week", "4");
      await choose(t, "Typical session length", "45 min");
      await choose(t, "Preferred training split", "Full body");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "How do you eat?");
    });

    await t.step("onboarding 5 of 6: diet and allergies", async () => {
      await choose(t, "Which describes you best?", "Vegetarian");
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Food allergies or intolerances" }) }).locator("label").filter({ hasText: "Peanuts" }).click();
      await page.getByRole("textbox", { name: "Add allergy" }).fill("kiwi");
      await page.getByRole("button", { name: "Add allergy" }).click();
      await seeText(t, "kiwi");
      await choose(t, "Meals a day", "4");
      await t.checkpoint("onboarding food");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "Food and budget");
    });

    await t.step("onboarding 6 of 6: budget, then finish", async () => {
      await choose(t, "How tight is your food budget?", "Moderate");
      await page.getByRole("textbox", { name: /^Monthly food budget/ }).fill("6000");
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Cuisines you enjoy" }) }).locator("label").filter({ hasText: "South Indian" }).click();
      await t.checkpoint("onboarding budget");
      await Promise.all([
        page.waitForURL("**/dashboard", { timeout: 30000 }),
        page.getByRole("button", { name: "Finish setup" }).click(),
      ]);
    });

    await t.step("the account's film starts once on the first app page, and Skip works", async () => {
      await page.waitForTimeout(600);
      const log = await t.rootLog();
      t.note("<html> attributes on the first dashboard load", log);
      t.expect(log.some((entry) => entry.name === "data-fitx-intro-gate" && entry.value === "account"), "the head script should open the account's film gate on the first dashboard visit", log);
      const skip = page.getByRole("button", { name: /Skip intro/ });
      await skip.waitFor({ state: "visible", timeout: 10000 });
      await t.checkpoint("intro film playing", { fullPage: false, settle: false });
      await skip.click();
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-fitx-intro"), null, { timeout: 8000 });
      const cookies = await t.context.cookies();
      t.expect(cookies.find((cookie) => cookie.name === "fitx_intro")?.value === "seen", "after the film the device cookie should say seen");
      // The account remembers it too, so another device doesn't replay it.
      let stored = null;
      for (let i = 0; i < 20 && !stored?.intro_completed_at; i += 1) {
        stored = await standin.one(`select intro_completed_at from public.profiles where id = '${userId}'`);
        if (!stored?.intro_completed_at) await page.waitForTimeout(250);
      }
      t.expect(Boolean(stored?.intro_completed_at), "profiles.intro_completed_at should be set once the film started");
    });

    await t.step("Home shows the saved numbers", async () => {
      await seeText(t, "Good ");
      await t.settle();
      const body = await textOf(page.locator("main"));
      t.note("Home text", body.slice(0, 1500));
      t.expect(/Asha/.test(body), "Home should greet the member by first name");
      t.expect(/68\.5/.test(body), "Home should show the starting weight 68.5 kg");
      if (startingKcal) {
        const shown = startingKcal.toLocaleString("en-IN");
        t.expect(body.includes(shown) || body.includes(String(startingKcal)), `Home should show the calorie target from onboarding (${shown} kcal)`, body.slice(0, 600));
      }
      t.expect(!/NaN|undefined|\[object Object\]/.test(body), "Home should not show NaN, undefined or [object Object]");
      await t.checkpoint("home after onboarding");
    });

    await t.step("a reload shows only the short loader, not the film", async () => {
      await page.reload({ waitUntil: "load" });
      await t.settle();
      const log = await t.rootLog();
      t.note("<html> attributes on reload", log);
      t.expect(!log.some((entry) => entry.name === "data-fitx-intro-gate"), "the film must not start again on reload", log);
      t.expect(log.some((entry) => entry.name === "data-fitx-loader" && entry.value === "on"), "the short brand loader should show on reload", log);
      t.expect((await page.getByRole("button", { name: /Skip intro/ }).count()) === 0, "no Skip intro button after reload");
      await t.checkpoint("home after reload");
    });

    await t.step("what onboarding saved", async () => {
      const row = await standin.one(`select p.name, p.age, p.gender, p.height::text, p.weight::text, p.target_weight::text, p.onboarded,
          up.primary_goal, up.activity_level, up.workout_location, up.fitness_level, up.workouts_per_week, up.session_duration_minutes, up.workout_split,
          up.diet_type, up.allergies::text, up.meals_per_day, up.food_budget_level, up.monthly_food_budget_inr, up.cuisines::text, up.limitations::text, up.timezone,
          (select equipment_keys::text from public.user_equipment_profiles e where e.user_id = p.id and e.context = 'home') home_kit,
          (select string_agg(weight::text || ' ' || coalesce(note, ''), '; ') from public.body_metrics b where b.user_id = p.id) weigh_ins
        from public.profiles p join public.user_preferences up on up.user_id = p.id where p.id = '${userId}'`);
      t.note("saved by onboarding", row);
      t.expect(row?.onboarded === "t", "profile should be onboarded");
      t.expect(row.age === "29" && row.gender === "female" && Number(row.height) === 162 && Number(row.weight) === 68.5 && Number(row.target_weight) === 62, "body answers saved", row);
      t.expect(row.primary_goal === "fat_loss" && row.activity_level === "moderate", "goal and activity saved", row);
      t.expect(row.workout_location === "both" && row.fitness_level === "intermediate", "training saved", row);
      t.expect(/dumbbell/.test(row.home_kit ?? "") && /resistance_band/.test(row.home_kit ?? "") && /bench/.test(row.home_kit ?? ""), "home equipment list saved", row);
      t.expect(row.workouts_per_week === "4" && row.session_duration_minutes === "45" && row.workout_split === "full_body", "schedule saved", row);
      t.expect(row.diet_type === "vegetarian" && /peanuts/.test(row.allergies) && /kiwi/.test(row.allergies) && row.meals_per_day === "4", "diet and allergies saved", row);
      t.expect(row.food_budget_level === "moderate" && row.monthly_food_budget_inr === "6000" && /south_indian/.test(row.cuisines), "budget saved", row);
      t.expect(/knee/.test(row.limitations ?? ""), "limitations saved", row);
      t.expect(/68\.5/.test(row.weigh_ins ?? ""), "a starting weigh-in logged", row);
    });
  },
};
