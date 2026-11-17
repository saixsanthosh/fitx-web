// Flow 7: the form coach opens with its explainer (on-device, 2D camera, not medical advice), an exercise opens
// the camera set-up card, and starting the camera without permission ends in an honest explanation.
import { signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "07-form-coach",
  title: "Form coach explainer and camera permission",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Dev Patel", tag: "formcoach" });
    await signInUi(t, account);

    await t.step("the page explains what the camera does", async () => {
      await t.goto("/form-coach", { label: "form coach" });
      const facts = await textOf(page.locator("section[aria-label='How the form coach works']"));
      t.note("explainer", facts);
      t.expect(/Stays on your device/.test(facts) && /never uploaded/.test(facts), "the on-device promise should be stated");
      t.expect(/Not medical advice/.test(facts), "the medical disclaimer should be stated");
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      t.expect((await choices.count()) >= 6, `six exercises should be offered (got ${await choices.count()})`);
      await t.checkpoint("form coach picker");
    });

    await t.step("an exercise opens the camera set-up card", async () => {
      await page.locator("section[aria-labelledby=coach-pick-title] a").first().click();
      await page.getByText("Set up your camera").waitFor();
      t.expect(/[?&]exercise=/.test(page.url()), `the exercise should be kept in the address (${page.url()})`);
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
  },
};
