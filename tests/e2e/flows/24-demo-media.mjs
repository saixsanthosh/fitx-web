// Flow 24: FITX's AI demonstrations (wave 2, D6). The demonstration index and its files are stood in for by this flow
// alone (page routes serving a fixture index and small local PNGs at the demo paths, male and female, start and end),
// so nothing fake is ever committed: the library card and the exercise page show the member's chosen model, the
// caption changes with the frame, the honest label is shown, "Demonstration model" switches person and is saved, and
// an exercise with no demonstration keeps the Free Exercise DB photos (the fallback) with no model choice.
import { makePng } from "../support/png.mjs";
import { signInUi, textOf } from "./common.mjs";

const EXERCISE = "bench_press";
const NAME = "Barbell Bench Press";
const OTHER = "dumbbell_bench_press";
const LABEL = "AI demonstration made from a real photo of the movement";
const CAPTIONS = ["Set the bench and secure your feet.", "Lower the bar under control to the mid chest."];
const frame = (model, n) => `/media/demos/${model}/${EXERCISE}/${n}.webp`;
const INDEX = {
  version: 1,
  items: { [EXERCISE]: Object.fromEntries(["male", "female"].map((model) => [model, { frames: [frame(model, 0), frame(model, 1)], captions: CAPTIONS }])) },
  credit: { attribution: "FITX demonstration (AI image made with Google Gemini from a Free Exercise DB photo)", license: "FITX" },
};
// Stand-in pictures: a different gradient for each model and frame, so a screenshot shows which one is on screen.
const PICTURES = {
  [frame("male", 0)]: makePng(400, 300, [40, 70, 120], [120, 160, 210]),
  [frame("male", 1)]: makePng(400, 300, [30, 90, 90], [110, 190, 180]),
  [frame("female", 0)]: makePng(400, 300, [120, 50, 70], [220, 150, 160]),
  [frame("female", 1)]: makePng(400, 300, [110, 80, 30], [230, 190, 120]),
};

async function standInDemos(page) {
  await page.route("**/media/demos/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/media/demos/index.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    const picture = PICTURES[pathname];
    return picture ? route.fulfill({ status: 200, contentType: "image/png", body: picture }) : route.fulfill({ status: 404, body: "" });
  });
}

