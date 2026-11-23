// Flow 15: the one-screen sign-in pages and signing in with an e-mail code. Each page fits the viewport
// without scrolling (phone 390 x 844 and desktop); the stage shows a still frame of the 3D scene first and settles
// (live or still), has a pause control and stays still with reduced motion; without NEXT_PUBLIC_GOOGLE_CLIENT_ID the
// Google button is the redirect flow and nothing is fetched from Google. A new address asks for a code, a wrong code is refused, the right code (pasted with a space)
// signs in and onboarding opens; an existing account signs in by code and lands on the page it asked for, and
// asking again within a minute keeps the code already sent. The stand-in keeps codes in an outbox (auth.mjs).
import { seeText } from "./common.mjs";

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

    await t.step("the stage: a still frame of the scene first, the live scene where the device carries it", async () => {
      await t.goto("/signin", { label: "stage scene" });
      const stage = page.locator("section[aria-label=FITX]");
      const still = await stage.evaluate((element) => getComputedStyle(element.querySelector("div")).backgroundImage);
      t.expect(/\/media\/login\/still-(light|dark)-(wide|tall)\.webp/.test(still), `the still frame is the first picture (${still})`);
      // The live scene needs WebGL2 on a capable GPU; headless runs may or may not have one. Either outcome is valid,
      // but it must settle: live (a canvas showing) or still (no canvas), never stuck loading.
      await page.waitForFunction(() => ["live", "still"].includes(document.querySelector("section[aria-label=FITX]")?.getAttribute("data-scene") ?? ""), null, { timeout: 30000 }).catch(() => undefined);
      const scene = await stage.getAttribute("data-scene");
      const canvases = await stage.locator("canvas").count();
      t.note("sign-in scene", { scene, canvases });
      t.expect(scene === "live" ? canvases === 1 : scene === "still", `the scene settles (data-scene=${scene}, canvases=${canvases})`);
      t.expect(!(await page.getByRole("button", { name: "Tilt to look around" }).count()), "no tilt button where the browser shares motion without asking (or on a laptop)");
      const extra = await verticalScroll(page);
      t.expect(extra <= 1, `the page still fits one screen with the scene (scrolls ${extra}px)`);
      await t.checkpoint("signin scene", { fullPage: false, settle: false });
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
