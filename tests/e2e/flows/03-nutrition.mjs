// Flow 3: Nutrition for a vegetarian. Quantity searches ("3 idlis", "150 g rice", "2 samosas") pick the amount and
// unit, a size switch changes the numbers, each is logged; recent foods come back first; "Hide foods marked non-veg"
// is on and hides chicken; a custom food is saved with a photo; today becomes a routine applied to tomorrow; own
// targets are saved; and a barcode lookup with the internet blocked says Open Food Facts couldn't be reached.
import { kolkataDate, signInUi, textOf } from "./common.mjs";
import { makePng } from "../support/png.mjs";

function addPanel(page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Add to log", exact: true }) }).first();
}

async function search(t, text) {
  const page = t.page;
  await page.getByRole("textbox", { name: "Search foods" }).fill(text);
  await page.getByRole("button", { name: "Search food" }).click();
  await page.waitForTimeout(300);
  await page.getByText("Loading foods…").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
  await t.settle(2000);
}

/** The food in the Add to log panel: picks the first result when the search did not choose one. */
async function selectedFood(t) {
  const page = t.page;
  const panel = addPanel(page);
  if (await panel.getByText("Choose a food").isVisible().catch(() => false)) {
    await page.locator("div[aria-live=polite] button[aria-pressed]").first().click();
  }
  await panel.getByRole("spinbutton", { name: "Amount", exact: true }).waitFor({ timeout: 10000 });
  const unit = panel.getByRole("combobox", { name: "Unit", exact: true });
  return {
    name: (await panel.locator("p").first().innerText()).trim(),
    amount: await panel.getByRole("spinbutton", { name: "Amount", exact: true }).inputValue(),
    unit: await unit.locator("option:checked").innerText().catch(() => null),
    units: await unit.locator("option").allInnerTexts().catch(() => []),
    numbers: await textOf(panel.locator("[aria-label='Nutrition for this amount']")).catch(() => ""),
  };
}

async function logSelected(t, meal) {
  const panel = addPanel(t.page);
  await panel.getByRole("combobox", { name: "Meal", exact: true }).selectOption(meal);
  await panel.getByRole("button", { name: "Add to log" }).click();
  await t.page.waitForTimeout(400);
  await t.settle(2000);
}

