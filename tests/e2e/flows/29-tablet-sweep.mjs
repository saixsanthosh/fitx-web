// Flow 29: the tablet sweep (iPad portrait, 820 × 1180, touch), light and dark. One set-up member opens Home, Workouts
// (Home and Gym), the Library, an exercise, Nutrition, Progress, Activity and Explore, plus the public home page; each
// page loads its heading, never scrolls sideways and is captured once its entry fades have finished. Touch targets
// under 44 px are noted (not failed) as findings for their owners. Then two pages again in landscape (1180 × 820),
// and a first visit on a new device with the AI Coach button turned off: the button never shows, not even briefly.
import { signInUi } from "./common.mjs";

/** Waits until the short entry fades (under 2 s) have finished, so a capture never shows text mid-fade. */
async function fadesSettled(page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => {
    const timing = animation.effect?.getComputedTiming?.() ?? {};
    const short = Number.isFinite(timing.endTime) && timing.endTime < 2000;
    return !short || animation.playState !== "running";
  }), null, { timeout: 4000 }).catch(() => undefined);
}

/**
 * Visible buttons, links and fields in the page that are under 44 px in either direction (text links inside prose are
 * left out), each measured by the box a member taps. A radio or checkbox is tapped through its label: Segmented's
 * radios (Progress, Activity) are visually hidden on purpose (1 × 1, `sr-only`) inside the label that draws the 44 px
 * segment, and the label around a visible checkbox makes the whole row the target. Any other visually hidden control
 * is measured by its label too, or not at all without one: nobody can tap it. Runs in the page through
 * page.evaluate, so it uses nothing from outside itself (tests/ui/touch-targets.test.ts runs it on a stand-in DOM).
 */
