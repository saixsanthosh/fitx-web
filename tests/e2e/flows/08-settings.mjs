// Flow 8: Settings. The account section, a theme choice saved to the account (kept after reload and adopted by
// a second device), the Help link, "Download my data" (every table FITX exports, the new ones included, plus the
// list of uploaded images), Log out, and "Delete my account": a session older than 15 minutes is asked to sign in
// again, then typing DELETE removes the login, every row and the uploaded files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kolkataDate, signInUi, textOf } from "./common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function seedExportData(standin, id) {
  const today = kolkataDate();
  await standin.sql(`
    insert into public.meals (user_id, date, meal, food_name, calories, protein, carbs, fat) values ('${id}', '${today}', 'Breakfast', 'Idli', 116, 3.8, 23.6, 0.4);
    insert into public.goals (user_id, title, category, metric, period, direction, target_value, unit, starts_on)
      values ('${id}', 'Eat 100 g of protein a day', 'nutrition', 'protein_g', 'daily', 'increase', 100, 'g', '${today}');
    insert into public.planner_events (user_id, event_type, title, local_date, status, sort_order) values ('${id}', 'task', 'Stretch for 10 minutes', '${today}', 'scheduled', 0);
    with r as (insert into public.support_requests (user_id, category, subject, body) values ('${id}', 'question', 'Export check', 'Does my export include this message?') returning id)
      insert into public.support_messages (request_id, author_id, author_kind, body) select r.id, '${id}', 'user', 'Does my export include this message?' from r;`);
}

