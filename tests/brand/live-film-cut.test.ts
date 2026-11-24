import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILM_CUT_ATTR } from "@/components/brand/films/compositions";
import { RESIZE_SETTLE_MS } from "@/components/brand/films/timing";

// CinematicIntro, FilmVideo and IntroFilmOverlay are JSX, which `node --test` cannot load, so their source is checked.
const source = (file: string) => readFileSync(file, "utf8");
const intro = source("src/components/brand/CinematicIntro.tsx");
const effect = intro.slice(intro.indexOf("const liveFilm = "), intro.indexOf("}, [liveFilm]);"));
const begin = intro.slice(intro.indexOf("const begin = useCallback("), intro.indexOf("const onSceneReady = "));

test("the live film (?intro=live) marks its composition again once a resize settles, so the matte and the callouts follow its camera", () => {
  assert.ok(effect.length > 0 && begin.length > 0, "the effect and begin are where the test expects them");
  // Only while the live intro film is on screen: never for the welcome film, the pre-rendered cut or the static mark.
  assert.match(intro, /const liveFilm = film === "intro" && source === "live" && \(playback === "loading" \|\| playback === "three"\);/);
  assert.match(effect, /if \(!liveFilm\) return;/);
  assert.match(effect, /window\.addEventListener\("resize", onResize\);/);
  assert.match(effect, /window\.clearTimeout\(timer\);\s*window\.removeEventListener\("resize", onResize\);/);
  // Settled: a burst of resize events marks once, RESIZE_SETTLE_MS after the last one, as long as FilmVideo waits to swap.
  assert.match(effect, /window\.clearTimeout\(timer\);\s*timer = window\.setTimeout\(\(\) => \{/);
  assert.match(effect, /\}, RESIZE_SETTLE_MS\);/);
  assert.equal(RESIZE_SETTLE_MS, 220);
  assert.match(source("src/components/brand/films/FilmVideo.tsx"), /resizeTimer = window\.setTimeout\(\(\) => \{[\s\S]*?\}, RESIZE_SETTLE_MS\);/);
  // Still the live film when it fires: after a fallback to the cut, FilmVideo marks its own swaps.
  assert.match(effect, /if \(!activeRef\.current \|\| sourceRef\.current !== "live"\) return;/);
  // begin's rule, for the attribute and its poster: the band by the viewport's aspect among the intro's compositions.
  for (const block of [begin, effect]) {
    assert.match(block, /const comp = pickComposition\(window\.innerWidth, window\.innerHeight, manifest\?\.comps\);/);
    assert.match(block, /\.setAttribute\(FILM_CUT_ATTR, comp\);/);
    assert.match(block, /\.style\.setProperty\(FILM_POSTER_VAR, `url\("\$\{poster\}"\)`\);/);
  }
  // Only a change is written, so a resize inside the band leaves the attribute, and the overlay, alone.
  assert.match(effect, /if \(root\.getAttribute\(FILM_CUT_ATTR\) === comp\) return;/);
});

test("the film graphics follow data-fitx-film-cut as it changes", () => {
  assert.equal(FILM_CUT_ATTR, "data-fitx-film-cut");
  const overlay = source("src/components/brand/IntroFilmOverlay.tsx");
  assert.match(overlay, /observer\?\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \[FILM_CUT_ATTR\] \}\);/);
  assert.match(overlay, /const sync = \(\) => setComp\(readComposition\(\)\);/);
  assert.match(overlay, /const attribute = document\.documentElement\.getAttribute\(FILM_CUT_ATTR\);/);
});
