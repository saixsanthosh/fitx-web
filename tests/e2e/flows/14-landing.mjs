// Flow 14: the public home page. No sideways scroll at phone width, the two scroll scenes move with the scroll
// (plan rows tick, reps count, cues change), the reduced-motion render is a sensible still frame, the idli
// portion example works, the contact links are the owner's, and the short brand loader stays brief.
import { skipFilmIfShown, textOf } from "./common.mjs";

async function scrollToFraction(page, selector, fraction) {
  await page.evaluate(([sel, f]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = Math.max(0, el.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + range * f, behavior: "instant" });
  }, [selector, fraction]);
  await page.waitForTimeout(450);
}

async function sceneState(page) {
  return page.evaluate(() => {
    const scene = document.querySelector("#scenes");
    return {
      height: scene?.getBoundingClientRect().height ?? 0,
      viewport: window.innerHeight,
      done: scene?.querySelectorAll('[data-done="true"]').length ?? -1,
      reps: scene?.querySelector("[data-scene-reps]")?.textContent ?? null,
      cue: [...(scene?.querySelectorAll("[data-scene-cue]") ?? [])].at(-1)?.textContent ?? null,
      card: Number(getComputedStyle(scene?.querySelector('[aria-label="Example plan in FITX"]') ?? document.body).opacity),
    };
  });
}

export const flow = {
  id: "14-landing",
  title: "Public home page: scroll scenes, reduced motion, contact links",
  schemes: () => ["light", "dark"],
  async run(t, { size }) {
    const page = await t.open();

    await t.step("the page opens with its hero and no sideways scroll", async () => {
      await t.goto("/", { label: "home" });
      await skipFilmIfShown(t);
      await page.waitForTimeout(600);
      const title = await textOf(page.getByRole("heading", { level: 1 }));
      t.expect(/Train smart\.\s*Live fit\./.test(title), `hero title: ${title}`);
      t.expect(await page.getByRole("link", { name: "Start training" }).isVisible(), "Start training is offered");
      const shot = await t.checkpoint("hero", { fullPage: false });
      t.expect(!shot.overflow?.overflow, "no sideways scroll", shot.overflow);
    });

    await t.step("the two scenes follow the scroll", async () => {
      await scrollToFraction(page, "#scenes", 0);
      const start = await sceneState(page);
      await t.checkpoint("scenes start", { fullPage: false, settle: false });
      await scrollToFraction(page, "#scenes", 0.34);
      const bottom = await sceneState(page);
      await t.checkpoint("scenes first rep", { fullPage: false, settle: false });
      await scrollToFraction(page, "#scenes", 1);
      const end = await sceneState(page);
      await t.checkpoint("scenes end", { fullPage: false, settle: false });
      t.note("scene states", { start, bottom, end });
      t.expect(start.height > start.viewport * 2, "the scene is a tall scroll section", start);
      t.expect(start.reps === "0" && end.reps === "2", "reps count up with the scroll", { start, end });
      t.expect(bottom.cue === "Good depth", "the bottom of the rep says Good depth", bottom);
      t.expect(start.done === 0 && end.done === 4, "plan rows tick off", { start, end });
      t.expect(bottom.card > 0.99 && end.card > 0.99, "the plan card shows once the scene is under way", { bottom, end });
    });

    await t.step("the Home workout features reveal as they scroll in", async () => {
      const list = page.getByRole("heading", { name: "A coach that watches." });
      await list.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 300);
      // Items reveal one after another (and the last may have only just come into view): allow the stagger to finish.
      const inViewHidden = () => [...document.querySelectorAll("[data-fitx-stagger-item]")]
        .filter((item) => item.getBoundingClientRect().bottom < window.innerHeight - 40 && Number(getComputedStyle(item).opacity) < 0.99).length;
      await page.waitForFunction(() => [...document.querySelectorAll("[data-fitx-stagger-item]")]
        .every((item) => item.getBoundingClientRect().bottom >= window.innerHeight - 40 || Number(getComputedStyle(item).opacity) >= 0.99), null, { timeout: 4000 }).catch(() => undefined);
      const hidden = await page.evaluate(inViewHidden);
      t.expect(hidden === 0, `${hidden} feature rows in view are still hidden`);
      t.expect(await page.getByText("never uploaded", { exact: false }).first().isVisible(), "the privacy promise shows");
      await t.checkpoint("home workout features", { fullPage: false });
    });

    await t.step("the idli example scales by the piece", async () => {
      const card = page.getByRole("group", { name: /Portion example/ });
      await card.scrollIntoViewIfNeeded();
      const before = await textOf(card);
      await card.getByRole("button", { name: "One idli more" }).click();
      const after = await textOf(card);
      t.expect(/≈ 76 g/.test(before) && /≈ 114 g/.test(after), "two idli are 76 g, three are 114 g", { before, after });
      await t.checkpoint("food tile", { fullPage: false });
    });

    await t.step("the contact block links to the owner's Instagram and e-mail", async () => {
      const instagram = page.getByRole("link", { name: /^Instagram @/ }).first();
      await instagram.scrollIntoViewIfNeeded();
      const href = await instagram.getAttribute("href");
      t.expect(/^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/.test(href ?? ""), `instagram link ${href}`);
      t.expect((await instagram.getAttribute("target")) === "_blank" && /noopener/.test((await instagram.getAttribute("rel")) ?? ""), "opens safely in a new tab");
      const mail = page.getByRole("link", { name: /^Email .+@.+/ }).first();
      t.expect(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test((await mail.getAttribute("href")) ?? ""), "mailto link");
      t.expect(await page.getByRole("button", { name: "Copy email address" }).isVisible(), "copy button");
      if (size === "desktop") {
        await page.getByRole("link", { name: /^Instagram @/ }).first().hover();
        await page.waitForTimeout(500);
      }
      const shot = await t.checkpoint("contact", { fullPage: false });
      t.expect(!shot.overflow?.overflow, "no sideways scroll at the contact block", shot.overflow);
    });

    await t.step("full page has no sideways scroll", async () => {
      const shot = await t.checkpoint("full page");
      t.expect(!shot.overflow?.overflow, "no sideways scroll", shot.overflow);
    });

    await t.step("reduced motion: one still frame with the final state", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await t.goto("/", { label: "home reduced motion" });
      await skipFilmIfShown(t);
      await scrollToFraction(page, "#scenes", 0);
      const still = await sceneState(page);
      t.note("reduced", still);
      t.expect(still.height < still.viewport * 1.6, "no tall scroll section", still);
      t.expect(still.reps === "2" && still.done === 4 && still.cue === "Good depth" && still.card > 0.99, "the final frame shows", still);
      const log = await t.rootLog();
      t.expect(!log.some((entry) => entry.name === "data-fitx-loader" && entry.value === "on"), "no brand loader with reduced motion", log);
      await t.checkpoint("reduced motion scenes", { fullPage: false });
      await page.emulateMedia({ reducedMotion: null });
    });

    await t.step("a returning device gets the short loader, gone within about a second", async () => {
      await page.context().addCookies([{ name: "fitx_intro", value: "seen", url: t.appUrl }]);
      await t.goto("/features", { label: "loader" });
      const log = await t.rootLog();
      const on = log.find((entry) => entry.name === "data-fitx-loader" && entry.value === "on");
      const off = log.findLast((entry) => entry.name === "data-fitx-loader" && entry.value === null);
      t.note("loader log", log);
      if (on) t.expect(off && off.t - on.t <= 1200, "the loader leaves within 1.2 s", log);
      await t.checkpoint("features");
    });
  },
};
