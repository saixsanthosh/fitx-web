// Flow 18: the Workouts first-time setup and the Home and Gym switch (phases 7 and 12). A member with no saved
// equipment sees the setup inline; Later hides it on this device (also after a reload); "Workout setup" opens it in a
// sheet: Both, home equipment from photos, the gym list, experience, days, a limitation and the female demonstration
// model, all saved. Workouts then opens on Gym; the Home tab shows the home collection with its body areas and the AI
// Form Check entry, an exercise opens its looping photo demonstration, and the mode carries over to the library and a
// reload. Arrow keys move between the tabs. The setup is changed later (Gym only). 768 px is checked too.
import { signInUi, textOf } from "./common.mjs";

const tabs = (page, name) => page.getByRole("tablist", { name });
/** How far the page is wider than the device: a phone zooms out to fit wide content, so innerWidth alone hides it. */
const overflow = async (page) => {
  const width = page.viewportSize()?.width ?? 0;
  return page.evaluate((device) => {
    const by = Math.max(document.documentElement.scrollWidth, window.innerWidth) - device;
    if (by <= 0) return by;
    // Name the widest elements, to find the cause (inside a sideways rail is fine: the rail scrolls).
    const offenders = [...document.querySelectorAll("body *")]
      .map((element) => ({ element, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
      .filter((item) => item.right > device + 0.5 && item.width > 0 && !item.element.closest("[class*='rail'], [class*='Rail']"))
      .sort((a, b) => b.right - a.right).slice(0, 6)
      .map((item) => `${item.element.tagName.toLowerCase()}.${String(item.element.className).slice(0, 60)} right=${Math.round(item.right)} w=${Math.round(item.width)}`);
    return { by, offenders };
  }, width);
};
const fits = (result) => typeof result === "number" && result <= 0;

export const flow = {
  id: "18-workout-setup",
  title: "Workouts setup, Later, Home and Gym tabs, home collection, demonstration, library carry-over",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Kabir Rao", tag: "setup", profile: { gender: "male" }, prefs: { workout_location: "home", fitness_level: "beginner" } });
    // A member who has never saved an equipment list: setup is not done yet (brief 3.4).
    await standin.sql(`delete from public.user_equipment_profiles where user_id = '${account.id}'`);
    await signInUi(t, account);

    await t.step("first visit: the setup is inline and Later hides it, also after a reload", async () => {
      await t.goto("/workouts", { label: "workouts first visit" });
      await page.getByRole("heading", { name: "Workouts", level: 1 }).waitFor();
      const setup = page.getByRole("region", { name: "Where do you train?" });
      await setup.waitFor({ timeout: 20000 });
      t.expect((await setup.getByRole("group", { name: "Where you train" }).getByRole("button").count()) === 3, "Home, Gym and Both are offered");
      const sideways = await overflow(page);
      t.expect(fits(sideways), "the page should not scroll sideways", { sideways });
      await t.checkpoint("setup inline");
      await setup.getByRole("button", { name: "Later" }).click();
      await setup.waitFor({ state: "detached", timeout: 5000 });
      await t.goto("/workouts", { label: "workouts after later" });
      await page.getByRole("tablist", { name: "Workout mode" }).waitFor({ timeout: 20000 });
      t.expect((await page.getByRole("region", { name: "Where do you train?" }).count()) === 0, "Later holds after a reload");
      // A member who trains at home opens on Home.
      t.expect((await tabs(page, "Workout mode").getByRole("tab", { name: "Home" }).getAttribute("aria-selected")) === "true", "home members open on the Home tab");
    });

    await t.step("Workout setup: both places, equipment from photos, training details and the demonstration model", async () => {
      await page.getByRole("button", { name: "Workout setup" }).click();
      const sheet = page.getByRole("dialog", { name: "Workout setup" });
      await sheet.waitFor();
      await sheet.getByRole("group", { name: "Where you train" }).getByRole("button", { name: "Both" }).click();
      await sheet.getByRole("button", { name: "Next" }).click();
      const home = sheet.getByRole("group", { name: "Home equipment" });
      await home.waitFor();
      const kettlebell = home.getByRole("button", { name: "Kettlebell", exact: true });
      if ((await kettlebell.getAttribute("aria-pressed")) !== "true") await kettlebell.click();
      t.expect((await home.locator("img").count()) >= 6, "equipment is shown with photos");
      await t.checkpoint("setup home equipment", { fullPage: false });
      await sheet.getByRole("button", { name: "Next" }).click();
      const gym = sheet.getByRole("group", { name: "Gym equipment" });
      await gym.waitFor();
      t.expect((await gym.getByRole("button", { name: "Squat rack", exact: true }).getAttribute("aria-pressed")) === "true", "a new gym list starts as a full gym");
      await sheet.getByRole("button", { name: "Next" }).click();
      await sheet.getByRole("button", { name: /^Regular/ }).click();
      await sheet.getByRole("button", { name: "4 days a week" }).click();
      await sheet.getByRole("button", { name: "Knees" }).click();
      // The profile says male, so the male model is chosen until the member picks another.
      t.expect((await sheet.getByRole("button", { name: "Male model", exact: true }).getAttribute("aria-pressed")) === "true", "the demonstration model follows the profile");
      await sheet.getByRole("button", { name: "Female model", exact: true }).click();
      await t.checkpoint("setup training details", { fullPage: false });
      await sheet.getByRole("button", { name: "Save setup" }).click();
      await sheet.waitFor({ state: "detached", timeout: 15000 });
      await page.getByText("Setup saved. Workouts now follows your answers.").waitFor({ timeout: 10000 });
      const prefs = await standin.one(`select workout_location, fitness_level, workouts_per_week, limitations::text, demo_model, workout_setup_at is not null done
        from public.user_preferences where user_id = '${account.id}'`);
      const lists = await standin.sql(`select context, equipment_keys::text keys from public.user_equipment_profiles where user_id = '${account.id}' order by context`);
      t.note("saved setup", { prefs, lists });
      t.expect(prefs?.workout_location === "both" && prefs.fitness_level === "intermediate" && Number(prefs.workouts_per_week) === 4, "location, level and days are saved", prefs);
      t.expect(/knee/.test(prefs?.limitations ?? "") && prefs?.demo_model === "female" && prefs?.done === "t", "limitation, model and the setup time are saved", prefs);
      t.expect(lists.some((row) => row.context === "home" && /kettlebell/.test(row.keys)) && lists.some((row) => row.context === "gym" && /squat_rack/.test(row.keys)), "both equipment lists are saved", lists);
    });

    await t.step("Home and Gym tabs: Gym for both places, Home lists the home collection with AI Form Check", async () => {
      const tablist = tabs(page, "Workout mode");
      const gymTab = tablist.getByRole("tab", { name: "Gym" });
      const homeTab = tablist.getByRole("tab", { name: "Home" });
      t.expect((await gymTab.getAttribute("aria-selected")) === "true", "after setup for both places Workouts opens on Gym");
      await page.getByRole("heading", { name: "Gym equipment" }).waitFor();
      await homeTab.click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("mode") === "home");
      await page.getByRole("heading", { name: "Home exercises" }).waitFor({ timeout: 15000 });
      t.expect((await page.getByRole("heading", { name: "Gym equipment" }).count()) === 0, "the Gym content is gone on Home");
      const formCheck = page.getByRole("link", { name: "AI Form Check" }).first();
      t.expect(/^\/home-workout/.test((await formCheck.getAttribute("href")) ?? ""), "AI Form Check links to the form check page");
      const areas = page.getByRole("group", { name: "Home body areas" });
      t.expect((await areas.getByRole("button").count()) >= 7, "every body area is offered");
      await areas.getByRole("button", { name: /^Chest/ }).click();
      await page.getByRole("heading", { name: "Chest", level: 2 }).waitFor();
      const cards = page.locator("section[aria-labelledby=home-collection-title] li button");
      t.expect((await cards.count()) > 0, "home chest exercises are listed");
      const sideways = await overflow(page);
      t.expect(fits(sideways), "the Home tab should not scroll sideways", { sideways });
      await t.checkpoint("home tab chest");
      await cards.first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("heading", { name: "How to do it" }).waitFor({ timeout: 20000 });
      // The harness blocks every outside host, so the public-domain photos may not load here: then the sheet must
      // say so plainly. When they load, the looping demonstration has its controls and its "no video" label.
      const replay = sheet.getByRole("button", { name: "Replay demonstration" });
      const unloaded = sheet.getByText("The photos could not be loaded");
      await Promise.race([replay.waitFor({ timeout: 20000 }), unloaded.waitFor({ timeout: 20000 })]).catch(() => undefined);
      // The player shows first and gives way to the message once both photos have failed: let that settle.
      await page.waitForTimeout(2500);
      if (await replay.count()) {
        const sheetText = await textOf(sheet);
        t.expect(/No verified video yet/.test(sheetText), "the demonstration says plainly that no verified video exists", sheetText.slice(0, 300));
        t.expect((await sheet.getByRole("button", { name: "Loop" }).getAttribute("aria-pressed")) === "true", "the demonstration loops by default");
        await sheet.getByRole("button", { name: /^(Pause|Play) demonstration$/ }).click();
      } else {
        t.expect(await unloaded.count() > 0, "without its photos the demonstration says they could not be loaded");
        t.note("demonstration photos blocked by the harness (outside host)");
      }
      t.expect((await sheet.getByRole("link", { name: "AI Form Check" }).count()) <= 1, "at most one AI Form Check entry beside the demonstration");
      await t.checkpoint("home exercise demonstration", { fullPage: false });
      await sheet.getByRole("button", { name: "Back" }).click();
      await sheet.waitFor({ state: "detached", timeout: 5000 });
    });

    await t.step("the mode carries over to a reload and the library; arrow keys switch tabs", async () => {
      await t.goto("/workouts", { label: "workouts reload" });
      await tabs(page, "Workout mode").waitFor({ timeout: 20000 });
      t.expect((await tabs(page, "Workout mode").getByRole("tab", { name: "Home" }).getAttribute("aria-selected")) === "true", "Home is remembered on this device");
      await t.goto("/exercises", { label: "library home" });
      const library = tabs(page, "Exercise library mode");
      await library.waitFor({ timeout: 20000 });
      await page.waitForFunction(() => new URL(location.href).searchParams.get("context") === "home", null, { timeout: 10000 });
      t.expect((await library.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")) === "true", "the library opens on Home too");
      await page.getByRole("group", { name: "Focus areas" }).getByRole("button", { name: /^Legs/ }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("focus") === "legs");
      await t.checkpoint("library home legs");
      await library.getByRole("tab", { name: "Home" }).focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => !new URL(location.href).searchParams.has("context"), null, { timeout: 10000 });
      t.expect((await library.getByRole("tab", { name: "Gym" }).getAttribute("aria-selected")) === "true", "ArrowRight selects Gym");
      const midSlide = await overflow(page);
      t.expect(fits(midSlide), "the sliding panel never widens the page", { midSlide });
      t.expect(await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement?.textContent?.includes("Gym")), "focus moves with the selection");
      await t.checkpoint("library gym");
    });

    await t.step("768 px: tabs, setup and the home collection fit", async () => {
      const original = page.viewportSize();
      await page.setViewportSize({ width: 768, height: 1024 });
      await t.goto("/workouts?mode=home", { label: "workouts 768" });
      await page.getByRole("heading", { name: "Home exercises" }).waitFor({ timeout: 20000 });
      const sideways = await overflow(page);
      t.expect(fits(sideways), "no sideways scroll at 768 px", { sideways });
      await t.checkpoint("workouts home 768");
      await t.goto("/exercises", { label: "library 768" });
      await tabs(page, "Exercise library mode").waitFor({ timeout: 20000 });
      await t.checkpoint("library 768");
      if (original) await page.setViewportSize(original);
    });

    await t.step("change the setup later: gym only", async () => {
      await t.goto("/workouts", { label: "workouts change setup" });
      await page.getByRole("button", { name: "Workout setup" }).click();
      const sheet = page.getByRole("dialog", { name: "Workout setup" });
      await sheet.getByRole("group", { name: "Where you train" }).getByRole("button", { name: "Gym" }).click();
      await sheet.getByRole("button", { name: "Next" }).click();
      await sheet.getByRole("group", { name: "Gym equipment" }).waitFor();
      await sheet.getByRole("button", { name: "Next" }).click();
      await sheet.getByRole("button", { name: "Save setup" }).click();
      await sheet.waitFor({ state: "detached", timeout: 15000 });
      const prefs = await standin.one(`select workout_location from public.user_preferences where user_id = '${account.id}'`);
      t.expect(prefs?.workout_location === "gym", "the new answer is saved", prefs);
    });
  },
};
