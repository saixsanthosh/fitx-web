// Flow 22: the film's composition per device (BRIEF-2 3.1). The head script marks <html data-fitx-film-cut> from the
// viewport's aspect and preloads that composition's poster from the manifest (S6's cuts: one cut and one poster per
// composition and theme, in public/brand/films/intro/<rev8>/), a square window gets the tablet-l composition, the
// player loads the cut for it, and with the film fixture a Replay plays to the end and gives the page back on its own.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveFilmFixture } from "../fixtures/films/route.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The composition each e2e size is served (390×844 phone, 820×1180 tablet, 1440×900 desktop). */
const EXPECTED = {
  phone: { comp: "phone" },
  tablet: { comp: "tablet-p" },
  desktop: { comp: "laptop" },
};

/** S6's intro manifest, as the build serves it (src/components/brand/films/cuts.generated.ts). */
async function introManifest() {
  const { FILM_MANIFESTS } = await import(pathToFileURL(path.join(ROOT, "src/components/brand/films/cuts.generated.ts")).href);
  return FILM_MANIFESTS.intro;
}

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
      const intro = await introManifest();
      await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
      const early = await filmState(page);
      t.note("on first paint", early);
      t.expect(early.cut === expected.comp, `the cut attribute should be ${expected.comp}`, early);
      t.expect(early.film === "intro", "the intro is the film claimed", early);
      const poster = intro.posters[`${expected.comp}-${theme}`];
      t.expect(poster === `/brand/films/intro/${intro.rev}/${expected.comp}-${theme}.webp`, "S6's poster for this composition and theme", poster);
      t.expect(early.preloads.includes(poster), `the ${expected.comp} poster should be preloaded`, early);
      t.expect(early.posterVar.includes(poster), "the overlay's poster follows it", early);
      await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
      const playing = await filmState(page);
      t.note("playing", playing);
      // HEVC 60 where this browser plays it smoothly, else (and on a phone, the light rung) AVC 30.
      t.expect(new RegExp(`^${expected.comp}-${theme}-(hevc60|avc30)\\.mp4$`).test(playing.variant ?? ""), `the player loads the ${expected.comp} cut`, playing);
      await t.checkpoint("film playing", { fullPage: false, settle: false });
      await skipIfPlaying(page);
      const after = await filmState(page);
      t.expect(after.film === null, "the claim goes with the film", after);
    });

    if (size === "desktop") {
      await t.step("a square window gets the tablet-l composition (a landscape frame), not a portrait one", async () => {
        await page.setViewportSize({ width: 1000, height: 1000 });
        await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
        const square = await filmState(page);
        t.note("square window", square);
        t.expect(square.cut === "tablet-l", "1000×1000 is tablet-l", square);
        const intro = await introManifest();
        t.expect(square.preloads.includes(intro.posters[`tablet-l-${theme}`]), "its poster is tablet-l's", square);
        await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
        t.expect((await filmState(page)).variant?.startsWith(`tablet-l-${theme}-`), "and so is its cut");
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
