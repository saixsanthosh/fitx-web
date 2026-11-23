// Flow 1: sign up with e-mail and password, setup in three short pages (about you, your body with dials, your goal
// with photo cards; no workout or food questions), the once-per-account intro film on the first app page (skipped),
// the short loader on reload, and Home with the greeting and today's quote (the same after the reload). That is
// today's behaviour, without welcome cuts (D1 dormant). Then, with the film fixture standing in for the welcome cuts
// (BRIEF-2 D1 and 3.3): a second account's setup ends on the welcome film in the same document, with exactly one Skip
// control, then Home; the account is recorded (intro_completed_at) and no film plays on Home or on reload.
import { serveFilmFixture } from "../fixtures/films/route.mjs";
import { choose, seeText, textOf } from "./common.mjs";

const BIRTH_DATE = "1997-03-14";
/** Whole years from BIRTH_DATE to today in Asia/Kolkata (the browser's zone in these runs). */
const expectedAge = (() => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  return y - 1997 - (m < 3 || (m === 3 && d < 14) ? 1 : 0);
})();

/** Signs up `account` on /signup (the cookie banner already answered) and fills the three setup pages. */
async function signUpAndSetUp(t, account) {
  const page = t.page;
  await t.goto("/signup", { label: "second sign-up" });
  await page.getByText("Other sign-up options").click();
  await page.getByLabel("Your name").fill(account.name);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm password").fill(account.password);
  await Promise.all([
    page.waitForURL("**/onboarding", { timeout: 30000 }),
    page.getByRole("button", { name: "Create account with email" }).click(),
  ]);
  await page.getByRole("heading", { level: 1, name: "About you" }).waitFor();
  await page.getByLabel("Date of birth").fill("1994-08-02");
  await choose(t, "Gender", "Male");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { level: 1, name: "Your body" }).waitFor();
  await page.getByRole("textbox", { name: "Height", exact: true }).fill("176");
  await page.getByRole("textbox", { name: "Current weight", exact: true }).fill("74");
  await page.getByRole("textbox", { name: /^Target weight/ }).fill("72");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { level: 1, name: "Your goal" }).waitFor();
  await choose(t, "Primary goal", "Muscle gain");
  await choose(t, "Activity level", "Moderate");
}

