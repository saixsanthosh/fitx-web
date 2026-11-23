// Flow 13: Exercise discovery. The Home and Gym tabs switch the library's place and its equipment. An older single-value link (?muscle=chest) opens filtered and its chip removes the
// filter; smart search finds the bench press from "benchpress" and the push-up from "press-up"; a focus area plus
// "No equipment" at home puts what the member can do first and offers "Try instead" and "Add anyway" for the rest;
// "Only show what I can do" hides the rest; an exercise is saved and the Saved filter shows it; Browse by muscle
// explains the lats and links to their exercises in the library.
import { signInUi } from "./common.mjs";

const query = (page) => new URL(page.url()).searchParams;

export const flow = {
  id: "13-exercise-discovery",
  title: "Exercise library: chips, smart search, focus and equipment, saved, browse by muscle",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "discovery", homeEquipment: ["dumbbell", "resistance_band"] });
    await signInUi(t, account);
    const results = () => page.getByRole("heading", { level: 2, name: /^\d[\d,]* exercises?$/ });

    await t.step("an older single-value link opens filtered, and its chip removes the filter", async () => {
      await t.goto("/exercises?muscle=chest", { label: "library chest link" });
      await results().waitFor({ timeout: 20000 });
      const chip = page.getByRole("button", { name: "Remove filter: Muscle Chest" });
      await chip.waitFor();
      t.expect(query(page).get("muscle") === "chest", `the link keeps muscle=chest, got ${page.url()}`);
      await t.checkpoint("library filtered by chest");
      await chip.click();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has("muscle"));
      t.expect(!(await chip.count()), "the chip is gone once removed");
    });

    await t.step("smart search: benchpress, bp and press-up find the right exercises", async () => {
      const box = page.getByRole("main").getByRole("searchbox", { name: "Search exercises" });
      await box.fill("benchpress");
      await page.getByRole("link", { name: "Barbell Bench Press", exact: true }).first().waitFor({ timeout: 15000 });
      await box.fill("bp");
      await page.getByRole("link", { name: "Dumbbell Bench Press", exact: true }).first().waitFor({ timeout: 15000 });
      await box.fill("press-up");
      await page.getByRole("link", { name: "Push-Up", exact: true }).first().waitFor({ timeout: 15000 });
      await box.press("Enter");
      await t.checkpoint("search for press-up");
      await box.fill("");
      await page.getByRole("button", { name: "press-up", exact: true }).waitFor({ timeout: 10000 });
      t.note("recent search kept on this device");
    });

    await t.step("a focus area and no equipment at home: what the member can do first, alternatives for the rest", async () => {
      await page.getByRole("group", { name: "Focus areas" }).getByRole("button", { name: /^Chest/ }).click();
      // Home and Gym are the tabs at the top of the library (phase 12).
      const homeTab = page.getByRole("tablist", { name: "Exercise library mode" }).getByRole("tab", { name: "Home" });
      await homeTab.click();
      t.expect((await homeTab.getAttribute("aria-selected")) === "true", "the Home tab is selected");
      // On phones the equipment is one sideways row, like Focus, so it does not push the results a screen down.
      const equipment = page.getByRole("group", { name: "Equipment you have" });
      if ((page.viewportSize()?.width ?? 1440) < 640) {
        const shape = await equipment.evaluate((group) => ({ height: Math.round(group.getBoundingClientRect().height), page: document.documentElement.scrollWidth, view: window.innerWidth }));
        t.note("equipment on a phone", shape);
        t.expect(shape.height <= 130, "the equipment tiles should be a single row on a phone", shape);
        t.expect(shape.page <= shape.view, "the equipment row must not make the page scroll sideways", shape);
      }
      await page.getByRole("group", { name: "Equipment you have" }).getByRole("button", { name: "No equipment" }).click();
      await page.waitForFunction(() => {
        const params = new URL(location.href).searchParams;
        return params.get("focus") === "chest" && params.get("context") === "home" && params.get("have") === "none";
      }, null, { timeout: 10000 });
      await results().waitFor();
      const cards = page.locator("section[aria-labelledby=exercise-results] article");
      await cards.first().waitFor();
      t.expect(!(await cards.first().getByText(/^Needs:/).count()), "the first result needs no equipment");
      const needing = cards.filter({ hasText: "Needs:" }).first();
      // Everything the member can do comes first; exercises that need equipment follow, perhaps on a later page.
      for (let attempt = 0; attempt < 4 && !(await needing.count()); attempt += 1) {
        const more = page.getByRole("button", { name: "Show more exercises" });
        if (!(await more.count())) break;
        await more.click();
      }
      await needing.waitFor({ timeout: 10000 });
      t.expect(await needing.getByRole("link", { name: /^Add anyway/ }).count(), "an exercise you cannot do keeps an explicit Add anyway");
      await t.checkpoint("chest at home with no equipment");
    });

    await t.step("only what I can do hides the exercises that need equipment", async () => {
      const toggle = page.getByRole("switch", { name: "Only show what I can do" });
      await toggle.click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("doable") === "1");
      await results().waitFor();
      await page.waitForTimeout(400);
      t.expect(!(await page.locator("section[aria-labelledby=exercise-results] article").filter({ hasText: "Needs:" }).count()), "no card says Needs: with only what I can do");
      await t.checkpoint("only what I can do");
    });

    await t.step("saving an exercise; the Saved filter shows it", async () => {
      const save = page.locator("section[aria-labelledby=exercise-results]").getByRole("button", { name: /^Save / }).first();
      const label = await save.getAttribute("aria-label");
      const name = (label ?? "").replace(/^Save /, "");
      await save.click();
      await page.getByRole("button", { name: `Remove ${name} from saved exercises` }).first().waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: /^Saved/ }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("saved") === "1");
      await page.getByRole("link", { name, exact: true }).first().waitFor({ timeout: 10000 });
      await t.checkpoint("saved exercises");
    });

    await t.step("browse by muscle: the lats, what they do, and their exercises in the library", async () => {
      await t.goto("/exercises/muscles", { label: "browse by muscle" });
      await page.getByRole("heading", { level: 1, name: "Browse by muscle" }).waitFor();
      await page.locator("section[aria-labelledby=list-title]").getByRole("button", { name: /^Lats/ }).click();
      await page.getByRole("heading", { level: 2, name: "Lats" }).waitFor({ timeout: 10000 });
      await page.getByText("Latissimus dorsi").waitFor();
      t.expect(query(page).get("muscle") === "lats", `the choice is in the URL, got ${page.url()}`);
      await t.checkpoint("lats");
      const link = page.getByRole("link", { name: /^See all \d+ in the library/ });
      await link.waitFor({ timeout: 15000 });
      await link.click();
      await page.waitForURL((url) => url.pathname === "/exercises" && url.searchParams.get("muscle") === "lats");
      await page.getByRole("button", { name: "Remove filter: Muscle Lats" }).waitFor({ timeout: 15000 });
      await t.checkpoint("library filtered by lats");
    });
  },
};
