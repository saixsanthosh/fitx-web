// Flow 7: Home workout (the camera form coach, formerly /form-coach) opens with its explainer (on-device, 2D
// camera, not medical advice), an exercise opens the camera set-up card, starting the camera without permission
// ends in an honest explanation, and an old /form-coach?exercise= link lands on the same exercise here.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "07-form-coach",
  title: "Home workout explainer, camera permission and the old Form coach address",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Dev Patel", tag: "formcoach" });
    await signInUi(t, account);

    await t.step("the page explains what the camera does", async () => {
      await t.goto("/home-workout", { label: "home workout" });
      t.expect(new URL(page.url()).pathname === "/home-workout", `Home workout should open at /home-workout (${page.url()})`);
      const title = await page.locator("main h1").first().innerText();
      t.expect(title.trim() === "Home workout", `the page title should be Home workout (got ${title})`);
      const facts = await textOf(page.locator("section[aria-label='How the form coach works']"));
      t.note("explainer", facts);
      t.expect(/Stays on your device/.test(facts) && /never uploaded/.test(facts), "the on-device promise should be stated");
      t.expect(/Not medical advice/.test(facts), "the medical disclaimer should be stated");
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      t.expect((await choices.count()) >= 6, `six exercises should be offered (got ${await choices.count()})`);
      await t.checkpoint("home workout picker");
    });

    await t.step("an exercise opens the camera set-up card", async () => {
      await page.locator("section[aria-labelledby=coach-pick-title] a").first().click();
      await page.getByText("Set up your camera").waitFor();
      t.expect(/^\/home-workout$/.test(new URL(page.url()).pathname) && /[?&]exercise=/.test(page.url()), `the exercise should be kept in the address (${page.url()})`);
      const setup = await textOf(page.locator("main"));
      t.expect(/video is never uploaded or recorded/.test(setup), "the set-up card should repeat the privacy promise");
      await t.checkpoint("camera set-up card");
    });

    await t.step("starting the camera without permission explains what to do", async () => {
      await page.getByRole("button", { name: "Start camera" }).click();
      const retry = page.getByRole("button", { name: "Try again" });
      await retry.waitFor({ timeout: 15000 });
      const help = await textOf(page.locator("main"));
      t.note("camera problem text", help.slice(0, 900));
      await t.checkpoint("camera blocked explanation");
    });

    await t.step("an old Form coach link opens the same exercise in Home workout", async () => {
      const response = await t.goto("/form-coach?exercise=bodyweight_squat", { label: "old form coach link" });
      const url = new URL(page.url());
      t.expect(url.pathname === "/home-workout" && url.searchParams.get("exercise") === "bodyweight_squat", `expected /home-workout?exercise=bodyweight_squat, got ${url.pathname}${url.search}`);
      t.expect(response && response.status() < 400, `the redirected page answered ${response?.status()}`);
      await page.getByText("Set up your camera").waitFor();
      await t.checkpoint("old form coach link in home workout");
    });
  },
};
