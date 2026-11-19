// Flow 15: the one-screen sign-in pages and signing in with an e-mail code. Each page fits the viewport
// without scrolling (phone 390 x 844 and desktop); the stage animation has a pause control and stays still with
// reduced motion. A new address asks for a code, a wrong code is refused, the right code (pasted with a space)
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