export const flow = {
  id: "03-nutrition",
  title: "Nutrition: quantity search, sizes, log, custom food photo, routine, targets, veg filter, barcode offline",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Priya Raman", tag: "nutrition", prefs: { diet_type: "vegetarian", dietary_preferences: ["Vegetarian"] } });
    const today = kolkataDate();
    const tomorrow = kolkataDate(1);
    await signInUi(t, account);

    await t.step("Nutrition opens on Log food with the vegetarian filter on", async () => {
      await t.goto("/nutrition", { label: "nutrition" });
      await page.getByRole("textbox", { name: "Search foods" }).waitFor();
      const nonVeg = page.getByLabel("Hide foods marked non-veg");
      const egg = page.getByLabel("Hide foods marked egg");
      t.expect(await nonVeg.isChecked(), "a vegetarian should start with non-veg foods hidden");
      t.note("egg filter starts", await egg.isChecked());
      await t.checkpoint("nutrition log food");
    });

    await t.step("\"3 idlis\" picks 3 pieces of idli", async () => {
      await search(t, "3 idlis");
      const food = await selectedFood(t);
      t.note("3 idlis", food);
      t.expect(/idli/i.test(food.name), `the selected food should be idli (${food.name})`);
      t.expect(Number(food.amount) === 3, `the amount should be 3 (${food.amount})`);
      await t.checkpoint("3 idlis selected");
      await logSelected(t, "Breakfast");
    });

    await t.step("\"150 g rice\" picks 150 grams of rice", async () => {
      await search(t, "150 g rice");
      const food = await selectedFood(t);
      t.note("150 g rice", food);
      t.expect(/rice/i.test(food.name), `the selected food should be rice (${food.name})`);
      t.expect(Number(food.amount) === 150 && /^g\b|gram/i.test(food.unit ?? ""), `150 g should be selected (${food.amount} ${food.unit})`);
      await logSelected(t, "Lunch");
    });

    await t.step("\"2 samosas\", then switching the size changes the numbers", async () => {
      await search(t, "2 samosas");
      const food = await selectedFood(t);
      t.note("2 samosas", food);
      t.expect(/samosa/i.test(food.name) && Number(food.amount) === 2, `2 samosas should be selected (${food.name}, ${food.amount})`);
      const unit = addPanel(page).getByRole("combobox", { name: "Unit", exact: true });
      const options = await unit.locator("option").evaluateAll((items) => items.map((item) => ({ value: item.value, label: item.textContent, selected: item.selected })));
      const other = options.find((option) => !option.selected && !/^g$|gram/i.test(option.label ?? "")) ?? options.find((option) => !option.selected);
      t.expect(Boolean(other), "another size should be offered", options);
      await unit.selectOption(other.value);
      await page.waitForTimeout(300);
      const after = await selectedFood(t);
      t.note("after switching size", { from: food.numbers, to: after.numbers, unit: after.unit });
      t.expect(after.numbers !== food.numbers, "switching the size should change the numbers", { before: food.numbers, after: after.numbers });
      await t.checkpoint("samosa size switched");
      await logSelected(t, "Snack");
      const logged = await standin.sql(`select meal, food_name, round(calories)::int kcal, quantity_grams::text grams, servings::text, source from public.meals where user_id = '${account.id}' and date = '${today}' order by created_at`);
      t.note("logged today", logged);
      t.expect(logged.length === 3, `three foods should be logged today (${logged.length})`, logged);
      t.expect(logged.every((row) => Number(row.kcal) > 0), "every logged food should carry calories", logged);
    });

    await t.step("recent foods come back first", async () => {
      await t.goto("/nutrition", { label: "recent foods" });
      await page.getByText("Recent", { exact: true }).waitFor({ timeout: 15000 });
      const recent = await textOf(page.locator("div[aria-live=polite]"));
      t.note("recent list", recent.slice(0, 500));
      t.expect(/idli/i.test(recent) && /samosa/i.test(recent) && /rice/i.test(recent), "the three logged foods should be listed as recent");
      await t.checkpoint("recent foods");
    });

    await t.step("Home and Nutrition agree on today's calories and the estimated target", async () => {
      await t.goto("/nutrition", { label: "nutrition estimate" });
      const overview = await textOf(page.locator("section[aria-label^='Nutrition summary']"));
      const nutrition = /([\d,]+)\s*\/\s*([\d,]+)\s*kcal/.exec(overview);
      await t.goto("/dashboard", { label: "home totals" });
      const today = page.locator("[data-widget=today]");
      await today.getByText("kcal").first().waitFor({ timeout: 15000 });
      const home = /Calories[^\d]*([\d,]+)\s*\/\s*([\d,]+)\s*kcal/.exec(await textOf(today));
      const num = (value) => Number(String(value ?? "").replace(/,/g, ""));
      t.note("calories: nutrition vs home", { nutrition: nutrition?.slice(1), home: home?.slice(1) });
      t.expect(nutrition && home, "both pages should show eaten / target kcal");
      t.expect(Math.abs(num(nutrition[1]) - num(home[1])) <= 1, `today's calories differ: Nutrition ${nutrition[1]} vs Home ${home[1]}`);
      t.expect(num(nutrition[2]) === num(home[2]), `the estimated calorie target differs: Nutrition ${nutrition[2]} vs Home ${home[2]}`);
      await t.checkpoint("home with logged food");
      await t.goto("/nutrition", { label: "back to nutrition" });
    }, { soft: true });

    await t.step("non-veg foods are hidden for a vegetarian", async () => {
      await search(t, "chicken curry");
      const list = await textOf(page.locator("div[aria-live=polite]"));
      t.note("chicken curry with the filter on", list.slice(0, 600));
      t.expect(/marked non-veg( or egg)? (is|are) hidden/.test(list), "the hidden count should be stated");
      await t.checkpoint("non-veg hidden");
      await page.getByLabel("Hide foods marked non-veg").uncheck();
      const shown = await textOf(page.locator("div[aria-live=polite]"));
      t.expect(/chicken/i.test(shown), "unticking the filter should show the chicken results", shown.slice(0, 300));
      await page.getByLabel("Hide foods marked non-veg").check();
    });

    await t.step("a custom food with a photo", async () => {
      await page.getByRole("button", { name: "Add your own food" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByLabel("Name", { exact: true }).fill("Amma's poha");
      await dialog.getByLabel("Serving (optional)").fill("1 bowl");
      await dialog.getByLabel("Serving weight (g)").fill("180");
      await dialog.getByLabel("Calories per serving").fill("250");
      await dialog.getByLabel("Protein (g)").fill("6");
      await dialog.getByLabel("Carbs (g)").fill("45");
      await dialog.getByLabel("Fat (g)").fill("5");
      await dialog.getByLabel("Photo (optional)").setInputFiles({ name: "poha.png", mimeType: "image/png", buffer: makePng() });
      await t.checkpoint("custom food form", { fullPage: false });
      await dialog.getByRole("button", { name: "Save food" }).click();
      await dialog.waitFor({ state: "detached", timeout: 20000 });
      const row = await standin.one(`select id, name, serving_grams::text, calories_per_100g::text, photo_path from public.custom_foods where user_id = '${account.id}'`).catch(async () => standin.one(`select * from public.custom_foods where user_id = '${account.id}'`));
      t.note("custom food row", row);
      const files = await standin.sql(`select name, metadata->>'mimetype' type, (metadata->>'size')::int size from storage.objects where name like '${account.id}/foods/%'`);
      t.note("food photo objects", files);
      t.expect(Boolean(row), "the custom food should be saved");
      t.expect(files.length === 1, "the photo should be uploaded under <user>/foods/", files);
      await page.getByRole("button", { name: "My foods" }).click();
      await page.getByText("Amma's poha").first().waitFor({ timeout: 10000 });
      const photo = page.locator("img[src*='/storage/v1/object/sign/']").first();
      await photo.waitFor({ timeout: 10000 });
      const loaded = await photo.evaluate((image) => image.complete && image.naturalWidth > 0);
      t.expect(loaded, "the food photo should load from a signed link");
      await t.checkpoint("my foods with photo");
    });

    await t.step("save today as a routine and add it to tomorrow", async () => {
      await page.getByRole("button", { name: "Meals", exact: true }).click();
      await page.getByRole("button", { name: "Save today as a routine" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Weekday routine");
      await dialog.getByRole("button", { name: /^Save/ }).click();
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      await page.getByRole("button", { name: "Next day" }).click();
      await page.getByRole("button", { name: "Routines", exact: true }).click();
      const routine = page.locator("li, article, div").filter({ hasText: "Weekday routine" }).filter({ has: page.getByRole("button", { name: /^Add to / }) }).last();
      await routine.getByRole("button", { name: /^Add to / }).click();
      await t.settle(2000);
      const rows = await standin.one(`select count(*)::int n from public.meals where user_id = '${account.id}' and date = '${tomorrow}'`);
      t.note("tomorrow after applying the routine", rows);
      t.expect(Number(rows.n) === 3, `the routine's three foods should be added to tomorrow (${rows.n})`);
      await t.checkpoint("routine applied to tomorrow");
      await page.getByRole("button", { name: "Previous day" }).click();
    });

    await t.step("own daily targets are saved and shown", async () => {
      await page.getByRole("button", { name: /Edit targets|Your targets/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^Calories/).fill("2000");
      await dialog.getByLabel(/^Protein/).fill("110");
      await dialog.getByLabel(/^Carbs/).fill("240");
      await dialog.getByLabel(/^Fat/).fill("60");
      await dialog.getByRole("button", { name: "Save targets" }).click();
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      const row = await standin.one(`select calories, protein_g, carbs_g, fat_g from public.nutrition_targets where user_id = '${account.id}'`);
      t.expect(row?.calories === "2000" && row.protein_g === "110", "the targets should be stored", row);
      await page.getByText("Targets you set").waitFor({ timeout: 15000 });
      const overview = await textOf(page.locator("section[aria-label^='Nutrition summary']"));
      t.note("overview with own targets", overview.slice(0, 500));
      t.expect(/2,000|2000/.test(overview), "the overview should use the 2,000 kcal target");
      await t.checkpoint("own targets");
      await t.goto("/dashboard", { label: "home with own targets" });
      const today = await textOf(page.locator("[data-widget=today]"));
      t.note("home today widget with own targets", today);
      t.expect(/2,000|2000/.test(today), "Home should use the 2,000 kcal target the member set");
      await t.goto("/nutrition", { label: "nutrition after targets" });
    });

    await t.step("a barcode lookup with the internet blocked says it couldn't be checked", async () => {
      await page.getByRole("button", { name: "Log food", exact: true }).click();
      await page.getByRole("textbox", { name: "Barcode number" }).fill("8901063010031");
      await page.getByRole("button", { name: "Find barcode" }).click();
      const message = page.getByText(/couldn.t be checked|didn.t answer|unavailable/i).first();
      await message.waitFor({ timeout: 30000 });
      const text = await message.innerText();
      t.note("barcode message", text);
      t.expect(!/No product with barcode/.test(await textOf(page.locator("main"))), "it must not claim the product doesn't exist");
      await t.checkpoint("barcode offline");
    });
  },
};
