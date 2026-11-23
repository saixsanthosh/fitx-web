// Flow 17: Home after phase 6. A greeting by the time of day with the member's first name, and one quote a day
// over a moving scene: the same quote after a reload and after signing out and in again (with this browser's
// storage cleared, so it comes from the account), a different one on a new day, never a repeat. No statistics,
// widgets or To-Do. The old panel addresses redirect to their new places. Checked at 390, 768 and 1440 px.
import { kolkataDate, signInUi, textOf } from "./common.mjs";

/** The greeting the member should see at this moment in Asia/Kolkata (the browser's zone in these runs). */
function expectedGreetings(name) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const word = (h) => (h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : h >= 17 && h < 22 ? "Good evening" : "Welcome back");
  // Either side of the hour, in case the clock turns during the step.
  return new Set([word(hour), word((hour + 1) % 24)].map((words) => `${words}, ${name}`));
}

async function shownQuote(t) {
  const figure = t.page.getByRole("figure", { name: "Today's quote" });
  await figure.locator("blockquote").first().waitFor({ timeout: 20000 });
  return textOf(figure.locator("blockquote").first());
}

export const flow = {
  id: "17-home",
  title: "Home: greeting with the name, one quote a day that never repeats, no stats or To-Do, old links redirect",
  schemes: (schemes) => schemes,
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "home" });
    const today = kolkataDate();
    await signInUi(t, account);
    let first = "";

    await t.step("Home greets the member by first name for the time of day", async () => {
      if (!new URL(page.url()).pathname.startsWith("/dashboard")) await t.goto("/dashboard", { label: "Home" });
      const heading = page.getByRole("heading", { level: 1 });
      await heading.filter({ hasText: "Meera" }).waitFor({ timeout: 15000 });
      const text = await textOf(heading.first());
      t.expect(expectedGreetings("Meera").has(text), `the greeting should match the time of day (got "${text}")`, [...expectedGreetings("Meera")]);
    });

    await t.step("one quote, stored for today, over a moving scene", async () => {
      first = await shownQuote(t);
      await page.waitForTimeout(2500);
      const stored = await standin.one(`select q.text, q.scene from public.daily_quote_history h join public.daily_quotes q on q.id = h.quote_id
        where h.user_id = '${account.id}' and h.local_date = '${today}'`);
      t.note("stored quote", stored);
      t.expect(stored && first.replace(/\s+/g, " ") === stored.text, "the quote shown is the one stored for this member today", { first, stored });
      const scene = await page.locator("main img").first().getAttribute("src");
      t.expect(Boolean(scene) && scene.includes(stored?.scene ?? "?"), "the background is the scene matched to the quote", { scene, expected: stored?.scene });
      await t.checkpoint("home with today's quote");
    });

    await t.step("Home shows no statistics, charts, widgets or To-Do", async () => {
      // The quote itself may use any word, so only the rest of Home is checked.
      const body = (await textOf(page.locator("main"))).replace(first, "");
      t.note("Home text without the quote", body);
      for (const gone of ["To-Do", "Customise", "kcal", "Goals", "This week", "Protein", "Water", "Weight"]) {
        t.expect(!body.includes(gone), `"${gone}" is no longer on Home`, body);
      }
      t.expect((await page.locator("[data-widget], [role=progressbar], svg[role=img]").count()) === 0, "no widgets, progress bars or charts on Home");
    });

    await t.step("the same quote after a reload", async () => {
      await page.reload({ waitUntil: "load" });
      t.expect((await shownQuote(t)) === first, "a reload keeps today's quote");
    });

    await t.step("the same quote after signing out and in again, with this browser's storage cleared", async () => {
      await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* blocked */ } });
      await t.context.clearCookies();
      await signInUi(t, account, { label: "sign in again" });
      if (!new URL(page.url()).pathname.startsWith("/dashboard")) await t.goto("/dashboard", { label: "Home again" });
      t.expect((await shownQuote(t)) === first, "the quote comes from the account, not the browser");
    });

    await t.step("a new day brings a quote not seen before", async () => {
      // Yesterday becomes the day this quote was shown; today has none yet.
      await standin.sql(`update public.daily_quote_history set local_date = local_date - 1 where user_id = '${account.id}'`);
      await page.reload({ waitUntil: "load" });
      const next = await shownQuote(t);
      t.expect(next !== first, "today's quote differs from yesterday's", { first, next });
      const rows = await standin.one(`select count(*) n, count(distinct quote_id) d from public.daily_quote_history where user_id = '${account.id}'`);
      t.expect(rows.n === "2" && rows.d === "2", "two days, two different quotes in the member's history", rows);
    });

    await t.step("at 768 px the stage still fits without sideways scrolling", async () => {
      const size = page.viewportSize();
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      t.expect(overflow <= 0, `no sideways scroll at 768 px (${overflow} px)`);
      await t.checkpoint("home at 768 px");
      if (size) await page.setViewportSize(size);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      t.expect(wide <= 0, `no sideways scroll (${wide} px)`);
    });

    await t.step("the old Home, Goals, Planner and Tasks addresses land on their new places", async () => {
      // Every address the tab passes through, so a page that later tidies its own address (Progress opening the
      // goal editor once) still shows where the redirect went.
      const seen = [];
      const record = (frame) => { if (frame === page.mainFrame()) { const url = new URL(frame.url()); seen.push(url.pathname + url.search); } };
      page.on("framenavigated", record);
      const landed = {};
      for (const [from, to] of [
        ["/dashboard?panel=todo", "/dashboard"],
        ["/dashboard?panel=week", "/workouts"],
        ["/dashboard?panel=goals&new=water_day", "/progress?panel=goals&new=water_day"],
        ["/goals", "/progress?panel=goals"],
        ["/goals?tab=today", "/dashboard"],
        ["/goals?tab=week", "/workouts"],
        ["/tasks", "/dashboard"],
        ["/planner", "/workouts"],
      ]) {
        seen.length = 0;
        await t.goto(from, { label: from });
        for (let i = 0; i < 60 && !seen.includes(to); i += 1) await page.waitForTimeout(250);
        landed[from] = [...seen];
        t.expect(seen.includes(to), `${from} should land on ${to}`, seen);
      }
      page.off("framenavigated", record);
      t.note("redirects", landed);
    });
  },
};
