// Flow 7: Home workout (the camera form coach, formerly /form-coach). The page states its promises (on-device, 2D
// camera, not medical advice) and offers at least twelve exercises, filterable by body area; an exercise opens with
// its looping demonstration and camera set-up; the coach voice can be Female, Male or Off and is remembered; starting
// the camera without permission ends in an honest explanation; and an old /form-coach?exercise= link lands on the same
// exercise here.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "07-home-workout",
  title: "Home workout exercises, demonstration, voice, camera permission and the old Form coach address",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Dev Patel", tag: "formcoach" });
    await signInUi(t, account);

    await t.step("the page explains what the camera does and offers the exercises", async () => {
      await t.goto("/home-workout", { label: "home workout" });
      t.expect(new URL(page.url()).pathname === "/home-workout", `Home workout should open at /home-workout (${page.url()})`);
      const title = await page.locator("main h1").first().innerText();
      t.expect(title.trim() === "Home workout", `the page title should be Home workout (got ${title})`);
      const facts = await textOf(page.locator("section[aria-label='How Home workout works']"));
      t.note("explainer", facts);
      t.expect(/Stays on your device/.test(facts) && /never uploaded/.test(facts), "the on-device promise should be stated");
      t.expect(/Not medical advice/.test(facts), "the medical disclaimer should be stated");
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      const total = await choices.count();
      t.expect(total >= 12, `at least twelve exercises should be offered (got ${total})`);
      await t.checkpoint("home workout picker");
    });

    await t.step("the exercises filter by body area", async () => {
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      const total = await choices.count();
      await page.getByRole("radiogroup", { name: "Show exercises for" }).getByRole("radio", { name: "Core" }).click();
      const core = await choices.count();
      const names = await choices.allInnerTexts();
      t.note("core exercises", names.join(" | ").replace(/\s+/g, " "));
      t.expect(core >= 3 && core < total, `Core should show a few of the exercises (${core} of ${total})`);
      t.expect(names.some((name) => /Plank/.test(name)), "Core should include the plank", names);
      await page.getByRole("radio", { name: "All" }).click();
      t.expect((await choices.count()) === total, "All should show every exercise again");
    });

    await t.step("an exercise opens its demonstration and camera set-up", async () => {
      await page.locator("section[aria-labelledby=coach-pick-title] a").first().click();
      await page.getByText("Set up your camera").waitFor();
      t.expect(/^\/home-workout$/.test(new URL(page.url()).pathname) && /[?&]exercise=/.test(page.url()), `the exercise should be kept in the address (${page.url()})`);
      const demo = page.getByRole("img", { name: /^How to do a/ });
      t.expect((await demo.count()) >= 1, "the exercise should open with its demonstration");
      const setup = await textOf(page.locator("main"));
      t.expect(/video is never uploaded or recorded/.test(setup), "the set-up should repeat the privacy promise");
      t.expect(/not medical advice/i.test(setup), "the set-up should say it is not medical advice");
      await t.checkpoint("exercise demonstration and set-up");
    });

    await t.step("the coach voice is Female, Male or Off, and is remembered", async () => {
      const voice = page.getByRole("radiogroup", { name: "Coach voice" });
      if ((await voice.count()) === 0) {
        t.note("coach voice", "this browser has no speech synthesis, so the voice choice is not shown");
        return;
      }
      for (const name of ["Female", "Male", "Off"]) t.expect((await voice.getByRole("radio", { name, exact: true }).count()) === 1, `the voice choice should offer ${name}`);
      await voice.getByRole("radio", { name: "Male", exact: true }).click();
      t.expect((await voice.getByRole("radio", { name: "Male", exact: true }).getAttribute("aria-checked")) === "true", "Male should be chosen");
      await page.reload();
      await page.getByText("Set up your camera").waitFor();
      const after = page.getByRole("radiogroup", { name: "Coach voice" }).getByRole("radio", { name: "Male", exact: true });
      t.expect((await after.getAttribute("aria-checked")) === "true", "the Male voice should be remembered after a reload");
    });

    await t.step("starting the camera without permission explains what to do", async () => {
      await page.getByRole("button", { name: "Start camera" }).click();
      const retry = page.getByRole("button", { name: "Try again" });
      await retry.waitFor({ timeout: 15000 });
      const help = await textOf(page.locator("main"));
      t.note("camera problem text", help.slice(0, 900));
      await t.checkpoint("camera blocked explanation");
    });

    await t.step("a newer exercise opens with its own demonstration", async () => {
      await t.goto("/home-workout?exercise=wall_sit", { label: "wall sit" });
      await page.getByText("Set up your camera").waitFor();
      t.expect(/Wall sit/.test(await page.locator("main h2").first().innerText()), "the wall sit should open");
      t.expect((await page.getByRole("img", { name: /^How to do a wall sit/ }).count()) === 1, "the wall sit should have its demonstration");
      await t.checkpoint("wall sit set-up");
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
