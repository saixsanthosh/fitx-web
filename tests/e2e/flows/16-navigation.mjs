// Flow 16: the app shell (phases 3 and 15). The grouped menu with its drawn icons (desktop sidebar, tablet rail,
// phone bar and More sheet), the current page marked and the page fading in on navigation (and not under reduced
// motion), the floating AI Coach button (drag and the remembered spot, temporary hide, hidden on focus screens,
// opening the coach, the Settings switch stored on the account), and a returning member's logo reveal.
import { signInUi, textOf } from "./common.mjs";

const MAIN = ["Home", "Workouts", "Nutrition", "Activity", "AI Coach", "Progress", "Exercise library", "Explore"];

async function launcherBox(page) {
  const button = page.getByRole("button", { name: "Open AI Coach" });
  if (!(await button.count())) return null;
  return button.boundingBox();
}

const overlaps = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const flow = {
  id: "16-navigation",
  title: "Menu, page transitions, floating AI Coach button, returning-login reveal",
  schemes: (schemes) => schemes,
  async run(t, { standin, size, appUrl }) {
    const page = await t.open();
    const phone = size === "phone";
    const account = await standin.createAccount({ name: "Ishaan Rao", tag: "navigation" });
    await signInUi(t, account);

    await t.step("the menu: every section in its group with its own drawn icon; no Home workout or AI Form Check", async () => {
      await t.goto("/dashboard", { label: "menu" });
      const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first();
      const labels = (await nav.getByRole("link").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
      t.note("main navigation", labels);
      t.expect(!labels.some((text) => /Home workout|Form Check|Form coach|Goals/i.test(text)), "Home workout, AI Form Check and Goals are not menu entries", labels);
      const home = nav.getByRole("link", { name: "Home" });
      t.expect((await home.getAttribute("aria-current")) === "page", "Home is marked as the current page");
      t.expect((await home.locator("svg[data-navicon=home]").count()) === 1, "Home has its drawn icon");
      t.expect((await nav.getByRole("link", { name: /Activity/ }).locator("svg[data-pose]").count()) === 1, "Activity keeps its animated icon");
      if (phone) {
        t.expect(labels.length === 4 && ["Home", "Workouts", "Nutrition", "Activity"].every((label, index) => labels[index] === label), "the phone bar has four tabs", labels);
        await page.getByRole("button", { name: "More", exact: true }).click();
        const sheet = page.getByRole("dialog", { name: "More" });
        await sheet.waitFor();
        const groups = (await sheet.locator("[data-nav-group]").allInnerTexts()).map((text) => text.trim().toLowerCase());
        t.expect(groups.join(",") === "train,track,connect,connect", "More names each section's group, as in the sidebar", groups);
        // Four section cards (Library, Progress, AI Coach, Explore) sit in two columns of two.
        const cards = await sheet.getByRole("list", { name: "Sections" }).getByRole("listitem").evaluateAll((items) => items.map((item) => {
          const box = item.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y) };
        }));
        t.expect(cards.length === 4 && new Set(cards.map(({ x }) => x)).size === 2 && new Set(cards.map(({ y }) => y)).size === 2, "four cards in two columns", cards);
        for (const label of ["Exercise library", "Progress", "AI Coach", "Explore", "Profile", "Settings", "Help and feedback"]) {
          t.expect((await sheet.getByRole("link", { name: label }).count()) === 1, `${label} is in More`);
        }
        await page.waitForTimeout(400);
        await t.checkpoint("more sheet", { fullPage: false });
        await sheet.getByRole("link", { name: "Progress" }).click();
        await page.waitForURL("**/progress");
        await t.settle();
        t.expect((await page.getByRole("button", { name: "More", exact: true }).getAttribute("class"))?.includes("font-semibold"), "More is highlighted on a page it holds");
      } else {
        for (const label of MAIN) t.expect(labels.includes(label), `${label} is in the sidebar`, labels);
        const headings = (await nav.locator("p[id^=nav-group-]").allInnerTexts()).map((text) => text.trim().toLowerCase());
        t.expect(headings.join(",") === "train,track,connect", "the sidebar is grouped: Train, Track, Connect", headings);
        const icons = await nav.locator("a svg[data-navicon], a svg[data-pose]").count();
        t.expect(icons === MAIN.length, "every main section has a drawn icon", { icons });
        // Hovering an item plays its own motion.
        await nav.getByRole("link", { name: "Workouts" }).hover();
        const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.animationName?.startsWith("fitx-navicon")).length);
        t.expect(moving > 0, "the hovered item's icon moves", { moving });
        await t.checkpoint("sidebar", { fullPage: false });
        await nav.getByRole("link", { name: "Nutrition" }).click();
        await page.waitForURL("**/nutrition");
        await t.settle();
        t.expect((await nav.getByRole("link", { name: "Nutrition" }).getAttribute("aria-current")) === "page", "the highlight moves to Nutrition");
      }
      t.expect((await page.locator("main .fitx-page-enter").count()) === 1, "pages are wrapped for the transition");
    });

    if (!phone) {
      await t.step("the tablet rail: short labels and the same groups, separated by rules", async () => {
        const before = page.viewportSize();
        await page.setViewportSize({ width: 768, height: 1024 });
        await t.goto("/progress", { label: "tablet rail" });
        const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first();
        const labels = (await nav.getByRole("link").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
        t.expect(labels.includes("Coach") && labels.includes("Library"), "the rail uses the short labels", labels);
        const box = await launcherBox(page);
        t.expect(box && box.x + box.width <= 768 && box.y + box.height <= 1024, "the coach button is on screen at 768 px", box);
        await t.checkpoint("tablet rail", { fullPage: false });
        await page.setViewportSize(before);
      });
    }

    await t.step("reduced motion: the page and the icons do not move", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await t.goto("/workouts", { label: "reduced motion" });
      const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first();
      await nav.getByRole("link", { name: "Home" }).click();
      await page.waitForURL("**/dashboard");
      await page.locator("main .fitx-page-enter").waitFor();
      // Two frames: even a 0.01 ms animation is "running" until the frame after it starts.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => ({
        opacity: getComputedStyle(document.querySelector("main .fitx-page-enter") ?? document.body).opacity,
        moving: document.getAnimations().filter((animation) => animation.playState === "running" && /fitx-navicon|fitx-page-in/.test(animation.animationName ?? "")).map((animation) => `${animation.animationName} ${animation.effect?.getComputedTiming().duration}`),
      }));
      t.expect(state.opacity === "1" && state.moving.length === 0, `nothing animates with reduced motion: ${JSON.stringify(state)}`);
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    await t.step("the floating AI Coach button sits clear of the menu bar, can be dragged, and keeps its spot", async () => {
      await t.goto("/dashboard", { label: "coach button" });
      const button = page.getByRole("button", { name: "Open AI Coach" });
      await button.waitFor({ timeout: 15000 });
      await page.waitForTimeout(1000);
      const box = await button.boundingBox();
      const viewport = page.viewportSize();
      t.note("coach button", box);
      t.expect(box.width >= 44 && box.height >= 44 && box.width <= 60, "compact, with a full touch target", box);
      t.expect(box.x + box.width / 2 > viewport.width / 2, "it starts on the right", box);
      if (phone) {
        const bar = await page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first().boundingBox();
        t.expect(!overlaps(box, bar), "it never covers the bottom bar", { box, bar });
      }
      await t.checkpoint("coach button", { fullPage: false });
      // Drag it to the left edge, halfway up.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(viewport.width * 0.3, viewport.height * 0.45, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const dropped = await button.boundingBox();
      t.expect(dropped.x < viewport.width / 2 && dropped.x <= 30, `dropped on the left, it settles against the left edge: ${JSON.stringify({ box, dropped })}`);
      t.expect(page.url().endsWith("/dashboard"), "a drag does not open the coach");
      const stored = await page.evaluate(() => window.localStorage.getItem("fitx-coach-launcher-spot"));
      t.expect(stored && JSON.parse(stored)[phone ? "phone" : "desktop"]?.side === "left", "the spot is remembered for this screen size", stored);
      await page.reload();
      await t.settle();
      await button.waitFor();
      await page.waitForTimeout(800);
      const after = await button.boundingBox();
      t.expect(Math.abs(after.x - dropped.x) < 2 && Math.abs(after.y - dropped.y) < 4, "it comes back where it was left", { dropped, after });
      await t.checkpoint("coach button moved", { fullPage: false });
    });

    await t.step("Hide AI Coach button lasts until the page is reloaded", async () => {
      const hide = page.getByRole("button", { name: "Hide AI Coach button" });
      await page.getByRole("button", { name: "Open AI Coach" }).hover();
      await hide.click();
      t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, "hidden at once");
      const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first();
      await nav.getByRole("link", { name: phone ? "Workouts" : "Progress" }).click();
      await page.waitForURL(phone ? "**/workouts" : "**/progress");
      await t.settle();
      t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, "still hidden on the next page");
      await page.reload();
      await page.getByRole("button", { name: "Open AI Coach" }).waitFor({ timeout: 15000 });
    });

    await t.step("it opens the coach, and is not shown on the coach page or the focus screens", async () => {
      await t.goto("/progress", { label: "open coach" });
      const launcher = page.getByRole("button", { name: "Open AI Coach" });
      await launcher.click();
      // The panel host takes the open event: the coach opens over the page instead of leaving it.
      const panel = page.getByRole("dialog", { name: "AI Coach" });
      await panel.waitFor({ state: "visible", timeout: 20000 });
      t.expect(page.url().endsWith("/progress"), "the coach opens over the page, which stays", page.url());
      await t.settle();
      await t.checkpoint("coach panel", { fullPage: false });
      await panel.getByRole("button", { name: "Close AI Coach" }).click();
      await panel.waitFor({ state: "hidden", timeout: 10000 });
      const refocused = await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open AI Coach", null, { timeout: 5000 })
        .then(() => true, () => false);
      t.expect(refocused, "closing the panel gives focus back to the coach button");
      await t.goto("/ai-coach", { label: "coach page" });
      t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, "not shown on the coach page");
      for (const path of ["/activity/record", "/workouts/form-check"]) {
        await t.goto(path, { label: `hidden on ${path}` });
        t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, `not shown on ${path}`);
      }
    });

    await t.step("Settings turns the button off for good and back on, stored on the account", async () => {
      await t.goto("/settings", { label: "settings switch" });
      const toggle = page.getByRole("switch", { name: "Floating AI Coach button" });
      await toggle.waitFor();
      t.expect((await toggle.getAttribute("aria-checked")) === "true", "on by default");
      await toggle.click();
      await page.getByText("Saved to your account.").waitFor({ timeout: 15000 });
      t.expect((await toggle.getAttribute("aria-checked")) === "false", "off");
      t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, "the button goes at once");
      const off = await standin.one(`select coach_launcher::text coach_launcher from public.user_preferences where user_id = '${account.id}'`);
      t.expect(off?.coach_launcher === "false", `stored on the account: ${JSON.stringify(off)}`);
      await t.checkpoint("settings coach switch off");
      // Another device (no local cache) follows the account.
      await page.evaluate(() => window.localStorage.removeItem("fitx-coach-launcher"));
      await t.goto("/dashboard", { label: "off after reload" });
      await page.waitForTimeout(1500);
      t.expect((await page.getByRole("button", { name: "Open AI Coach" }).count()) === 0, "still off after a reload, from the account");
      await t.goto("/settings", { label: "settings switch on" });
      await toggle.click();
      await page.getByText("Saved to your account.").waitFor({ timeout: 15000 });
      const on = await standin.one(`select coach_launcher::text coach_launcher from public.user_preferences where user_id = '${account.id}'`);
      t.expect(on?.coach_launcher === "true", `turned back on: ${JSON.stringify(on)}`);
      await page.getByRole("button", { name: "Open AI Coach" }).waitFor({ timeout: 15000 });
    });

    await t.step("a returning sign-in plays the logo reveal before the dashboard, once", async () => {
      const host = new URL(appUrl).hostname;
      await t.context.addCookies([{ name: "fitx_welcome", value: "return", domain: host, path: "/", sameSite: "Lax" }]);
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      const reveal = page.locator("[data-logo-reveal=return]");
      await reveal.waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(900);
      await t.checkpoint("returning logo reveal", { fullPage: false, settle: false });
      await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-loader") !== "welcome", null, { timeout: 4000 });
      const log = await t.rootLog();
      t.expect(log.some((entry) => entry.name === "data-fitx-loader" && entry.value === "welcome"), "the head script marked the reveal", log);
      t.expect(!(await t.context.cookies()).some((cookie) => cookie.name === "fitx_welcome"), "the cookie is used up");
      await page.reload();
      await t.settle();
      t.expect(!(await t.rootLog()).some((entry) => entry.value === "welcome"), "not again on the next load");
      t.expect((await textOf(page.locator("main"))).length > 0, "the dashboard is there");
    });

    await t.step("with reduced motion a returning sign-in goes straight to the dashboard", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const host = new URL(appUrl).hostname;
      await t.context.addCookies([{ name: "fitx_welcome", value: "return", domain: host, path: "/", sameSite: "Lax" }]);
      await t.goto("/dashboard", { label: "reduced motion return" });
      t.expect(!(await t.rootLog()).some((entry) => entry.value === "welcome"), "no reveal with reduced motion");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });
  },
};
