// Flow 19: the Nutrition first-time setup. A member who has not answered the food questions (onboarding no longer
// asks them) opens Nutrition: the setup opens; Later closes it and it stays closed on this device; once the device's
// Later is cleared it opens again, and diet (with its picture), an allergy, a food rule, meals a day, food source and
// nutrition goal are saved to their preference columns with nutrition_setup_at. It is never asked again; Food
// preferences edits the answers later, and the Log food filter follows the diet. (The water-goal link's target,
// /progress?panel=goals&new=water_day, is covered by flow 04 and tests/nutrition/setup.test.ts: every stand-in
// account has a saved water goal, so the link itself does not show here.)
import { signInUi } from "./common.mjs";

async function setupDialog(page, name = "Set up Nutrition") {
  const dialog = page.getByRole("dialog", { name });
  await dialog.waitFor({ timeout: 20000 });
  return dialog;
}

export const flow = {
  id: "19-nutrition-setup",
  title: "Nutrition first-time setup: asked once, Later, saved answers, edited from Food preferences",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Anjali Menon", tag: "nutrition-setup" });
    // A member from the new short onboarding: no food answers yet.
    await standin.sql(`update public.user_preferences set diet_type = null, dietary_preferences = '{}' where user_id = '${account.id}'`);
    await signInUi(t, account);

    await t.step("the setup opens on the first visit, and Later puts it off on this device", async () => {
      await t.goto("/nutrition", { label: "nutrition first visit" });
      const dialog = await setupDialog(page);
      const images = await dialog.locator("img").evaluateAll((items) => items.map((item) => item.getAttribute("src") ?? ""));
      t.note("diet pictures", images);
      t.expect(images.length === 4 && images.every((src) => /diet-/.test(src)), "each diet has its picture", images);
      await t.checkpoint("nutrition setup diet", { fullPage: false });
      await dialog.getByRole("button", { name: "Later" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await t.goto("/nutrition", { label: "after later" });
      await page.getByRole("heading", { name: /^Meals/ }).waitFor({ timeout: 15000 });
      await t.settle(1500);
      t.expect(!(await page.getByRole("dialog", { name: "Set up Nutrition" }).isVisible().catch(() => false)), "Later holds after a reload");
    });

    await t.step("answered once, every answer is saved", async () => {
      await page.evaluate(() => window.localStorage.removeItem("fitx-nutrition-setup-later"));
      await t.goto("/nutrition", { label: "setup again" });
      const dialog = await setupDialog(page);
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("alert").waitFor({ timeout: 5000 });
      t.expect(/closest to how you eat/.test(await dialog.getByRole("alert").innerText()), "the diet is the one required answer");
      await dialog.getByText("No meat, fish or eggs").click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByText("Peanuts", { exact: true }).click();
      await dialog.getByText("Jain", { exact: true }).click();
      await dialog.getByRole("textbox", { name: "A food you dislike" }).fill("Bitter gourd");
      await dialog.getByRole("button", { name: "Add", exact: true }).last().click();
      await t.checkpoint("nutrition setup avoid", { fullPage: false });
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByText("4", { exact: true }).click();
      await dialog.getByText("Home-cooked", { exact: true }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByText("High protein", { exact: true }).click();
      await t.checkpoint("nutrition setup goal", { fullPage: false });
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const row = await standin.one(`select diet_type, allergies, food_rules, food_dislikes, meals_per_day, food_source, nutrition_focus, dietary_preferences,
        nutrition_setup_at is not null as stamped from public.user_preferences where user_id = '${account.id}'`);
      t.note("saved answers", row);
      t.expect(row.diet_type === "vegetarian" && /Vegetarian/.test(String(row.dietary_preferences)), "the diet, with the old label kept in step", row);
      t.expect(/peanuts/.test(String(row.allergies)) && /jain/.test(String(row.food_rules)) && /Bitter gourd/.test(String(row.food_dislikes)), "allergy, rule and dislike", row);
      t.expect(Number(row.meals_per_day) === 4 && row.food_source === "home" && row.nutrition_focus === "high_protein", "meals, food source and goal", row);
      t.expect(row.stamped === true || row.stamped === "t", "nutrition_setup_at is set", row);
    });

    await t.step("never asked again; the Log food filter follows the diet", async () => {
      await t.goto("/nutrition", { label: "after setup" });
      await page.getByRole("heading", { name: /^Meals/ }).waitFor({ timeout: 15000 });
      await t.settle(1500);
      t.expect(!(await page.getByRole("dialog", { name: "Set up Nutrition" }).isVisible().catch(() => false)), "a member who answered is not asked again");
      await page.getByRole("button", { name: "Log food", exact: true }).click();
      await page.getByRole("dialog", { name: "Log food" }).waitFor({ timeout: 10000 });
      t.expect(await page.getByLabel("Hide non-veg").isChecked(), "a vegetarian starts with non-veg foods hidden");
      await page.getByRole("dialog", { name: "Log food" }).getByRole("button", { name: "Close", exact: true }).click();
    });

    await t.step("Food preferences edits the answers later", async () => {
      await page.getByRole("button", { name: "Food preferences" }).click();
      const dialog = await setupDialog(page, "Food preferences");
      t.expect(await dialog.getByRole("radio", { name: /^Vegetarian/ }).isChecked(), "the saved diet is chosen");
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByText("3", { exact: true }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const row = await standin.one(`select meals_per_day, diet_type, nutrition_focus from public.user_preferences where user_id = '${account.id}'`);
      t.note("after editing", row);
      t.expect(Number(row.meals_per_day) === 3 && row.diet_type === "vegetarian" && row.nutrition_focus === "high_protein", "only the changed answer changes", row);
    });
  },
};
