// Flow 15: the one-screen sign-in pages and signing in with an e-mail code. Each page fits the viewport
// without scrolling (phone 390 x 844 and desktop); the stage is a still frame of the 3D scene, and only an address
// with ?scene=live loads three.js, the scene's worker and a canvas (hotfix 2d), where it settles live or still; it
// has a pause control and stays still with reduced motion; without NEXT_PUBLIC_GOOGLE_CLIENT_ID the
// Google button is the redirect flow and nothing is fetched from Google. A new address asks for a code, a wrong code is refused, the right code (pasted with a space)
// signs in and onboarding opens; an existing account signs in by code and lands on the page it asked for, and
// asking again within a minute keeps the code already sent. The stand-in keeps codes in an outbox (auth.mjs).
// An address typed into the server-rendered page before its scripts run is kept once React takes over, and the
// code step works with it (hotfix 2d).
import { seeText } from "./common.mjs";

/** Records, in every page of the flow, the stage's data-scene values in order and each worker the page starts. */
function watchStage() {
  const scenes = [];
  const workers = [];
  Object.defineProperty(window, "__e2eScenes", { value: scenes });
  Object.defineProperty(window, "__e2eWorkers", { value: workers });
  new MutationObserver(() => {
    const value = document.querySelector("section[aria-label=FITX]")?.getAttribute("data-scene");
    if (value && scenes[scenes.length - 1] !== value) scenes.push(value);
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-scene"] });
  const Original = window.Worker;
  if (Original) {
    window.Worker = new Proxy(Original, {
      construct(target, args) {
        workers.push(String(args[0]).slice(0, 200));
        return Reflect.construct(target, args);
      },
    });
  }
}

/** What the stage did on this page: its data-scene now and before, canvases, whether three.js ran, workers started. */
const stageState = (page) => page.evaluate(() => ({
  scene: document.querySelector("section[aria-label=FITX]")?.getAttribute("data-scene") ?? null,
  scenes: [...(window.__e2eScenes ?? [])],
  canvases: document.querySelectorAll("section[aria-label=FITX] canvas").length,
  three: typeof window.__THREE__ === "string" ? window.__THREE__ : null,
  workers: [...(window.__e2eWorkers ?? [])],
}));

async function sentCode(standin, email) {
  const response = await fetch(`${standin.url}/auth/v1/__e2e/outbox?email=${encodeURIComponent(email)}`, {
    headers: { apikey: standin.anonKey, authorization: `Bearer ${standin.serviceRoleKey}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`no code in the stand-in outbox for ${email}: ${body.msg ?? response.status}`);
  return body.code;
}

/** How far the page scrolls vertically at this viewport (0 means it fits). */
const verticalScroll = (page) => page.evaluate(() => {
  const root = document.scrollingElement ?? document.documentElement;
  return Math.max(0, root.scrollHeight - window.innerHeight);
});

export const flow = {
  id: "15-signin",
  title: "One-screen sign-in and the e-mail code",
  schemes: (schemes) => schemes,
  async run(t, { standin }) {
    const page = await t.open();
    await t.context.addInitScript(watchStage);

    await t.step("sign-in, sign-up and password pages fit one screen", async () => {
      for (const route of ["/signin", "/signup", "/forgot-password"]) {
        await t.goto(route, { label: `fit ${route}` });
        const extra = await verticalScroll(page);
        t.note(`${route} vertical scroll`, extra);
        t.expect(extra <= 1, `${route} should fit the viewport without scrolling (scrolls ${extra}px)`);
        await t.checkpoint(`${route} one screen`, { fullPage: false });
      }
      await t.goto("/signin", { label: "options open" });
      await page.getByText("Other sign-in options").click();
      await page.getByRole("button", { name: "Sign in with email" }).waitFor();
      const extra = await verticalScroll(page);
      t.note("/signin with other options open, vertical scroll", extra);
      t.expect(extra <= 1, `the sign-in page with other options open should still fit (scrolls ${extra}px)`);
      t.expect(!(await page.getByRole("button", { name: "Email me a code" }).count()), "only one submit button shows at a time");
      await t.checkpoint("signin other options open", { fullPage: false });
    });

    await t.step("the stage: the still frame is the page; three.js, its worker and a canvas never load without ?scene=live", async () => {
      for (const route of ["/signin", "/signup", "/forgot-password", "/reset-password"]) {
        await t.goto(route, { label: `stage ${route}` });
        const stage = page.locator("section[aria-label=FITX]");
        const still = await stage.evaluate((element) => getComputedStyle(element.querySelector("div")).backgroundImage);
        t.expect(/\/media\/login\/still-(light|dark)-(wide|tall)\.webp/.test(still), `${route}: the still frame is the picture (${still})`);
        await page.waitForFunction(() => document.querySelector("section[aria-label=FITX]")?.getAttribute("data-scene") === "still", null, { timeout: 15000 }).catch(() => undefined);
        // Past the moment the live scene used to start (an idle callback, 1.5 s at the latest), and then some.
        await page.waitForTimeout(2500);
        const seen = await stageState(page);
        t.note(`${route} stage`, seen);
        t.expect(seen.scene === "still" && seen.scenes.every((value) => value === "idle" || value === "still"), `${route}: the stage settles on the still frame and never starts the scene (${seen.scenes.join(" → ")})`, seen);
        t.expect(seen.canvases === 0, `${route}: no canvas on the stage (${seen.canvases})`, seen);
        t.expect(seen.three === null, `${route}: three.js never ran (window.__THREE__ = ${seen.three})`, seen);
        t.expect(seen.workers.length === 0, `${route}: no worker started (${seen.workers.join(", ")})`, seen);
        if (route === "/signin") await t.checkpoint("signin still stage", { fullPage: false, settle: false });
      }
      t.expect(!(await page.getByRole("button", { name: "Tilt to look around" }).count()), "no tilt button where the browser shares motion without asking (or on a laptop)");
    });

    await t.step("with ?scene=live the live scene loads, and settles live or still", async () => {
      await t.goto("/signin?scene=live", { label: "stage scene=live" });
      const stage = page.locator("section[aria-label=FITX]");
      const still = await stage.evaluate((element) => getComputedStyle(element.querySelector("div")).backgroundImage);
      t.expect(/\/media\/login\/still-(light|dark)-(wide|tall)\.webp/.test(still), `the still frame is the first picture (${still})`);
      // The live scene needs WebGL2 on a capable GPU; headless runs may or may not have one. Either outcome is valid,
      // but it must settle: live (a canvas showing) or still (no canvas), never stuck loading.
      await page.waitForFunction(() => ["live", "still"].includes(document.querySelector("section[aria-label=FITX]")?.getAttribute("data-scene") ?? "") && (window.__e2eScenes ?? []).includes("loading"), null, { timeout: 30000 }).catch(() => undefined);
      const seen = await stageState(page);
      t.note("sign-in scene with ?scene=live", seen);
      t.expect(seen.scenes.includes("loading"), `asked for, the scene starts loading (${seen.scenes.join(" → ")})`, seen);
      t.expect(seen.three !== null, "asked for, three.js runs", seen);
      t.expect(seen.scene === "live" ? seen.canvases === 1 : seen.scene === "still", `the scene settles (data-scene=${seen.scene}, canvases=${seen.canvases})`, seen);
      const extra = await verticalScroll(page);
      t.expect(extra <= 1, `the page still fits one screen with the scene (scrolls ${extra}px)`);
      await t.checkpoint("signin scene live", { fullPage: false, settle: false });
    });

    await t.step("without a Google client id, Google sign-in is the redirect button and nothing loads from Google", async () => {
      const requests = [];
      const listen = (request) => { if (/accounts\.google\.com/.test(request.url())) requests.push(request.url()); };
      page.on("request", listen);
      await t.goto("/signin", { label: "google fallback" });
      await page.getByRole("button", { name: "Continue with Google" }).waitFor();
      await t.goto("/signup", { label: "google fallback sign-up" });
      await page.getByRole("button", { name: "Continue with Google" }).waitFor();
      page.off("request", listen);
      t.expect(!requests.length, "no request to accounts.google.com", requests);
      t.expect(!(await page.locator('script[src*="accounts.google.com"]').count()), "Google's script is not on the page");
    });

    await t.step("the stage animation can be paused, and is still with reduced motion", async () => {
      await t.goto("/signin", { label: "stage" });
      const pause = page.getByRole("button", { name: "Pause animation" });
      await pause.waitFor({ timeout: 10000 });
      await pause.click();
      await page.getByRole("button", { name: "Play animation" }).waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await t.goto("/signin", { label: "stage reduced motion" });
      t.expect(!(await page.getByRole("button", { name: /animation/ }).count()), "with reduced motion nothing moves, so there is no pause control");
      const running = await page.locator("section[aria-label=FITX]").getAttribute("data-running");
      t.expect(running === "false", `the stage should not run with reduced motion (data-running=${running})`);
      await t.checkpoint("signin reduced motion", { fullPage: false });
      await page.emulateMedia({ reducedMotion: null });
    });

    await t.step("an address typed before the page's scripts run is kept, and the code step works with it", async () => {
      const early = standin.newCredentials("Early Typist", "early").email;
      // The page's own scripts wait until the address is typed: until then the server-rendered page is all there is.
      let release = () => {};
      const released = new Promise((resolve) => { release = resolve; });
      const held = [];
      const scripts = (url) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js");
      const hold = async (route) => {
        held.push(new URL(route.request().url()).pathname);
        await released;
        await route.fallback();
      };
      await page.route(scripts, hold);
      try {
        await page.goto("/signin", { waitUntil: "domcontentloaded" });
        t.label = "typed before hydration";
        const field = page.getByLabel("Email address");
        // Focus, not a click: before hydration the cookie banner may still sit over the form on a phone.
        await field.focus();
        await page.keyboard.type(early, { delay: 10 });
        const before = await page.evaluate(() => ({
          hydrated: Boolean(document.querySelector("form[data-hydrated]")),
          value: document.querySelector("form input[type=email]")?.value ?? null,
        }));
        t.note("before hydration", { held: held.length, ...before });
        t.expect(held.length > 0 && !before.hydrated, `the page's scripts were held while typing (${held.length} held, hydrated ${before.hydrated})`, before);
        t.expect(before.value === early, `the server-rendered field took the address (${before.value})`, before);
        release();
        await page.waitForSelector("form[data-hydrated]", { timeout: 30000 });
        // The renders right after hydration (reduced motion, location, data-hydrated) used to empty the field.
        await page.waitForTimeout(750);
        const kept = await field.inputValue();
        t.expect(kept === early, `the address typed before hydration is still in the field (holds "${kept}")`);
        await t.checkpoint("typed before hydration, kept", { fullPage: false, settle: false });
      } finally {
        release();
        await page.unroute(scripts, hold);
      }
      await page.getByRole("button", { name: "Email me a code" }).click();
      await seeText(t, "Check your email");
      await seeText(t, early);
      const code = await sentCode(standin, early);
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 30000 }),
        page.getByLabel("6-digit code").fill(code),
      ]);
      t.expect(new URL(page.url()).pathname === "/onboarding", `the code sent to the kept address signs in (${page.url()})`);
      await t.context.clearCookies();
    });

    const newEmail = standin.newCredentials("Code Newcomer", "code").email;
    await t.step("a new address asks for a code", async () => {
      await t.goto("/signin", { label: "code request" });
      await page.getByLabel("Email address").fill(newEmail);
      await page.getByRole("button", { name: "Email me a code" }).click();
      await seeText(t, "Check your email");
      await seeText(t, newEmail);
      const resend = page.getByRole("button", { name: /^Resend in \d:\d\d$/ });
      t.expect(await resend.isDisabled(), "resending waits a minute");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("autocomplete"));
      t.expect(focused === "one-time-code", `the code field should have focus (got ${focused})`);
      await t.checkpoint("code sent", { fullPage: false });
      await page.waitForTimeout(2300);
      const later = (await page.getByRole("button", { name: /^Resend in / }).innerText()).trim();
      t.expect(/^Resend in 0:5\d$/.test(later), `the resend timer counts down (shows "${later}")`);
    });

    await t.step("a wrong code is refused with a clear message", async () => {
      const code = await sentCode(standin, newEmail);
      const wrong = code === "000000" ? "111111" : "000000";
      await page.getByLabel("6-digit code").fill(wrong);
      await page.getByRole("alert").filter({ hasText: "That code is wrong or has expired" }).waitFor({ timeout: 15000 });
      t.expect(new URL(page.url()).pathname === "/signin", "a wrong code must not sign in");
      const invalid = await page.getByLabel("6-digit code").getAttribute("aria-invalid");
      t.expect(invalid === "true", "the code field is marked invalid");
      await t.checkpoint("wrong code", { fullPage: false });
    });

    await t.step("the right code, pasted with a space, signs in and opens onboarding", async () => {
      const code = await sentCode(standin, newEmail);
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 30000 }),
        page.getByLabel("6-digit code").fill(`${code.slice(0, 3)} ${code.slice(3)}`),
      ]);
      await t.settle();
      const row = await standin.one(`select u.id, p.onboarded, (select count(*) from auth.sessions s where s.user_id = u.id)::int sessions,
          (select string_agg(c.authentication_method, ',') from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.user_id = u.id) methods
        from auth.users u left join public.profiles p on p.id = u.id where u.email = '${newEmail}'`);
      t.note("new account after the code", row);
      t.expect(row && row.onboarded === "f", "the code creates the account and it still needs onboarding", row);
      t.expect(row.methods === "otp", `the session is an e-mail code sign-in (${row.methods})`, row);
      const cookies = await t.context.cookies();
      t.expect(cookies.some((cookie) => cookie.name === "fitx_auth" && cookie.value === "1"), "the server set the sign-in hint cookie");
      await t.checkpoint("onboarding after code", { fullPage: false });
    });

    const account = await standin.createAccount({ name: "Code Regular", tag: "code-existing" });
    await t.step("an existing account signs in by code and lands where it asked", async () => {
      await t.context.clearCookies();
      await t.goto(`/signin?next=${encodeURIComponent("/progress")}`, { label: "code with next" });
      await page.getByLabel("Email address").fill(account.email);
      await page.getByRole("button", { name: "Email me a code" }).click();
      await seeText(t, "Check your email");
      await page.getByRole("button", { name: "Change email" }).click();
      await page.getByRole("button", { name: "Email me a code" }).click();
      await seeText(t, "A code was sent a moment ago");
      await t.checkpoint("asked again within a minute", { fullPage: false });
      const code = await sentCode(standin, account.email);
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/progress", { timeout: 30000 }),
        page.getByLabel("6-digit code").fill(code),
      ]);
      await t.settle();
      t.expect(new URL(page.url()).pathname === "/progress", `expected /progress after the code, got ${page.url()}`);
    });
  },
};
