// Flow 11: signed out, every private route sends the visitor to /signin?next=<the route>; signed in, "/" and the
// sign-in pages go to the dashboard, an account still in setup is held at onboarding (Help stays open), and
// every app page opens cleanly (console, failed requests, overflow and a screenshot per page).
import { signInUi } from "./common.mjs";

const PRIVATE = [
  "/dashboard", "/workouts", "/workouts/active", "/nutrition", "/nutrition/sources", "/activity", "/activity/record",
  "/activity/00000000-0000-4000-8000-000000000000", "/progress", "/goals", "/goals?tab=week", "/planner", "/profile", "/settings", "/help",
  "/exercises", "/exercises/00000000-0000-4000-8000-000000000000", "/home-workout", "/form-coach", "/onboarding", "/achievements", "/ai-coach",
  "/subscription", "/tasks", "/social", "/admin", "/activity/import", "/exercises/muscles", "/workouts/programme", "/workouts/history",
  "/workouts/history/00000000-0000-4000-8000-000000000000", "/progress/muscles",
];
const APP_PAGES = [
  "/dashboard", "/workouts", "/nutrition", "/nutrition/sources", "/activity", "/progress", "/goals", "/goals?tab=week", "/planner",
  "/profile", "/settings", "/help", "/exercises", "/home-workout", "/form-coach", "/form-coach?exercise=bodyweight_squat", "/achievements", "/ai-coach", "/subscription", "/tasks", "/social", "/admin",
  "/activity/import", "/exercises/muscles", "/workouts/programme", "/workouts/history", "/progress/muscles",
];
/** Retired routes that now redirect on purpose (their page.tsx calls redirect(), or next.config.ts redirects them). */
const MOVED = {
  "/goals": "/dashboard?panel=goals", "/goals?tab=week": "/dashboard?panel=week", "/planner": "/dashboard?panel=week",
  "/tasks": "/dashboard?panel=todo", "/achievements": "/progress", "/social": "/dashboard", "/admin": "/dashboard",
  "/form-coach": "/home-workout", "/form-coach?exercise=bodyweight_squat": "/home-workout?exercise=bodyweight_squat",
};
/** Moved before sign-in too (next.config.ts redirects run before the proxy), so sign-in returns to the new page. */
const SIGNED_OUT_NEXT = { "/form-coach": "/home-workout" };
const PUBLIC_PAGES = ["/", "/features", "/pricing", "/about", "/for-gyms", "/privacy", "/terms", "/cookies", "/refunds", "/signin", "/signup", "/forgot-password"];

