// Flow 14: the public home page, four screens. The film's still comes first and the reel loads only after the page
// has loaded (the phone cut on phones); the film plays behind the headline and its chapter rail jumps the film; the capability deck moves on by itself, holds still under keyboard focus, pauses and plays, answers tabs, arrow
// keys and the idli stepper, and shows its seventh (Explore) card; the idea and the
// contact cards show; on wide screens the Form Check card fills its left side (the photo's own colours and the knee-angle
// trace); nothing scrolls sideways and the page stays short; with reduced motion nothing moves (no film,
// no auto-advance) and the brand loader stays away; a returning device gets the short loader.
import { skipFilmIfShown, textOf } from "./common.mjs";

const deckState = (page) => page.evaluate(() => {
  const deck = document.querySelector("#capabilities");
  return {
    auto: deck?.getAttribute("data-auto") ?? null,
    selected: deck?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.replace(/^\d+/, "").trim() ?? null,
    tabs: deck?.querySelectorAll('[role="tab"]').length ?? 0,
    visiblePanels: [...(deck?.querySelectorAll('[role="tabpanel"]') ?? [])].filter((panel) => !panel.hidden).length,
  };
});

/** Waits until the short entry fades and rises (under 2 s) have finished, so a screenshot never catches text mid-fade. */
async function fadesSettled(page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => {
    const timing = animation.effect?.getComputedTiming?.() ?? {};
    const short = Number.isFinite(timing.endTime) && timing.endTime < 2000;
    return !short || animation.playState !== "running";
  }), null, { timeout: 4000 }).catch(() => undefined);
}

/** When the reel was fetched, against the page's load event (ms since navigation start). */
const reelTiming = (page) => page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const reels = performance.getEntriesByType("resource").filter((entry) => /\/media\/landing-film\/reel-.*\.mp4/.test(entry.name));
  return {
    loadEnd: nav ? Math.round(nav.loadEventEnd) : null,
    reels: reels.map((entry) => ({ file: entry.name.split("/").pop(), start: Math.round(entry.startTime) })),
    shape: document.querySelector("section[data-film]")?.getAttribute("data-reel") ?? null,
  };
});