export const flow = {
  id: "08-settings",
  title: "Settings: theme, Help, export, log out, delete account",
  schemes: () => ["light"],
  async run(t, { standin, appUrl, outDir }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Sana Qureshi", tag: "settings" });
    await seedExportData(standin, account.id);
    const uploaded = await standin.upload(await standin.passwordSession(account.email, account.password), "fitx-user-media", `${account.id}/avatar-e2e.png`, PNG, "image/png");
    t.note("uploaded test image", uploaded);
    await signInUi(t, account);

    await t.step("the account section shows the e-mail and sign-in method", async () => {
      await t.goto("/settings", { label: "settings" });
      const section = page.locator("section[aria-labelledby=settings-account]");
      await section.getByText(account.email).waitFor({ timeout: 15000 });
      t.expect((await textOf(section)).includes("Email and password"), "the sign-in method should read Email and password");
      await t.checkpoint("settings");
    });

    await t.step("a theme choice is saved to the account and kept after reload", async () => {
      await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Theme" }) }).locator("label").filter({ hasText: "Dark" }).click();
      await page.getByText("Saved. Your other devices will use it too.").waitFor({ timeout: 15000 });
      t.expect((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "the page should switch to dark at once");
      const row = await standin.one(`select theme, theme_updated_at from public.user_preferences where user_id = '${account.id}'`);
      t.expect(row?.theme === "dark" && row.theme_updated_at, "user_preferences.theme should be dark", row);
      await page.reload();
      await t.settle();
      t.expect((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "dark should survive a reload");
      t.expect(await page.getByRole("radio", { name: /Dark/ }).isChecked(), "the Dark choice should stay selected");
      await t.checkpoint("settings in dark");
    });

    await t.step("a second device signs in and gets the account's theme", async () => {
      const other = await t.browser.newContext({ viewport: page.viewportSize(), colorScheme: "light", baseURL: appUrl, locale: "en-IN", timezoneId: "Asia/Kolkata" });
      await other.route("**/*", (route) => t.route(route));
      await other.addInitScript(() => { try { window.localStorage.setItem("fitx-cookie-consent", "essential"); } catch { /* blocked */ } });
      const second = await other.newPage();
      const first = t.page;
      t.page = second;
      try {
        await signInUi(t, account, { next: "/settings", label: "second device sign-in" });
        await second.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark", null, { timeout: 15000 });
      } finally {
        t.page = first;
        await other.close();
      }
    });

    await t.step("Help and feedback opens from Settings", async () => {
      await t.goto("/settings", { label: "settings help link" });
      await page.locator("section[aria-labelledby=settings-elsewhere]").getByRole("link", { name: /Help and feedback/ }).click();
      await page.waitForURL("**/help");
      await page.getByRole("heading", { name: "Help and feedback" }).waitFor();
    });

    await t.step("Download my data includes every table, the new ones too", async () => {
      await t.goto("/settings", { label: "download my data" });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.locator("section#your-data").getByRole("button", { name: "Download", exact: true }).click(),
      ]);
      const file = path.join(outDir, download.suggestedFilename());
      await download.saveAs(file);
      const data = JSON.parse(readFileSync(file, "utf8"));
      const { EXPORT_TABLES } = await import(pathToFileURL(path.join(ROOT, "src/lib/account/export.ts")).href);
      const missing = EXPORT_TABLES.map((spec) => spec.table).filter((table) => !Array.isArray(data.tables?.[table]));
      t.note("export summary", { file: path.basename(file), tables: Object.fromEntries(Object.entries(data.tables).map(([key, rows]) => [key, rows.length])), files: data.files, notes: data.notes, account: { ...data.account, email: "<hidden>" } });
      t.expect(data.format === "fitx-account-export" && data.account?.id === account.id, "the file should be this account's export");
      t.expect(!missing.length, `tables missing from the export: ${missing.join(", ")}`);
      t.expect(!data.notes.some((note) => /not set up/.test(note)), "with every migration applied no table should be reported as not set up", data.notes);
      const thread = data.tables.support_requests?.[0];
      t.expect(thread?.subject === "Export check" && Array.isArray(thread.support_messages) && thread.support_messages.length === 1, "support requests should carry their messages", thread);
      t.expect(data.tables.meals?.some((row) => row.food_name === "Idli"), "the food log should be in the export");
      t.expect(data.tables.goals?.length === 1 && data.tables.planner_events?.length === 1, "goals and planner rows should be in the export");
      t.expect(data.files.some((entry) => entry.path === `${account.id}/avatar-e2e.png`), "the uploaded image should be listed", data.files);
      const status = await textOf(page.locator("section#your-data [role=status]").filter({ hasText: "Downloaded" }));
      t.note("download status", status);
      await t.checkpoint("after download");
    });

    await t.step("Log out ends the session on this device", async () => {
      await page.locator("section[aria-labelledby=settings-account]").getByRole("button", { name: "Log out" }).click();
      await page.waitForURL("**/signin?signed_out=1", { timeout: 20000 });
      await page.getByText("You’re signed out on this device.").waitFor();
      await t.checkpoint("signed out");
      await page.goto("/dashboard");
      t.expect(new URL(page.url()).pathname === "/signin", "after logging out a private page should ask to sign in");
      const sessions = await standin.one(`select count(*)::int n from auth.sessions where user_id = '${account.id}'`);
      t.note("sessions left after Log out (the seeding sessions remain)", sessions);
    });

    await t.step("deleting with an old sign-in asks to sign in again", async () => {
      const stale = await standin.staleSession(account.email, account.password, 30);
      await t.context.clearCookies();
      await t.context.addCookies(standin.sessionCookies(stale, appUrl));
      await t.goto("/settings", { label: "delete account (stale sign-in)" });
      t.expect(new URL(page.url()).pathname === "/settings", `the stale session should still open Settings (${page.url()})`);
      await page.locator("section#your-data").getByRole("button", { name: "Delete account" }).click();
      const dialog = page.locator("dialog[aria-labelledby=delete-account-title]");
      await dialog.getByText("deleting needs a sign-in from the last 15 minutes").waitFor({ timeout: 15000 });
      await t.checkpoint("delete asks to sign in again", { fullPage: false });
      await dialog.getByRole("button", { name: "Sign in again" }).click();
      await page.waitForURL((url) => url.pathname === "/signin", { timeout: 20000 });
      const next = new URL(page.url()).searchParams.get("next");
      t.note("sign in again goes to", page.url());
      t.expect(next && next.startsWith("/settings"), `sign-in should return to Settings (next=${next})`);
    });

    await t.step("after signing in again, typing DELETE removes the account", async () => {
      await page.getByText("Other sign-in options").click();
      await page.getByLabel("Email address").fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await Promise.all([
        page.waitForURL((url) => url.pathname.startsWith("/settings"), { timeout: 30000 }),
        page.getByRole("button", { name: "Sign in with email" }).click(),
      ]);
      await t.settle();
      const dialog = page.locator("dialog[aria-labelledby=delete-account-title]");
      if (!(await dialog.isVisible())) await page.locator("section#your-data").getByRole("button", { name: "Delete account" }).click();
      const confirm = dialog.getByLabel("Type DELETE to confirm");
      await confirm.waitFor({ timeout: 15000 });
      const remove = dialog.getByRole("button", { name: "Delete permanently" });
      await confirm.fill("delete");
      t.expect(await remove.isDisabled(), "lower-case 'delete' must not enable the button");
      await confirm.fill("DELETE");
      await t.checkpoint("delete confirmation typed", { fullPage: false });
      await remove.click();
      await dialog.getByText("Your account is deleted").waitFor({ timeout: 30000 });
      await t.checkpoint("account deleted", { fullPage: false });
      const left = await standin.one(`select (select count(*) from auth.users where id = '${account.id}')::int users,
          (select count(*) from public.profiles where id = '${account.id}')::int profiles,
          (select count(*) from public.meals where user_id = '${account.id}')::int meals,
          (select count(*) from public.goals where user_id = '${account.id}')::int goals,
          (select count(*) from public.support_requests where user_id = '${account.id}')::int support,
          (select count(*) from storage.objects where name like '${account.id}/%')::int files`);
      t.note("left after deletion", left);
      t.expect(left.users === "0" && left.profiles === "0" && left.meals === "0" && left.goals === "0" && left.files === "0", "the login, every row and the uploaded files should be gone", left);
      await dialog.getByRole("button", { name: "Go to the FITX home page" }).click();
      await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
      await page.goto("/dashboard");
      t.expect(new URL(page.url()).pathname === "/signin", "a deleted account must be signed out");
      const again = await standin.passwordSession(account.email, account.password).then(() => "signed in", (error) => error.message);
      t.expect(/Invalid login credentials/.test(again), `signing in to the deleted account should fail (${again})`);
    });
  },
};