export const flow = {
  id: "11-routing",
  title: "Signed-out redirects, signed-in routing and every app page",
  async run(t, { standin }) {
    const page = await t.open();

    await t.step("signed out: every private route redirects to /signin?next=", async () => {
      const wrong = [];
      for (const route of PRIVATE) {
        t.label = `signed out ${route}`;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        const url = new URL(page.url());
        const expected = SIGNED_OUT_NEXT[route] ?? route;
        if (url.pathname !== "/signin" || url.searchParams.get("next") !== expected) wrong.push({ route, landed: `${url.pathname}${url.search}` });
      }
      await t.settle();
      await t.checkpoint("sign-in page reached from a private route");
      t.expect(!wrong.length, `${wrong.length} private routes did not redirect to /signin?next=<route>`, wrong);
    });

    await t.step("signed out: public pages open", async () => {
      for (const route of PUBLIC_PAGES) {
        const response = await t.goto(route, { label: `public ${route}` });
        t.expect(response && response.status() < 400, `${route} answered ${response?.status()}`);
        await t.checkpoint(`public ${route}`);
      }
    });

    const account = await standin.createAccount({ name: "Ravi Menon", tag: "routing" });
    await t.step("sign in with next= lands on the requested page (an old Goals link, now Home's week plan)", async () => {
      await signInUi(t, account, { next: "/goals?tab=week" });
      await page.waitForURL("**/dashboard?panel=week", { timeout: 15000 }).catch(() => undefined);
      const url = new URL(page.url());
      t.expect(url.pathname === "/dashboard" && url.searchParams.get("panel") === "week", `expected /dashboard?panel=week after sign-in, got ${url.pathname}${url.search}`);
      await t.checkpoint("week plan after sign-in with next");
    });

    await t.step("signed in: / and the sign-in pages go to the dashboard", async () => {
      const wrong = [];
      for (const route of ["/", "/signin", "/signup", "/forgot-password", "/onboarding"]) {
        t.label = `signed in ${route}`;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        const url = new URL(page.url());
        if (url.pathname !== "/dashboard") wrong.push({ route, landed: `${url.pathname}${url.search}` });
      }
      await t.settle();
      t.expect(!wrong.length, "signed-in visits should land on /dashboard", wrong);
    });

    await t.step("signed in: the menu has no Home workout, AI Form Check, Goals or Form coach, and the header has no search box", async () => {
      await t.goto("/dashboard", { label: "menu check" });
      const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).first();
      const labels = (await nav.getByRole("link").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
      t.note("main navigation", labels.join(" | "));
      t.expect(!labels.some((text) => /^Goals$/.test(text)), "Goals should no longer be in the menu", labels);
      t.expect(!labels.some((text) => /Form coach/i.test(text)), "Form coach should be renamed", labels);
      const phone = (page.viewportSize()?.width ?? 0) < 768;
      // AI Form Check (once Home workout) is reached from Workouts, not the menu (phase 15).
      t.expect(!labels.some((text) => /Home workout|Form Check/i.test(text)), "Home workout and AI Form Check are not menu entries", labels);
      if (!phone) t.expect(labels.includes("Exercise library") && labels.includes("AI Coach"), "the sidebar lists every section", labels);
      t.expect((await nav.getByRole("link", { name: /Activity/ }).locator("svg[data-pose]").count()) === 1, "Activity should use the animated icon");
      const searchboxes = await page.getByRole("searchbox").count();
      t.expect(searchboxes === 0, `Home should have no search box now the header search is gone (found ${searchboxes})`);
      await t.checkpoint("app shell menu");
    });

    await t.step("signed in: every app page opens", async () => {
      const failures = [];
      for (const route of APP_PAGES) {
        const response = await t.goto(route, { label: `app ${route}` });
        const url = new URL(page.url());
        const heading = await page.locator("main h1, h1").first().innerText({ timeout: 5000 }).catch(() => null);
        const expected = MOVED[route] ?? route;
        if (!response || response.status() >= 400) failures.push({ route, status: response?.status() });
        else if (`${url.pathname}${url.search}` !== expected && url.pathname !== expected) failures.push({ route, expected, landed: `${url.pathname}${url.search}` });
        await t.checkpoint(`app ${route}${heading ? ` (${heading.replace(/\s+/g, " ").slice(0, 40)})` : ""}`);
      }
      t.expect(!failures.length, "every app page should open for a signed-in member", failures);
    });

    await t.step("an account still in setup is held at onboarding, Help stays open", async () => {
      const unfinished = standin.newCredentials("Kiran Shah", "unfinished");
      await standin.signUp(unfinished);
      await t.context.clearCookies();
      await signInUi(t, unfinished);
      t.expect(new URL(page.url()).pathname === "/onboarding", `a new account should land on onboarding, got ${page.url()}`);
      const wrong = [];
      for (const route of ["/dashboard", "/workouts", "/settings", "/"]) {
        t.label = `unfinished ${route}`;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        if (new URL(page.url()).pathname !== "/onboarding") wrong.push({ route, landed: page.url() });
      }
      await t.goto("/help", { label: "unfinished /help" });
      const helpOpen = new URL(page.url()).pathname === "/help";
      await t.checkpoint("help for an account in setup");
      t.expect(!wrong.length, "app pages should send an unfinished account to onboarding", wrong);
      t.expect(helpOpen, `Help should stay open before onboarding, got ${page.url()}`);
    });
  },
};
