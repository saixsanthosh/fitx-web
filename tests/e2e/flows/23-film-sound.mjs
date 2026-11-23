// Flow 23: film sound (BRIEF-2 3.4) under Chrome's own autoplay policy (sound needs a gesture). Without the fixture the
// films have no sound yet, so there is no "Sound" control at all. With the fixture (a 2 s tone as the film's sound):
// the film starts muted with "Sound" off; a stored "on" is tried as the film starts, and before the visitor has
// touched the page Chrome refuses it, which shows "Tap for sound"; a tap on Sound then starts the audio element in the
// gesture. Nothing before that tap is a user gesture (navigations only), because Chrome lets a page play sound once
// the visitor has interacted with the site, and the refusal is what this flow checks.
import { recordMediaPlays, serveFilmFixture } from "../fixtures/films/route.mjs";

const plays = (page) => page.evaluate(() => (window.__e2ePlays ?? []).map((entry) => ({ ...entry })));
const soundPlays = async (page) => (await plays(page)).filter((entry) => entry.tag === "audio");

/** Opens the intro film on request and waits until its video plays; slows it so the checks fit inside the 2 s film. */
async function openFilm(t, page) {
  await page.goto("/?intro=video", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-fitx-intro-ready") === "video", null, { timeout: 15000 });
  await page.evaluate(() => {
    const video = document.querySelector("video[data-fitx-film-video]");
    if (video) video.playbackRate = 0.2;
  });
}

async function closeFilm(page) {
  const skip = page.getByRole("button", { name: /^Skip intro/ });
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-fitx-intro"), null, { timeout: 8000 });
}

export const flow = {
  id: "23-film-sound",
  title: "Film sound: muted by default, a refused stored choice asks for a tap, Sound starts it in the tap",
  browser: { autoplayPolicy: "default" },
  schemes: () => ["light"],
  async run(t) {
    const page = await t.open();
    await recordMediaPlays(t.context);

    await t.step("without sound in the manifest there is no Sound control", async () => {
      await openFilm(t, page);
      t.expect((await page.getByRole("button", { name: "Sound" }).count()) === 0, "no Sound button for a film without sound");
      t.expect((await soundPlays(page)).length === 0, "nothing tried to play sound");
    });

    const asked = await serveFilmFixture(t);

    await t.step("with sound: the film starts muted and the Sound toggle is off", async () => {
      await openFilm(t, page);
      const sound = page.getByRole("button", { name: "Sound" });
      await sound.waitFor({ state: "visible", timeout: 5000 });
      t.expect((await sound.getAttribute("aria-pressed")) === "false", "Sound starts off");
      t.expect((await soundPlays(page)).length === 0, "no sound until asked", await plays(page));
      const video = (await plays(page)).find((entry) => entry.tag === "video");
      t.expect(video?.muted === true, "the picture plays muted", video);
      t.expect(!(await page.getByText("Tap for sound").isVisible()), "no hint without a stored choice");
      await t.checkpoint("film with Sound off", { fullPage: false, settle: false });
    });

    await t.step("a stored on is tried as the film starts; Chrome refuses it without a gesture, so it asks for a tap", async () => {
      await page.evaluate(() => window.localStorage.setItem("fitx-film-sound", "on"));
      await openFilm(t, page);
      await page.waitForFunction(() => (window.__e2ePlays ?? []).some((entry) => entry.tag === "audio" && entry.result !== "pending"), null, { timeout: 5000 });
      const audio = await soundPlays(page);
      t.note("audio plays before any gesture", audio);
      t.expect(audio.length === 1 && audio[0].result === "NotAllowedError", "the stored on was tried and refused", audio);
      await page.getByText("Tap for sound").waitFor({ state: "visible", timeout: 5000 });
      t.expect((await page.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed")) === "false", "Sound reads off while refused");
      await t.checkpoint("Tap for sound", { fullPage: false, settle: false });
    });

    await t.step("a tap on Sound starts the audio element in the gesture and clears the hint", async () => {
      await page.getByRole("button", { name: "Sound" }).click();
      await page.waitForFunction(() => (window.__e2ePlays ?? []).filter((entry) => entry.tag === "audio").some((entry) => entry.result === "played"), null, { timeout: 5000 });
      const audio = await soundPlays(page);
      t.note("audio plays after the tap", audio);
      t.expect(audio.at(-1)?.result === "played" && audio.at(-1)?.src.endsWith("/__fitx-fixture/films/intro/sound.m4a"), "the film's own sound played", audio);
      t.expect(asked.includes("/__fitx-fixture/films/intro/sound.m4a"), "the sound file was fetched", asked);
      t.expect((await page.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed")) === "true", "Sound reads on");
      t.expect(!(await page.getByText("Tap for sound").isVisible()), "the hint goes once the sound plays");
      t.expect((await page.evaluate(() => window.localStorage.getItem("fitx-film-sound"))) === "on", "the choice is remembered");
      await t.checkpoint("film with Sound on", { fullPage: false, settle: false });
      await closeFilm(page);
    });
  },
};