export const flow = {
  id: "14-landing",
  title: "Public home page: film, capability deck, idea and contact; reduced motion",
  schemes: () => ["light", "dark"],
  async run(t, { size }) {
    const page = await t.open();

    await t.step("the page opens with the film behind the headline and no sideways scroll", async () => {
      await t.goto("/", { label: "home" });
      await skipFilmIfShown(t);
      const title = await textOf(page.getByRole("heading", { level: 1 }));
      t.expect(/Train smart\.\s*Live fit\./.test(title), `hero title: ${title}`);
      t.expect(await page.getByRole("link", { name: "Start training" }).isVisible(), "Start training is offered");
      await page.waitForFunction(() => document.querySelector("section[data-film]")?.getAttribute("data-film") === "playing", null, { timeout: 15000 }).catch(() => undefined);
      const film = await page.locator("section[data-film]").getAttribute("data-film");
      t.note("film state", film);
      t.expect(film === "playing", `the film plays (data-film=${film})`);
      const timing = await reelTiming(page);
      t.note("reel timing", timing);
      t.expect(timing.loadEnd !== null && timing.reels.length > 0 && timing.reels.every((reel) => reel.start >= timing.loadEnd), "the reel is fetched only after the page has loaded (the still comes first)", timing);
      const cut = size === "phone" ? "portrait" : "landscape";
      t.expect(timing.shape === cut && timing.reels.every((reel) => reel.file.includes(cut)), `this screen gets the ${cut} cut only`, timing);
      await fadesSettled(page);
      const shot = await t.checkpoint("hero", { fullPage: false });
      t.expect(!shot.overflow?.overflow, "no sideways scroll", shot.overflow);
    });

    await t.step("a chapter on the rail jumps the film there, and the film can be paused", async () => {
      await page.getByRole("button", { name: /^Lift:/ }).click();
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => ({
        current: document.querySelector('[data-chapter][data-current="true"]')?.getAttribute("data-chapter"),
        time: document.querySelector("section[data-film] video")?.currentTime ?? -1,
      }));
      t.note("after choosing Lift", state);
      t.expect(state.current === "lift" && state.time >= 3.7 && state.time < 6.3, "the film is in the Lift chapter", state);
      await page.getByRole("button", { name: "Pause film" }).click();
      await page.getByRole("button", { name: "Play film" }).waitFor();
      const paused = await page.evaluate(() => document.querySelector("section[data-film] video")?.paused);
      t.expect(paused === true, "the film stops");
      await t.checkpoint("hero lift chapter", { fullPage: false, settle: false });
      await page.getByRole("button", { name: "Play film" }).click();
    });

    await t.step("the capability deck moves on by itself while on screen", async () => {
      await page.locator("#capabilities").scrollIntoViewIfNeeded();
      await page.locator("#capabilities").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      // A mouse resting over the picture makes the deck wait, so keep the pointer off it.
      await page.mouse.move(1, 1);
      const before = await deckState(page);
      t.expect(before.tabs === 7 && before.visiblePanels === 1, "seven cards, one showing", before);
      await page.waitForFunction((first) => {
        const selected = document.querySelector('#capabilities [role="tab"][aria-selected="true"]')?.textContent?.replace(/^\d+/, "").trim();
        return selected && selected !== first;
      }, before.selected, { timeout: 12000 }).catch(() => undefined);
      const after = await deckState(page);
      t.note("deck before and after waiting", { before, after });
      t.expect(after.selected !== before.selected, "the next card comes up by itself", { before, after });
      await fadesSettled(page);
      await t.checkpoint("deck", { fullPage: false, settle: false });
    });

    await t.step("keyboard focus on a card's link holds the deck; Pause stops it and only Play starts it again", async () => {
      const link = page.locator('#capabilities [role="tabpanel"]:not([hidden]) a').first();
      const name = await textOf(link);
      await link.focus();
      await page.waitForTimeout(8000);
      const held = await page.evaluate(() => {
        const focused = document.activeElement;
        return {
          focused: focused?.tagName === "A" ? (focused.textContent ?? "").replace(/\s+/g, " ").trim() : focused?.tagName ?? null,
          hidden: Boolean(focused?.closest('[role="tabpanel"]')?.hidden),
          auto: document.querySelector("#capabilities")?.getAttribute("data-auto"),
        };
      });
      t.note("after 8 s with focus on the card's link", { name, held });
      t.expect(held.focused === name && !held.hidden, "the focused link is still there and still focused", { name, held });
      t.expect(held.auto === "false", "focus holds the deck", held);
      await page.getByRole("button", { name: "Pause cards" }).click();
      await page.getByRole("button", { name: "Play cards" }).waitFor();
      const paused = await page.evaluate(() => ({
        auto: document.querySelector("#capabilities")?.getAttribute("data-auto"),
        moving: document.querySelectorAll('#capabilities [data-moving="true"]').length,
      }));
      t.expect(paused.auto === "false" && paused.moving === 0, "Pause stops the deck and its pictures", paused);
      await page.getByRole("button", { name: "Play cards" }).click();
      await page.getByRole("button", { name: "Pause cards" }).waitFor();
      await page.mouse.move(1, 1);
      t.expect((await deckState(page)).auto === "true", "Play starts the deck moving on again");
    });

    await t.step("tabs and arrow keys choose a card, and then the deck stays put", async () => {
      await page.getByRole("tab", { name: /Form Check/ }).click();
      t.expect((await deckState(page)).auto === "false", "a chosen card stops the auto-advance");
      await page.locator('[data-scene-cue]').first().waitFor({ timeout: 5000 });
      // Wide cards fill the side beside the portrait photo: its own colours behind, the knee-angle trace on top.
      const wide = await page.evaluate(() => {
        const card = document.querySelector('#capabilities [data-card="form"]');
        const shown = (selector) => {
          const element = card?.querySelector(selector);
          if (!element) return false;
          const box = element.getBoundingClientRect();
          return getComputedStyle(element).display !== "none" && box.width > 0 && box.height > 0;
        };
        // The card's photo: next/image's fill <img> sits straight inside its frame.
        const photo = card?.querySelector("img")?.parentElement?.getBoundingClientRect();
        const trace = card?.querySelector("[data-form-trace]")?.getBoundingClientRect();
        return {
          cardWidth: Math.round(card?.getBoundingClientRect().width ?? 0),
          photoLeft: Math.round((photo?.left ?? 0) - (card?.getBoundingClientRect().left ?? 0)),
          ambient: shown("[data-form-ambient]"),
          trace: shown("[data-form-trace]"),
          traceRight: Math.round((trace?.right ?? 0) - (card?.getBoundingClientRect().left ?? 0)),
          traceText: card?.querySelector("[data-form-trace]")?.textContent ?? "",
        };
      });
      t.note("form check card", wide);
      if (size === "phone") t.expect(!wide.ambient && !wide.trace, "a phone's card is the photo itself, nothing beside it", wide);
      else {
        t.expect(wide.photoLeft > 120, "the portrait photo leaves room on the left of a wide card", wide);
        t.expect(wide.ambient && wide.trace, "that room carries the photo's colours and the knee-angle trace", wide);
        t.expect(wide.traceRight <= wide.photoLeft + 24, "the trace sits beside the photo, never over the athlete", wide);
        t.expect(/Knee angle/.test(wide.traceText) && /Example/.test(wide.traceText), "the trace says what it is and that it is an example", wide);
      }
      await fadesSettled(page);
      await t.checkpoint("deck form check", { fullPage: false, settle: false });
      await page.keyboard.press("ArrowRight");
      const state = await deckState(page);
      t.expect(state.selected === "Fuel", `ArrowRight moves to Fuel (got ${state.selected})`);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
      t.expect(focused === "tab", "focus follows the chosen tab");
    });

    await t.step("the idli example scales by the piece", async () => {
      const card = page.getByRole("group", { name: /Portion example/ });
      await card.scrollIntoViewIfNeeded();
      const before = await textOf(card);
      await card.getByRole("button", { name: "One idli more" }).click();
      const after = await textOf(card);
      t.expect(/≈ 76 g/.test(before) && /≈ 114 g/.test(after), "two idli are 76 g, three are 114 g", { before, after });
      await fadesSettled(page);
      await t.checkpoint("deck fuel", { fullPage: false, settle: false });
    });

    await t.step("the seventh card, Explore, shows its own photo", async () => {
      await page.getByRole("tab", { name: /Explore$/ }).click();
      await page.locator("#capabilities").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      const state = await deckState(page);
      t.expect(state.selected === "Explore" && state.visiblePanels === 1, `the Explore card shows (got ${state.selected})`, state);
      await page.waitForFunction(() => {
        const image = document.querySelector('#capabilities [data-card="explore"] img');
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
      }, null, { timeout: 8000 }).catch(() => undefined);
      await fadesSettled(page);
      await t.checkpoint("deck explore", { fullPage: false, settle: false });
    });

    await t.step("the idea lands word by word", async () => {
      const heading = page.getByRole("heading", { name: /Train\. Eat\. Move\. Progress\./ });
      await heading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1300);
      const opacity = await heading.evaluate((element) => Math.min(...[...element.querySelectorAll("span")].map((span) => Number(getComputedStyle(span).opacity))));
      t.expect(opacity > 0.99, `every word shows (lowest opacity ${opacity})`);
      await t.checkpoint("idea", { fullPage: false });
    });

    await t.step("the contact cards link to the owner's Instagram and email", async () => {
      const instagram = page.getByRole("link", { name: /^Instagram @/ }).first();
      await instagram.scrollIntoViewIfNeeded();
      const href = await instagram.getAttribute("href");
      t.expect(/^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/.test(href ?? ""), `instagram link ${href}`);
      t.expect((await instagram.getAttribute("target")) === "_blank" && /noopener/.test((await instagram.getAttribute("rel")) ?? ""), "opens safely in a new tab");
      const mail = page.getByRole("link", { name: /^Email .+@.+/ }).first();
      t.expect(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test((await mail.getAttribute("href")) ?? ""), "mailto link");
      t.expect(await page.getByRole("button", { name: "Copy email address" }).isVisible(), "copy button");
      if (size === "desktop") {
        await mail.hover();
        await page.waitForTimeout(700);
      }
      const shot = await t.checkpoint("contact", { fullPage: false });
      t.expect(!shot.overflow?.overflow, "no sideways scroll at the contact cards", shot.overflow);
    });

    await t.step("the whole page is short and never scrolls sideways", async () => {
      const height = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, viewport: window.innerHeight }));
      t.note("page height", height);
      t.expect(height.page <= height.viewport * 6.5, `a few screens, not an endless scroll (${(height.page / height.viewport).toFixed(1)} screens)`, height);
      const shot = await t.checkpoint("full page");
      t.expect(!shot.overflow?.overflow, "no sideways scroll", shot.overflow);
    });

    await t.step("reduced motion: the film's still frame, a static chapter list, no auto-advance, no loader", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await t.goto("/", { label: "home reduced motion" });
      await skipFilmIfShown(t);
      const still = await page.evaluate(() => ({
        film: document.querySelector("section[data-film]")?.getAttribute("data-film"),
        videos: document.querySelectorAll("section[data-film] video").length,
        railButtons: document.querySelectorAll("[data-chapter] button").length,
        auto: document.querySelector("#capabilities")?.getAttribute("data-auto"),
      }));
      t.note("reduced", still);
      t.expect(still.film === "still" && still.videos === 0 && still.railButtons === 0, "no film, the chapters as a plain list", still);
      t.expect(still.auto === "false", "the deck does not move by itself", still);
      const log = await t.rootLog();
      t.expect(!log.some((entry) => entry.name === "data-fitx-loader" && entry.value === "on"), "no brand loader with reduced motion", log);
      await t.checkpoint("reduced motion hero", { fullPage: false });
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