export const flow = {
  id: "01-signup-onboarding",
  title: "Sign up → three short setup pages → film once → Home with greeting and quote; with welcome cuts, the welcome film",
  sizes: ["phone", "tablet", "desktop"],
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
      await page.getByRole("heading", { level: 1, name: "About you" }).waitFor();
      const row = await standin.one(`select u.id, p.name, p.onboarded from auth.users u join public.profiles p on p.id = u.id where u.email = '${account.email}'`);
      t.expect(row && row.onboarded === "f", "a profile row should exist and not be onboarded yet", row);
      userId = row.id;
      const cookies = await t.context.cookies();
      t.note("cookies after sign-up", cookies.map((cookie) => `${cookie.name}=${cookie.name.startsWith("sb-") ? "<session>" : cookie.value}`));
      t.expect(cookies.some((cookie) => cookie.name === "fitx_intro" && cookie.value === "play"), "the server should mark this device to play the film once (fitx_intro=play)");
    });

    await t.step("setup 1 of 3: about you", async () => {
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      t.expect((await name.inputValue()) === account.name, "the name from sign-up should be filled in");
      const progress = page.getByRole("progressbar", { name: "Setup progress" });
      t.expect((await progress.getAttribute("aria-valuemax")) === "3", "setup should have exactly three pages");
      const asked = await textOf(page.locator("form"));
      for (const gone of ["Workout setup", "Equipment", "Diet", "allergies", "Meals per day", "Days a week", "Injuries"]) {
        t.expect(!asked.includes(gone), `setup no longer asks "${gone}" (it moved to the Workout or Nutrition first-time setup)`);
      }
      await t.checkpoint("setup about you (empty)");
      await page.getByRole("button", { name: "Continue" }).click();
      await seeText(t, "Check the highlighted answers.");
      t.expect((await page.getByLabel("Date of birth").getAttribute("aria-invalid")) === "true", "an empty date of birth should be flagged");
      await t.checkpoint("setup about you (validation)");
      await page.getByLabel("Date of birth").fill(BIRTH_DATE);
      await seeText(t, `${expectedAge} years`);
      await choose(t, "Gender", "Female");
      await t.checkpoint("setup about you (filled)");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "Your body" }).waitFor();
    });

    await t.step("back on About you, the saved date of birth is shown, not edited (a change is a support request)", async () => {
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("heading", { level: 1, name: "About you" }).waitFor();
      await seeText(t, "You can add it once. To change it, ask FITX support.");
      t.expect((await page.locator("form input[type=date]").count()) === 0, "the saved date of birth is not an editable field");
      t.expect((await page.getByRole("link", { name: "Ask FITX support" }).getAttribute("href")) === "/help?from=%2Fonboarding", "the support line links to Help");
      await t.checkpoint("setup about you (saved date of birth)");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "Your body" }).waitFor();
    });

    await t.step("setup 2 of 3: your body, with dials", async () => {
      const height = page.getByRole("textbox", { name: "Height", exact: true });
      await height.fill("162");
      await page.getByRole("button", { name: "More height" }).click();
      t.expect((await height.inputValue()) === "163", `the + stepper should add a centimetre (got ${await height.inputValue()})`);
      await page.getByRole("button", { name: "Less height" }).click();
      t.expect((await height.inputValue()) === "162", "the - stepper should take it back");
      const dial = page.getByRole("slider", { name: "Height dial" });
      t.expect((await dial.getAttribute("aria-valuetext")) === "162 cm", "the dial follows what was typed", await dial.getAttribute("aria-valuetext"));
      await page.getByRole("textbox", { name: "Current weight", exact: true }).fill("68.5");
      await page.getByRole("textbox", { name: /^Target weight/ }).fill("62");
      const stage = await textOf(page.locator("[data-onboarding-stage]"));
      t.expect(/162 cm/.test(stage) && /68\.5 kg/.test(stage) && /62 kg/.test(stage), "the stage reads back height, weight and target", stage);
      await t.checkpoint("setup your body");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "Your goal" }).waitFor();
    });

    await t.step("setup 3 of 3: your goal, as photo cards", async () => {
      await choose(t, "Primary goal", "Weight loss");
      await choose(t, "Activity level", "Moderate");
      // The stage counts up to the estimate; give it time to land.
      await page.waitForTimeout(1200);
      const stageText = await textOf(page.locator("[data-onboarding-stage]"));
      startingKcal = Number((/([\d,]+)\s*kcal a day/.exec(stageText)?.[1] ?? "").replace(/,/g, "")) || null;
      t.note("stage on page 3", stageText);
      t.expect(/Estimate/.test(stageText), "the calorie target should be labelled as an estimate");
      t.expect(startingKcal && startingKcal > 1000 && startingKcal < 3500, `a plausible starting calorie target should show (${stageText})`);
      t.expect(/162 cm/.test(stageText) && /68\.5 kg/.test(stageText) && new RegExp(`${expectedAge} yrs`).test(stageText), "the stage should read back age, height and weight", stageText);
      t.expect((await page.locator("fieldset img").count()) >= 8, "goal and activity choices are photo cards");
      await t.checkpoint("setup your goal");
      // The device still owes the account its film, so the post-onboarding logo step is skipped: straight to Home.
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

    let quoteText = "";
    await t.step("Home greets the member by name with today's quote, and nothing else", async () => {
      await page.getByRole("heading", { level: 1, name: /Asha$/ }).waitFor({ timeout: 15000 });
      const figure = page.getByRole("figure", { name: "Today's quote" });
      await figure.locator("blockquote").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2500);
      quoteText = await textOf(figure.locator("blockquote").first());
      t.expect(quoteText.length > 8, "a quote should show", quoteText);
      const body = await textOf(page.locator("main"));
      t.note("Home text", body.slice(0, 600));
      t.expect(!/kcal|68\.5|To-Do|Customise/.test(body), "Home shows no numbers, widgets or To-Do", body.slice(0, 600));
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
      await page.getByRole("figure", { name: "Today's quote" }).locator("blockquote").first().waitFor({ timeout: 15000 });
      const again = await textOf(page.getByRole("figure", { name: "Today's quote" }).locator("blockquote").first());
      t.expect(again === quoteText, "the quote stays the same after a reload", { before: quoteText, after: again });
      await t.checkpoint("home after reload");
    });

    await t.step("what setup saved, and what it left for the Workout and Nutrition setups", async () => {
      const row = await standin.one(`select p.name, p.age, p.date_of_birth::text, p.gender, p.height::text, p.weight::text, p.target_weight::text, p.onboarded,
          up.primary_goal, up.activity_level, up.timezone, up.diet_type, up.food_source, up.nutrition_focus, up.allergies::text,
          (select count(*) from public.user_equipment_profiles e where e.user_id = p.id) kit_lists,
          (select string_agg(weight::text || ' ' || coalesce(note, ''), '; ') from public.body_metrics b where b.user_id = p.id) weigh_ins,
          (select q.text from public.daily_quote_history h join public.daily_quotes q on q.id = h.quote_id where h.user_id = p.id) shown_quote
        from public.profiles p join public.user_preferences up on up.user_id = p.id where p.id = '${userId}'`);
      t.note("saved by setup", row);
      t.expect(row?.onboarded === "t", "profile should be onboarded");
      t.expect(row.date_of_birth === BIRTH_DATE && row.age === String(expectedAge), "date of birth saved, with the age it gives", row);
      t.expect(row.gender === "female" && Number(row.height) === 162 && Number(row.weight) === 68.5 && Number(row.target_weight) === 62, "body answers saved", row);
      t.expect(row.primary_goal === "weight_loss" && row.activity_level === "moderate" && ["Asia/Kolkata", "Asia/Calcutta"].includes(row.timezone), "goal, activity and time zone saved", row);
      t.expect(row.diet_type === null && row.food_source === null && row.nutrition_focus === null && row.kit_lists === "0", "no food or equipment answers were asked or written", row);
      t.expect(/68\.5/.test(row.weigh_ins ?? ""), "a starting weigh-in logged", row);
      t.expect(row.shown_quote && quoteText.includes(row.shown_quote.slice(0, 20)), "the quote shown is the one stored for today", { row: row.shown_quote, quoteText });
    });

    await t.step("with welcome cuts (the fixture), the next account's setup ends on the welcome film with one Skip", async () => {
      // Signed out (the session and hint cookies go; the cookie choice in localStorage stays), then the fixture.
      await t.context.clearCookies();
      const asked = await serveFilmFixture(t);
      const second = standin.newCredentials("Ravi Menon", "welcome");
      await signUpAndSetUp(t, second);
      const cookies = await t.context.cookies();
      t.expect(cookies.some((cookie) => cookie.name === "fitx_intro" && cookie.value === "play"), "a new sign-up still owes the film (fitx_intro=play)");
      await page.getByRole("button", { name: "Finish setup" }).click();
      const stage = page.locator("[data-welcome-film]");
      await stage.waitFor({ state: "attached", timeout: 15000 });
      const kind = await stage.getAttribute("data-welcome-film");
      t.note("welcome case", kind);
      t.expect(kind === "film", "the film plays (not the reduced-motion still or the reveal-only case)", kind);
      t.expect(new URL(page.url()).pathname === "/onboarding", "in the same document as the Finish click", page.url());
      await page.getByRole("button", { name: "Skip welcome film" }).waitFor({ state: "visible", timeout: 10000 });
      const skips = await page.getByRole("button", { name: /^Skip/ }).count();
      t.expect(skips === 1, `exactly one Skip control while the film plays (found ${skips})`);
      t.expect((await page.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed")) === "false", "the film starts muted");
      await t.checkpoint("welcome film playing", { fullPage: false, settle: false });
      // The fixture's film is 2 s; it ends on its own, fades and loads Home.
      await page.waitForURL("**/dashboard", { timeout: 20000 });
      t.note("fixture files asked for", asked);
      t.expect(asked.some((file) => file.startsWith("/__fitx-fixture/films/welcome/") && file.endsWith(".mp4")), "the welcome cut played", asked);
      const seen = await page.evaluate(() => window.localStorage.getItem("fitx-film-seen"));
      t.expect(seen && Number.isFinite(Date.parse(seen)), "the device remembers when the welcome film started", seen);
      await t.settle();
      const log = await t.rootLog();
      t.expect(!log.some((entry) => entry.name === "data-fitx-intro-gate"), "no film on Home after the welcome film", log);
      const after = await t.context.cookies();
      t.expect(after.find((cookie) => cookie.name === "fitx_intro")?.value === "seen", "the device cookie says seen");
      let stored = null;
      for (let i = 0; i < 20 && !stored?.intro_completed_at; i += 1) {
        stored = await standin.one(`select p.intro_completed_at from public.profiles p join auth.users u on u.id = p.id where u.email = '${second.email}'`);
        if (!stored?.intro_completed_at) await page.waitForTimeout(250);
      }
      t.expect(Boolean(stored?.intro_completed_at), "profiles.intro_completed_at is set by the welcome film");
      await page.getByRole("heading", { level: 1, name: /Ravi$/ }).waitFor({ timeout: 15000 });
      await t.checkpoint("home after the welcome film");
      await page.reload({ waitUntil: "load" });
      await t.settle();
      const reload = await t.rootLog();
      t.expect(!log.concat(reload).some((entry) => entry.name === "data-fitx-intro-gate"), "and none on reload", reload);
      t.expect((await page.locator("[data-welcome-film]").count()) === 0, "the welcome film is gone");
    });
  },
};
