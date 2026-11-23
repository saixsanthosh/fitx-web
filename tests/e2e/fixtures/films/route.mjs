// The film fixture for e2e flows 01, 22 and 23 (BRIEF-2 3.4, "Fixtures"): sets the fitx_film_fixture=1 cookie (the
// e2e build has NEXT_PUBLIC_FITX_FILM_FIXTURE=1, so the page then plays src/components/brand/films/fixture.ts) and
// fulfils /__fitx-fixture/films/... from the files made by make.mjs next to this file. Returns the list of fixture
// paths the page asked for, in order.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  [/-hevc60\.mp4$/, "pattern-hevc60.mp4", "video/mp4"],
  [/-avc30\.mp4$/, "pattern-avc30.mp4", "video/mp4"],
  [/\.webp$/, "poster.webp", "image/webp"],
  [/\.m4a$/, "tone.m4a", "audio/mp4"],
];
const bodies = new Map(FILES.map(([, name]) => [name, readFileSync(path.join(HERE, name))]));

export async function serveFilmFixture(t, page = t.page) {
  const asked = [];
  await t.context.addCookies([{ name: "fitx_film_fixture", value: "1", url: t.appUrl }]);
  await page.route("**/__fitx-fixture/films/**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname);
    const match = FILES.find(([pattern]) => pattern.test(url.pathname));
    if (!match) return route.fulfill({ status: 404, body: "" });
    const body = bodies.get(match[1]);
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      return route.fulfill({
        status: 206,
        headers: { "Content-Type": match[2], "Content-Range": `bytes ${start}-${end}/${body.length}`, "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
        body: body.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 200, headers: { "Content-Type": match[2], "Accept-Ranges": "bytes", "Cache-Control": "no-store" }, body });
  });
  return asked;
}

/**
 * Records every media play() and whether it went through, in `window.__e2ePlays` (for the sound checks). With
 * `strictAutoplay`, an unmuted play() outside a user gesture (no transient activation) is refused with NotAllowedError,
 * as Safari and a fresh Chrome profile do: headless Chrome lets it through even under its default policy, so the
 * refusal is made here. A play() called synchronously inside a tap still has the activation and goes through.
 */
export async function recordMediaPlays(context, { strictAutoplay = false } = {}) {
  await context.addInitScript((strict) => {
    const plays = [];
    Object.defineProperty(window, "__e2ePlays", { value: plays });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play() {
      const active = navigator.userActivation ? navigator.userActivation.isActive : true;
      const entry = { src: this.currentSrc || this.src || "", tag: this.tagName.toLowerCase(), muted: this.muted, gesture: active, result: "pending" };
      plays.push(entry);
      const result = strict && !this.muted && !active
        ? Promise.reject(new DOMException("play() needs a user gesture", "NotAllowedError"))
        : original.call(this);
      Promise.resolve(result).then(() => { entry.result = "played"; }, (error) => { entry.result = error?.name ?? "error"; });
      return result;
    };
  }, strictAutoplay);
}
