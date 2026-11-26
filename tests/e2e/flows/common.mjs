// Helpers shared by the e2e flows.

/** Signs in through the sign-in page's e-mail form, as a member would; resolves once the app has moved on. */
export async function signInUi(t, account, { next = null, label = "sign in" } = {}) {
  const page = t.page;
  await t.goto(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin", { label });
  await page.getByText("Other sign-in options").click();
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30000 }),
    page.getByRole("button", { name: "Sign in with email" }).click(),
  ]);
  await t.settle();
}

/** Skips the intro film if this page load started it; returns what the head script did to <html>. */
export async function skipFilmIfShown(t) {
  const log = await t.rootLog();
  const gate = log.find((entry) => entry.name === "data-fitx-intro-gate")?.value ?? null;
  const skip = t.page.getByRole("button", { name: /Skip intro/ });
  if (gate && (await skip.count())) await skip.first().click().catch(() => undefined);
  return { gate, log };
}

/** Waits until `text` is visible on the page (a string matches as a substring). */
export async function seeText(t, text, { timeout = 15000 } = {}) {
  await t.page.getByText(text).first().waitFor({ state: "visible", timeout });
}

/** The visible element's text, whitespace collapsed. */
export async function textOf(locator) {
  return (await locator.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Whether the element `locator` finds holds the keyboard focus within `timeout` ms. Focus often moves a render after
 * the action (release 3, D5: a control that goes hands the focus on), so this asks again until then; the locator is
 * resolved afresh each time, so a re-rendered element still counts.
 */
export async function hasFocus(locator, { timeout = 5000 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await locator.evaluate((element) => element === document.activeElement, null, { timeout: 1000 }).catch(() => false)) return true;
    if (Date.now() > until) return false;
    await sleep(100);
  }
}

/** The tab title once it is `title`, waiting up to `timeout` ms (a page's metadata can land after its first paint). */
export async function titleOf(page, title, { timeout = 10000 } = {}) {
  await page.waitForFunction((want) => document.title === want, title, { timeout }).catch(() => undefined);
  return page.title();
}

/** Clicks a visible choice (a label wrapping a visually hidden radio or checkbox) inside the fieldset titled `legend`. */
export async function choose(t, legend, option) {
  const fieldset = t.page.locator("fieldset").filter({ has: t.page.locator("legend", { hasText: legend }) }).first();
  await fieldset.locator("label").filter({ hasText: option }).first().click();
}

/** The local date in Asia/Kolkata (the browser's zone in these runs), YYYY-MM-DD. */
export function kolkataDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
