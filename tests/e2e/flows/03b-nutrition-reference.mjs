// Flow 3b: the reference-spec nutrition journey. "curd" finds plain yogurt (not cottage cheese) and offers ml and katori
// (a clearly labelled estimate), a meal is logged into a section the member named, the overview says how many calories
// are left (or asks for a target), and the History tab shows the day as logged. Not run by the build stream; the
// integration pass runs it with the other flows.
import { signInUi, textOf } from "./common.mjs";

function addPanel(page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Add to log", exact: true }) }).first();
}

export const flow = {
  id: "03b-nutrition-reference",
  title: "Nutrition: curd, katori estimate, own meal section, calories left, history",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Nair", tag: "nutrition-ref", prefs: { diet_type: "vegetarian", dietary_preferences: ["Vegetarian"] } });
    await signInUi(t, account);
    await t.goto("/nutrition", { label: "nutrition" });

    await t.step("\"curd\" selects plain yogurt and offers ml and katori", async () => {
      await page.getByRole("textbox", { name: "Search foods" }).fill("curd");
      await page.getByRole("button", { name: "Search food" }).click();
      await page.getByText("Loading foods…").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
      await t.settle(2000);
      const panel = addPanel(page);
      const name = (await panel.locator("p").first().innerText()).trim();
      t.note("curd selected", name);
      t.expect(/yogurt/i.test(name) && !/cottage/i.test(name), `curd should select plain yogurt (${name})`);
      const units = await panel.getByRole("combobox", { name: "Unit", exact: true }).locator("option").allInnerTexts();
      t.expect(units.some((unit) => /^1 ml/.test(unit)) && units.some((unit) => /katori/.test(unit)), "ml and katori should be offered", units);
      await t.checkpoint("curd selected");
    });

    await t.step("a katori is a labelled portion estimate and can be logged", async () => {
      const panel = addPanel(page);
      const unit = panel.getByRole("combobox", { name: "Unit", exact: true });
      const katori = await unit.locator("option").evaluateAll((items) => items.find((item) => /katori/.test(item.textContent ?? ""))?.value ?? null);
      t.expect(Boolean(katori), "a katori option should exist");
      await unit.selectOption(katori);
      await panel.getByText("Portion estimate").first().waitFor({ timeout: 5000 });
      await panel.getByRole("button", { name: "Increase amount" }).click();
      t.expect((await panel.getByRole("spinbutton", { name: "Amount", exact: true }).inputValue()) === "1.5", "the stepper should move a katori by half");
      await t.checkpoint("katori estimate");
    });

    await t.step("a meal section the member names holds the entry", async () => {
      const panel = addPanel(page);
      await panel.getByRole("combobox", { name: "Meal", exact: true }).selectOption({ label: "Add a meal…" });
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Meal name").fill("Pre-workout");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      await panel.getByRole("button", { name: "Add to log" }).click();
      await t.settle(2000);
      const rows = await standin.sql(`select meal, protein, fat from public.meals where user_id = '${account.id}'`);
      t.note("logged rows", rows);
      t.expect(rows.length === 1 && rows[0].meal === "Pre-workout", "the entry should sit in the member's own section", rows);
      await page.getByRole("button", { name: "Meals", exact: true }).click();
      await page.getByRole("heading", { name: /Pre-workout/ }).waitFor({ timeout: 10000 });
      await t.checkpoint("own meal section");
    });

    await t.step("the overview says what is left, or asks for a target", async () => {
      const overview = await textOf(page.locator("section[aria-label^='Nutrition summary']"));
      t.note("overview", overview.slice(0, 400));
      t.expect(/kcal (left|over your target)|Set a target to see/.test(overview), "calories left (or a prompt to set a target) should show", overview);
    });

    await t.step("History shows the day logged and averages over logged days", async () => {
      await page.getByRole("button", { name: "History", exact: true }).click();
      await page.getByRole("heading", { name: "History", exact: true }).waitFor({ timeout: 15000 });
      const text = await textOf(page.locator("section[aria-labelledby='history-title']"));
      t.note("history", text.slice(0, 500));
      t.expect(/Days logged\s*1\s*of 7/.test(text), "one logged day of seven should show", text);
      await page.getByRole("button", { name: "30 days" }).click();
      await t.checkpoint("history 30 days");
    });
  },
};