export function findSmallTargets() {
  const tapTarget = (element) => {
    if (element.tagName !== "INPUT") return element;
    const own = element.getBoundingClientRect();
    const hidden = own.width <= 1 && own.height <= 1;
    if (!hidden && element.type !== "radio" && element.type !== "checkbox") return element;
    return element.closest("label") ?? element.labels?.[0] ?? (hidden ? null : element);
  };
  const found = [];
  const measured = new Set();
  for (const element of document.querySelectorAll("main a[href], main button, main input:not([type=hidden]), main select, main [role=tab], main [role=switch]")) {
    const target = tapTarget(element);
    if (!target || measured.has(target)) continue;
    measured.add(target);
    const box = target.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (element.tagName === "A" && element.closest("p, li") && getComputedStyle(element).display === "inline") continue;
    if (box.width < 44 || box.height < 44) {
      const name = (element.getAttribute("aria-label") || target.textContent || element.getAttribute("name") || element.tagName).replace(/\s+/g, " ").trim().slice(0, 40);
      found.push(`${name} ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
  }
  return found.slice(0, 12);
}

const smallTargets = (page) => page.evaluate(findSmallTargets);

const PAGES = [
  { path: "/dashboard", label: "Home", heading: { level: 1 } },
  { path: "/workouts", label: "Workouts", heading: { level: 1, name: "Workouts" } },
  { path: "/exercises", label: "Library", heading: { level: 1 } },
  { path: "/exercises/bench_press", label: "Exercise", heading: { level: 1 } },
  { path: "/nutrition", label: "Nutrition", heading: { name: /^Meals/ } },
  { path: "/progress", label: "Progress", heading: { level: 1 } },
  { path: "/activity", label: "Activity", heading: { level: 1 } },
  { path: "/explore", label: "Explore", heading: { level: 1 } },
];

export const flow = {
  id: "29-tablet-sweep",
  title: "Tablet sweep: every main page at 820 × 1180 in both themes, no sideways scroll, settled captures",
  sizes: ["tablet"],
  schemes: () => ["light", "dark"],
  async run(t, { standin }) {
    const page = await t.open();
    const findings = {};

    async function sweep(entry, label = entry.label) {
      await t.goto(entry.path, { label });
      await page.getByRole("heading", entry.heading).first().waitFor({ timeout: 20000 });
      await fadesSettled(page);
      const shot = await t.checkpoint(label);
      t.expect(!shot.overflow?.overflow, `${label}: no sideways scroll`, shot.overflow);
      const small = await smallTargets(page);
      if (small.length) findings[label] = small;
      return shot;
    }

    await t.step("the public home page: film, deck and the wide Form Check card fit the tablet", async () => {
      await t.goto("/", { label: "landing" });
      const skip = page.getByRole("button", { name: /Skip intro/ });
      if (await skip.count()) await skip.first().click().catch(() => undefined);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await fadesSettled(page);
      const hero = await t.checkpoint("landing hero", { fullPage: false });
      t.expect(!hero.overflow?.overflow, "landing: no sideways scroll", hero.overflow);
      const reel = await page.locator("section[data-film]").getAttribute("data-reel");
      t.note("landing reel cut", reel);
      await page.getByRole("tab", { name: /Form Check/ }).click();
      await page.locator("#capabilities").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.locator("[data-form-trace]").waitFor({ timeout: 5000 });
      const place = await page.evaluate(() => {
        const card = document.querySelector('#capabilities [data-card="form"]')?.getBoundingClientRect();
        const photo = document.querySelector('#capabilities [data-card="form"] img')?.parentElement?.getBoundingClientRect();
        const trace = document.querySelector("[data-form-trace]")?.getBoundingClientRect();
        return { photoLeft: Math.round((photo?.left ?? 0) - (card?.left ?? 0)), traceRight: Math.round((trace?.right ?? 0) - (card?.left ?? 0)) };
      });
      t.note("form check card at 820 px", place);
      t.expect(place.photoLeft > 120 && place.traceRight <= place.photoLeft + 24, "the trace fills the side beside the photo, never over the athlete", place);
      await fadesSettled(page);
      const card = await t.checkpoint("landing form check card", { fullPage: false, settle: false });
      t.expect(!card.overflow?.overflow, "the deck fits", card.overflow);
    }, { soft: true });

    const account = await standin.createAccount({ name: "Tara Nair", tag: "tablet" });
    await signInUi(t, account);

    for (const entry of PAGES) {
      await t.step(`${entry.label} fits the tablet`, () => sweep(entry), { soft: true });
    }

    await t.step("Workouts' Home tab fits the tablet too", async () => {
      await t.goto("/workouts", { label: "Workouts Home tab" });
      const modes = page.getByRole("tablist", { name: "Workout mode" });
      await modes.getByRole("tab", { name: "Home" }).click();
      await page.waitForTimeout(400);
      await fadesSettled(page);
      const shot = await t.checkpoint("Workouts Home tab");
      t.expect(!shot.overflow?.overflow, "Workouts Home tab: no sideways scroll", shot.overflow);
      const small = await smallTargets(page);
      if (small.length) findings["Workouts Home tab"] = small;
    }, { soft: true });

    await t.step("landscape (1180 × 820): Home and Workouts still fit", async () => {
      await page.setViewportSize({ width: 1180, height: 820 });
      await sweep(PAGES[0], "Home landscape");
      await sweep(PAGES[1], "Workouts landscape");
      await page.setViewportSize({ width: 820, height: 1180 });
    }, { soft: true });

    await t.step("a first visit on a new device never flashes the AI Coach button the account turned off", async () => {
      await standin.sql(`update public.user_preferences set coach_launcher = false where user_id = '${account.id}'`);
      // Records, from the first byte of each page, whether the button was ever in the page.
      await page.context().addInitScript(() => {
        const seen = { at: null };
        Object.defineProperty(window, "__e2eLauncherSeen", { value: seen });
        new MutationObserver(() => {
          if (seen.at === null && document.querySelector('[aria-label="Open AI Coach"]')) seen.at = Math.round(performance.now());
        }).observe(document, { childList: true, subtree: true });
      });
      await page.evaluate(() => window.localStorage.removeItem("fitx-coach-launcher"));
      await t.goto("/dashboard", { label: "first visit, launcher off" });
      await page.waitForTimeout(2500);
      const seen = await page.evaluate(() => window.__e2eLauncherSeen?.at ?? null);
      const cached = await page.evaluate(() => window.localStorage.getItem("fitx-coach-launcher"));
      t.note("launcher on a first visit", { seen, cached });
      t.expect(seen === null, `the button never appeared (it showed at ${seen} ms)`, { seen });
      t.expect(cached === "off", "the account's answer is now cached on this device", { cached });
    }, { soft: true });

    t.note("touch targets under 44 px (findings, not failures)", findings);
  },
};