export const flow = {
  id: "24-demo-media",
  title: "AI demonstrations: the chosen model on the card and the page, captions per frame, honest label, fallback",
  sizes: ["phone", "tablet", "desktop"],
  async run(t, { standin }) {
    const page = await t.open();
    await standInDemos(page);
    const account = await standin.createAccount({ name: "Asha Menon", tag: "demos", prefs: { workout_location: "gym", fitness_level: "intermediate" } });
    await standin.sql(`update public.user_preferences set demo_model = 'female' where user_id = '${account.id}'`);
    await signInUi(t, account);
    const demoSrc = (scope) => scope.locator("img[src*='/media/demos/']").evaluateAll((images) => images.map((image) => image.getAttribute("src")));

    await t.step("the library card shows the member's model's start frame, marked as an AI demo", async () => {
      await t.goto("/exercises", { label: "library" });
      const box = page.getByRole("main").getByRole("searchbox", { name: "Search exercises" });
      await box.waitFor({ timeout: 20000 });
      await box.fill("bench press");
      const card = page.locator("article", { has: page.getByRole("link", { name: NAME, exact: true }) }).first();
      await card.waitFor({ timeout: 20000 });
      await card.locator(`img[src='${frame("female", 0)}']`).waitFor({ timeout: 15000 });
      t.expect(/AI demo/.test(await textOf(card)), "the card says it is an AI demonstration");
      const other = page.locator("article", { has: page.getByRole("link", { name: "Dumbbell Bench Press", exact: true }) }).first();
      if (await other.count()) t.expect((await demoSrc(other)).length === 0, "an exercise without a demonstration keeps its photo");
      await t.checkpoint("library card with the female demonstration");
    });

    await t.step("the exercise page: the chosen model, the honest label, and a caption for each frame", async () => {
      await t.goto(`/exercises/${EXERCISE}`, { label: "exercise demonstration" });
      const figure = page.getByRole("figure", { name: `${NAME}: AI demonstration` });
      await figure.waitFor({ timeout: 20000 });
      await figure.getByText(LABEL, { exact: false }).waitFor();
      await figure.getByText("No verified video yet").waitFor();
      t.expect((await figure.getByText(/^Photos: FITX demonstration/).count()) === 1, "the credit names FITX's demonstration and its source");
      t.expect((await page.getByRole("radio", { name: "Female" }).isChecked()), "Female is the chosen model");
      const shown = await demoSrc(figure);
      t.expect(shown.length === 2 && shown.every((src) => src.includes("/female/")), `only the female frames are in the loop: ${shown.join(", ")}`);
      const caption = figure.locator("[data-demo-caption]");
      await page.getByRole("button", { name: "Show photo 1" }).click();
      t.expect((await caption.innerText()).trim() === CAPTIONS[0], `the start frame's caption: ${await caption.innerText()}`);
      t.expect((await caption.getAttribute("aria-live")) === "polite", "paused: the caption is read out");
      await page.getByRole("button", { name: "Show photo 2" }).click();
      await page.waitForFunction((text) => document.querySelector("[data-demo-caption]")?.textContent?.trim() === text, CAPTIONS[1], { timeout: 5000 });
      t.expect(true, "the caption changed with the frame");
      await t.checkpoint("exercise page, female demonstration, end frame");
    });

    await t.step("Demonstration model: Male switches the person at once and is saved", async () => {
      const group = page.getByRole("radiogroup", { name: "Demonstration model" });
      await group.getByRole("radio", { name: "Male" }).check();
      const figure = page.getByRole("figure", { name: `${NAME}: AI demonstration` });
      await figure.locator(`img[src='${frame("male", 0)}']`).waitFor({ timeout: 10000 });
      const shown = await demoSrc(figure);
      t.expect(shown.every((src) => src.includes("/male/")), `never two people in one loop: ${shown.join(", ")}`);
      let stored = null;
      for (let i = 0; i < 20 && stored !== "male"; i += 1) {
        stored = (await standin.one(`select demo_model from public.user_preferences where user_id = '${account.id}'`))?.demo_model ?? null;
        if (stored !== "male") await page.waitForTimeout(250);
      }
      t.expect(stored === "male", `the choice is saved (got ${stored})`);
      await t.checkpoint("exercise page, male demonstration");
      await t.goto("/exercises", { label: "library after the switch" });
      const box = page.getByRole("main").getByRole("searchbox", { name: "Search exercises" });
      await box.fill("bench press");
      const card = page.locator("article", { has: page.getByRole("link", { name: NAME, exact: true }) }).first();
      await card.locator(`img[src='${frame("male", 0)}']`).waitFor({ timeout: 20000 });
      t.expect(true, "the library card follows the saved choice");
    });

    await t.step("an exercise with no demonstration keeps the Free Exercise DB photos and offers no model choice", async () => {
      await t.goto(`/exercises/${OTHER}`, { label: "exercise without a demonstration" });
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20000 });
      await page.waitForTimeout(500);
      t.expect((await demoSrc(page.getByRole("main"))).length === 0, "no demonstration file is shown");
      t.expect((await page.getByRole("radiogroup", { name: "Demonstration model" }).count()) === 0, "no model choice");
      t.expect((await page.getByText(LABEL).count()) === 0, "no AI label on real photos");
      // The harness blocks outside hosts, so the public-domain photos may not load: then the page says so honestly.
      const photos = await page.getByRole("figure", { name: /photo demonstration$/ }).count();
      const unloaded = await page.getByText("The photos could not be loaded").count();
      t.expect(photos + unloaded > 0, "the real photos, or the honest message when they cannot load");
      await t.checkpoint("exercise without a demonstration");
    });
  },
};
