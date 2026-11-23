// Flow 22: the film's composition per device (BRIEF-2 3.1). The head script marks <html data-fitx-film-cut> from the
// viewport's aspect and preloads that composition's poster from the manifest (today's seed cuts: portrait for phone
// and tablet-p, landscape for the rest), a square window gets the landscape composition, the player loads the cut for
// it, and with the film fixture a Replay plays to the end and gives the page back on its own.
import { serveFilmFixture } from "../fixtures/films/route.mjs";

const EXPECTED = {
  phone: { comp: "phone", shape: "portrait" },
  tablet: { comp: "tablet-p", shape: "portrait" },
  desktop: { comp: "laptop", shape: "landscape" },
};

/** What the head script and the player left on the page. */
const filmState = (page) => page.evaluate(() => ({
  cut: document.documentElement.getAttribute("data-fitx-film-cut"),
  film: document.documentElement.getAttribute("data-fitx-film"),
  intro: document.documentElement.getAttribute("data-fitx-intro"),
  ready: document.documentElement.getAttribute("data-fitx-intro-ready"),
  posterVar: document.documentElement.style.getPropertyValue("--fitx-film-poster"),
  preloads: [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((link) => new URL(link.href).pathname),
  variant: document.querySelector("video[data-fitx-film-video]")?.dataset.variant ?? null,
}));

async function skipIfPlaying(page) {
  const skip = page.getByRole("button", { name: /^Skip intro/ });
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-fitx-intro"), null, { timeout: 8000 });
}

export const flow = {
  id: "22-film-cuts",
  title: "Film cuts: composition attribute and poster per device, a square window, Replay plays to the end",
  sizes: ["phone", "tablet", "desktop"],
  schemes: (schemes) => schemes,
  async run(t, { size, scheme }) {
    const page = await t.open();
    const expected = EXPECTED[size];
    const theme = scheme === "dark" ? "dark" : "light";

    await t.step("the head script marks the composition and preloads its poster", async () => {
      await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
      const early = await filmState(page);
      t.note("on first paint", early);
      t.expect(early.cut === expected.comp, `the cut attribute should be ${expected.comp}`, early);
      t.expect(early.film === "intro", "the intro is the film claimed", early);
      const poster = `/brand/intro/fitx-intro-${theme}-${expected.shape}.webp`;
      t.expect(early.preloads.includes(poster), `the ${expected.shape} poster should be preloaded`, early);
      t.expect(early.posterVar.includes(poster), "the overlay's poster follows it", early);
      await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
      const playing = await filmState(page);
      t.note("playing", playing);
      t.expect(playing.variant?.includes(`-${expected.shape}-`), `the player loads the ${expected.shape} cut`, playing);
      await t.checkpoint("film playing", { fullPage: false, settle: false });
      await skipIfPlaying(page);
      const after = await filmState(page);
      t.expect(after.film === null, "the claim goes with the film", after);
    });

    if (size === "desktop") {
      await t.step("a square window gets the landscape composition (tablet-l), not a portrait frame", async () => {
        await page.setViewportSize({ width: 1000, height: 1000 });
        await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
        const square = await filmState(page);
        t.note("square window", square);
        t.expect(square.cut === "tablet-l", "1000×1000 is tablet-l", square);
        t.expect(square.preloads.includes(`/brand/intro/fitx-intro-${theme}-landscape.webp`), "its poster is the landscape one", square);
        await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
        t.expect((await filmState(page)).variant?.includes("-landscape-"), "and so is its cut");
        await t.checkpoint("square window film", { fullPage: false, settle: false });
        await skipIfPlaying(page);
        await page.setViewportSize({ width: 1440, height: 900 });
      });
    }

    await t.step("with the fixture, a Replay plays the film to its end and gives the page back by itself", async () => {
      const asked = await serveFilmFixture(t);
      await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
      const first = await filmState(page);
      t.expect(first.preloads.includes(`/__fitx-fixture/films/intro/${expected.comp}-${theme}.webp`), "the fixture's poster for this composition", first);
      await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-fitx-intro"), null, { timeout: 12000 });
      t.note("fixture files asked for", asked);
      t.expect(asked.some((file) => file.startsWith(`/__fitx-fixture/films/intro/${expected.comp}-${theme}-`) && file.endsWith(".mp4")), "the cut for this composition and theme played", asked);
      await t.settle(1500);
      const replay = page.getByRole("button", { name: "Replay intro" }).first();
      await replay.scrollIntoViewIfNeeded();
      const before = asked.length;
      await replay.click();
      await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
      t.expect((await filmState(page)).cut === expected.comp, "Replay marks the same composition");
      const started = Date.now();
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-fitx-intro"), null, { timeout: 12000 });
      t.note("replay ran for (ms)", Date.now() - started);
      t.expect(asked.length > before, "Replay loaded the cut again", asked);
      t.expect((await filmState(page)).film === null, "nothing is claimed once it ended");
      await t.checkpoint("after replay");
    });
  },
};
