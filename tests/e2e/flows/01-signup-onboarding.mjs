// Flow 1: sign up with e-mail and password, setup in three pages (personal details, food and nutrition, workout
// setup with the equipment grid), the once-per-account intro film on the first app page (skipped), the short loader
// on reload, and Home showing the numbers that were saved.
import { choose, seeText, textOf } from "./common.mjs";

const BIRTH_DATE = "1997-03-14";
/** Whole years from BIRTH_DATE to today in Asia/Kolkata (the browser's zone in these runs). */
const expectedAge = (() => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  return y - 1997 - (m < 3 || (m === 3 && d < 14) ? 1 : 0);
})();

export const flow = {
  id: "01-signup-onboarding",
  title: "Sign up → setup in three pages → film once → Home",
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
      await page.getByRole("heading", { level: 1, name: "Personal details" }).waitFor();
      const row = await standin.one(`select u.id, p.name, p.onboarded from auth.users u join public.profiles p on p.id = u.id where u.email = '${account.email}'`);
      t.expect(row && row.onboarded === "f", "a profile row should exist and not be onboarded yet", row);
      userId = row.id;
      const cookies = await t.context.cookies();
      t.note("cookies after sign-up", cookies.map((cookie) => `${cookie.name}=${cookie.name.startsWith("sb-") ? "<session>" : cookie.value}`));
      t.expect(cookies.some((cookie) => cookie.name === "fitx_intro" && cookie.value === "play"), "the server should mark this device to play the film once (fitx_intro=play)");
    });

    await t.step("setup 1 of 3: personal details", async () => {
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      t.expect((await name.inputValue()) === account.name, "the name from sign-up should be filled in");
      const progress = page.getByRole("progressbar", { name: "Setup progress" });
      t.expect((await progress.getAttribute("aria-valuemax")) === "3", "setup should have exactly three pages");
      await t.checkpoint("setup personal details (empty)");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "Check the highlighted answers.");
      t.expect((await page.getByLabel("Date of birth").getAttribute("aria-invalid")) === "true", "an empty date of birth should be flagged");
      await t.checkpoint("setup personal details (validation)");
      await page.getByLabel("Date of birth").fill(BIRTH_DATE);
      await seeText(t, `${expectedAge} years`);
      await choose(t, "Gender", "Female");
      await page.getByRole("textbox", { name: "Height", exact: true }).fill("162");
      await page.getByRole("textbox", { name: "Current weight", exact: true }).fill("68.5");
      await page.getByRole("textbox", { name: /^Target weight/ }).fill("62");
      await choose(t, "Primary goal", "Weight loss");
      await choose(t, "Fitness experience", "Intermediate");
      await choose(t, "Activity level", "Moderate");
      await choose(t, "Workout setup", "Both");
      await choose(t, "Diet", "Vegetarian");
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Injuries or limitations" }) }).locator("label").filter({ hasText: "Knees" }).click();
      // The stage counts up to the estimate; give it time to land.
      await page.waitForTimeout(1200);
      const stage = page.locator("[data-onboarding-stage]");
      const stageText = await textOf(stage);
      startingKcal = Number((/([\d,]+)\s*kcal a day/.exec(stageText)?.[1] ?? "").replace(/,/g, "")) || null;
      t.note("stage on page 1", stageText);
      t.expect(/Estimate/.test(stageText), "the calorie target should be labelled as an estimate");
      t.expect(startingKcal && startingKcal > 1000 && startingKcal < 3500, `a plausible starting calorie target should show (${stageText})`);
      t.expect(/162 cm/.test(stageText) && /68\.5 kg/.test(stageText) && new RegExp(`${expectedAge} yrs`).test(stageText), "the stage should read back age, height and weight", stageText);
      await t.checkpoint("setup personal details (filled)");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "Food and nutrition" }).waitFor();
    });

    await t.step("setup 2 of 3: food and nutrition", async () => {
      const diet = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Which describes you best?" }) });
      t.expect(await diet.getByRole("radio", { name: "Vegetarian", exact: true }).isChecked(), "the diet given on page 1 should carry over");
      await choose(t, "Which describes you best?", "Eggetarian");
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Food allergies or intolerances" }) }).locator("label").filter({ hasText: "Peanuts" }).click();
      await page.getByRole("textbox", { name: "Add allergy" }).fill("kiwi");
      await page.getByRole("button", { name: "Add allergy" }).click();
      await seeText(t, "kiwi");
      // Typed but not added: it still saves with the page.
      await page.getByRole("textbox", { name: "Add food" }).fill("Bitter gourd");
      await choose(t, "Meals per day", "4");
      await choose(t, "Food preference", "Home-cooked");
      await choose(t, "Nutrition goal", "High protein");
      await t.checkpoint("setup food and nutrition");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "Workout setup" }).waitFor();
    });

    await t.step("setup 3 of 3: workout setup with the equipment grid", async () => {
      const where = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Workout location" }) });
      t.expect(await where.getByRole("radio", { name: "Both" }).isChecked(), "the workout setup from page 1 should carry over");
      const gym = page.getByRole("group", { name: "Gym equipment" });
      await gym.waitFor();
      const smith = gym.getByRole("button", { name: "Smith machine", exact: true });
      t.expect((await smith.getAttribute("aria-pressed")) === "true", "the gym starts fully equipped");
      await smith.click();
      t.expect((await smith.getAttribute("aria-pressed")) === "false", "a gym item can be taken off");
      await page.getByRole("radiogroup", { name: "Equipment for" }).getByText("Home", { exact: true }).click();
      const home = page.getByRole("group", { name: "Home equipment" });
      await home.waitFor();
      const none = home.getByRole("button", { name: /^No equipment/ });
      t.expect((await none.getAttribute("aria-pressed")) === "true", "with nothing chosen, home is bodyweight only");
      for (const item of ["Dumbbells", "Resistance bands", "Weight bench"]) {
        const button = home.getByRole("button", { name: item, exact: true });
        await button.click();
        t.expect((await button.getAttribute("aria-pressed")) === "true", `${item} should be selected`);
      }
      t.expect((await none.getAttribute("aria-pressed")) === "false", "No equipment turns off once something is chosen");
      const experience = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Workout experience" }) });
      t.expect(await experience.getByRole("radio", { name: /Intermediate/ }).isChecked(), "the experience from page 1 should carry over");
      await choose(t, "Days a week", "4");
      await t.checkpoint("setup workout setup");
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

    await t.step("what setup saved", async () => {
      const row = await standin.one(`select p.name, p.age, p.date_of_birth::text, p.gender, p.height::text, p.weight::text, p.target_weight::text, p.onboarded,
          up.primary_goal, up.activity_level, up.workout_location, up.fitness_level, up.workouts_per_week,
          up.diet_type, up.allergies::text, up.food_dislikes::text, up.meals_per_day, up.food_source, up.nutrition_focus, up.limitations::text, up.timezone,
          (select equipment_keys::text from public.user_equipment_profiles e where e.user_id = p.id and e.context = 'home') home_kit,
          (select equipment_keys::text from public.user_equipment_profiles e where e.user_id = p.id and e.context = 'gym') gym_kit,
          (select string_agg(weight::text || ' ' || coalesce(note, ''), '; ') from public.body_metrics b where b.user_id = p.id) weigh_ins
        from public.profiles p join public.user_preferences up on up.user_id = p.id where p.id = '${userId}'`);
      t.note("saved by setup", row);
      t.expect(row?.onboarded === "t", "profile should be onboarded");
      t.expect(row.date_of_birth === BIRTH_DATE && row.age === String(expectedAge), "date of birth saved, with the age it gives", row);
      t.expect(row.gender === "female" && Number(row.height) === 162 && Number(row.weight) === 68.5 && Number(row.target_weight) === 62, "body answers saved", row);
      t.expect(row.primary_goal === "weight_loss" && row.activity_level === "moderate", "goal and activity saved", row);
      t.expect(row.workout_location === "both" && row.fitness_level === "intermediate" && row.workouts_per_week === "4", "workout setup saved", row);
      t.expect(/dumbbell/.test(row.home_kit ?? "") && /resistance_band/.test(row.home_kit ?? "") && /bench/.test(row.home_kit ?? ""), "home equipment list saved", row);
      t.expect(Boolean(row.gym_kit) && /barbell/.test(row.gym_kit) && !/smith_machine/.test(row.gym_kit), "gym equipment list saved without the Smith machine", row);
      t.expect(row.diet_type === "eggetarian" && /peanuts/.test(row.allergies) && /kiwi/.test(row.allergies) && row.meals_per_day === "4", "diet and allergies saved", row);
      t.expect(/Bitter gourd/.test(row.food_dislikes ?? ""), "a food typed but not added still saves", row);
      t.expect(row.food_source === "home" && row.nutrition_focus === "high_protein", "food preference and nutrition goal saved", row);
      t.expect(/knee/.test(row.limitations ?? ""), "limitations saved", row);
      t.expect(/68\.5/.test(row.weigh_ins ?? ""), "a starting weigh-in logged", row);
    });
  },
};
