"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Logo } from "@/components/ui/Logo";
import { FILM_CUT_ATTR, pickComposition, type FilmComposition } from "./films/compositions";
import { manifestFor } from "./films/manifest";
import { LogoReveal } from "./logo/LogoReveal";
import { CALLOUTS, FILM_DURATION, SEED_PLACEMENT, STAGE, TITLES } from "./intro/timeline";
import { CALLOUT_ZONES } from "./overlay-zones";
import {
  BRAND,
  beginningInStage,
  calloutTiming,
  clamp,
  easeOutQuart,
  endCardFor,
  formatCount,
  letterboxTiming,
  liveDuringStage,
  overlayLayoutFor,
  stageRestTime,
  stageStart,
  titleTiming,
  tokenizeCount,
  type CountNumber,
  type CountToken,
  type EndCardKind,
  type FilmCallout,
  type FilmFreeze,
  type FilmTitle,
} from "./introOverlayTiming";
import styles from "./IntroFilmOverlay.module.css";

/**
 * The film's DOM motion graphics: the letterbox, kinetic titles, data callouts (stages 0–5) and
 * the brand end card (stage 6). On the films they were authored for (`overlayLayoutFor`), the matte
 * and the callout areas follow the composition being played (`<html data-fitx-film-cut>`,
 * overlay-zones.ts): a 2.39:1 scope on laptop and desktop, a thin matte on the tablets and the phone.
 * On the 11.9 s cuts encoded before wave 2 they keep wave 1's orientation matte and fixed placements,
 * which those cuts were framed for. React state changes only when the scene reports a stage; every
 * element then runs CSS animations whose delays are film times measured from the *origin* (the
 * `STAGE_START` of the stage in which it mounted). Each element captures its origin once, so a
 * later stage never retimes an animation that is already running, and each is pinned to the film
 * clock when it mounts (`anchorToFilm`), so a slow mount doesn't shift it against the picture.
 *
 * Performance contract (the film plays on low-end phones): every animation here moves only
 * `transform` and `opacity`, at most one animation per property per element, so all of them run
 * on the compositor; the overlay never lays out or paints per frame and runs no script per frame.
 * The main thread still restyles the elements that are mid-animation whenever it renders a frame
 * (Blink does at each animation's start and end, and on every frame while something else, such as
 * a rAF loop, keeps the main thread rendering), which costs no layout or paint. Exceptions: the
 * titles' one-step mask release, and the FITX mark's own formation from globals.css, shared with
 * the static brand. Soft looks (focus pulls, drop shadows) come from copies blurred once at mount
 * and cross-faded; see IntroFilmOverlay.module.css.
 */

type CssVars = Record<`--${string}`, string | number>;
const vars = (values: CssVars) => values as CSSProperties;
const sec = (seconds: number) => `${Math.round(seconds * 1000) / 1000}s`;

const TITLE_INDEX = new Map(TITLES.map((title, index) => [title.text, index]));
const COUNTS = new Map(CALLOUTS.map((callout) => [callout.id, { value: tokenizeCount(callout.value), detail: tokenizeCount(callout.detail) }]));
const LETTERBOX = letterboxTiming();
/** Count-up readouts change at most this often (one reel line per display frame at 60 Hz). */
const COUNT_FPS = 60;
const TAGLINE = Array.from("TRAIN SMART. LIVE FIT.");

// ---------------------------------------------------------------------------------------------
// Film clock

/**
 * The pre-rendered film's own clock: FitxIntroVideo's <video> in the same intro section, while it
 * plays (not in dev review mode, where any video in the section is a stand-in with its own clock).
 */
function filmVideo(element: HTMLElement): HTMLVideoElement | null {
  const section = element.closest<HTMLElement>("[data-fitx-intro-overlay]");
  if (!section || section.hasAttribute("data-intro-debug")) return null;
  const video = section.querySelector("video");
  return video && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? video : null;
}

/**
 * The composition the film is being played in: `<html data-fitx-film-cut>` (set by the head script and
 * the player, and updated on a rotation swap, or for the live film once a resize settles), else the
 * viewport's own band. Follows changes to the attribute, so a swap moves the matte and the callouts
 * with the picture.
 */
function readComposition(): FilmComposition {
  const attribute = document.documentElement.getAttribute(FILM_CUT_ATTR);
  const known: readonly string[] = ["phone", "tablet-p", "tablet-l", "laptop", "desktop"];
  return attribute && known.includes(attribute) ? (attribute as FilmComposition) : pickComposition(window.innerWidth, window.innerHeight);
}

/**
 * The composition the overlay lays itself out for, or null for wave 1's layout (the 11.9 s cuts, see
 * `overlayLayoutFor`). Decided once per mount, like the end card: FilmGraphics remounts per run.
 */
function useFilmComposition(): FilmComposition | null {
  // The film graphics mount only on the client, once a film plays (never in the server HTML).
  const [zoned] = useState(() => typeof document !== "undefined" && overlayLayoutFor(playingDuration()) === "zoned");
  const [comp, setComp] = useState<FilmComposition | null>(() => (zoned ? readComposition() : null));
  useLayoutEffect(() => {
    if (!zoned) return;
    const sync = () => setComp(readComposition());
    const observer = typeof MutationObserver === "function" ? new MutationObserver(sync) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: [FILM_CUT_ATTR] });
    // Without the attribute, the band follows the window.
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [zoned]);
  return comp;
}

/**
 * The length of the film being played: the intro manifest's (or the video's own) when the
 * pre-rendered cut plays, the director's film otherwise.
 */
function playingDuration(): number {
  const section = document.querySelector<HTMLElement>("[data-fitx-intro-overlay]");
  const video = section && !section.hasAttribute("data-intro-debug") ? section.querySelector("video") : null;
  if (!video) return FILM_DURATION;
  const manifest = manifestFor("intro");
  if (manifest && Number.isFinite(manifest.duration) && manifest.duration > 0) return manifest.duration;
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : FILM_DURATION;
}

type ClockReading = { now: number; film: number | null };
let clockReading: ClockReading | null = null;

/**
 * One reading of the film clock per commit, shared by every element it mounts: a video's
 * currentTime holds still until the running script finishes while performance.now() runs on, so
 * reading the pair again after the first element's style flush would place later elements late.
 */
function readFilmClock(element: HTMLElement): ClockReading {
  if (!clockReading) {
    const video = filmVideo(element);
    clockReading = { now: performance.now(), film: video ? video.currentTime : null };
    queueMicrotask(() => { clockReading = null; });
  }
  return clockReading;
}

/**
 * Pins the CSS animations under `element`, all created at its mount and not yet started, to the
 * film clock: their time 0 becomes the moment the film was at `origin`. Left alone they would start
 * at the first frame after the mount, late by however long the stage report, React, style, layout
 * and raster took (several frames on a slow phone), and every later beat of the element would land
 * that late against the picture. The pin only moves that lag into the element's wait before its
 * entrance. An element whose entrance begins sooner (the letterbox bars, the end card) would start
 * mid-curve, so it keeps the browser's start, late but whole; so does a mount without a playing film
 * or before its clock has passed `origin` (WebKit's first frame, which reads 0 until the video runs).
 */
function anchorToFilm(element: HTMLElement, origin: number) {
  const { now, film } = readFilmClock(element);
  const lag = film === null ? 0 : clamp(film - origin, 0, 2) * 1000;
  // Only animations still waiting for their first frame, and only running ones: setting the start
  // time of a paused animation would unpause it and detach it from the CSS pause. All reads first:
  // a CSS animation's getters flush style, so reads between writes would restyle once per write.
  const pending = element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running" && animation.startTime === null);
  const wait = Math.min(...pending.map((animation) => animation.effect?.getTiming().delay ?? 0));
  if (!(lag > 0 && wait > lag)) return;
  for (const animation of pending) animation.startTime = now - lag;
}

/** Anchors each film element (`data-film-origin`) under `rootRef` once, in the commit that mounts it. */
function useFilmAnchors(rootRef: RefObject<HTMLElement | null>, enabled: boolean, stage: number) {
  const anchored = useRef<WeakSet<Element> | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    // Without Element.getAnimations (Safari < 14) the animations keep the browser's frame-based start.
    if (!root || !enabled || typeof root.getAnimations !== "function") return;
    const seen = (anchored.current ??= new WeakSet());
    const elements = [root, ...root.querySelectorAll<HTMLElement>("[data-film-origin]")].filter((element) => element.dataset.filmOrigin !== undefined);
    for (const element of elements) {
      if (seen.has(element)) continue;
      seen.add(element);
      anchorToFilm(element, Number(element.dataset.filmOrigin));
    }
  }, [enabled, rootRef, stage]);
}

/**
 * Exit fades are attached only when the exit begins (`data-exiting`, set here, outside React): a
 * pending opacity animation on a wrapper makes the compositor draw everything animating inside it
 * through an extra offscreen pass for the wrapper's whole life. The cue is the exit's own move (a
 * transform attached at mount, which costs no pass) starting; the fade joins that animation's clock
 * (same origin, delay from the same CSS variable), so it lands exactly when it always did. Dev
 * freezes render `data-exiting` from the start instead.
 */
function joinExit(target: HTMLElement, cue: Element, animationName: string) {
  if (target.hasAttribute("data-exiting")) return;
  target.setAttribute("data-exiting", "");
  if (typeof target.getAnimations !== "function" || typeof CSSAnimation === "undefined") return;
  const reference = cue.getAnimations().find((animation) => animation instanceof CSSAnimation && animation.animationName === animationName);
  const joining = target.getAnimations().filter((animation) => animation !== reference && animation.startTime === null);
  const startTime = reference ? reference.startTime : null;
  const currentTime = reference ? reference.currentTime : null;
  if (currentTime === null) {
    // The move was cancelled before its start event arrived: the exit is over, so land the fade at
    // its end.
    joining.forEach((animation) => animation.finish());
    return;
  }
  const paused = joining.map((animation) => animation.playState === "paused");
  joining.forEach((animation, i) => {
    // Paused (tab hidden, buffering): keep it under the CSS pause and match the cue's time instead.
    // So too while the cue waits for its next frame to resume (no start time yet): a fade given no
    // start time would sit at its first frame, paused for good.
    if (paused[i] || startTime === null) animation.currentTime = currentTime;
    else animation.startTime = startTime;
  });
}

/**
 * Listens for the start of `cueRef`'s own exit move and then joins `targetRef`'s fade to it. A native
 * listener on the cue alone: a React handler would build a synthetic event for every animation of
 * the letters inside that bubbles through it.
 */
function useExitCue(cueRef: RefObject<HTMLElement | null>, targetRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const cue = cueRef.current;
    const target = targetRef.current;
    if (!cue || !target || !enabled) return;
    const onStart = (event: AnimationEvent) => {
      // The cue's own move: events bubble up from the letters inside it, and a pseudo-element's
      // animations report the cue as their target too.
      if (event.target !== cue || event.pseudoElement) return;
      cue.removeEventListener("animationstart", onStart);
      joinExit(target, cue, event.animationName);
    };
    cue.addEventListener("animationstart", onStart);
    return () => cue.removeEventListener("animationstart", onStart);
  }, [cueRef, enabled, targetRef]);
}

/**
 * Dev review freeze: pause every animation under `root` at its resting frame (stage freeze) or at one
 * film time (time freeze). Elements carry `data-film-origin` (film time of their animations'
 * currentTime 0) and optionally `data-film-rest` (their own resting film time).
 */
function seekFrozen(root: HTMLElement, freeze: FilmFreeze) {
  const fallback = freeze.kind === "time" ? freeze.time : stageRestTime(freeze.stage);
  const clocks = [root, ...root.querySelectorAll<HTMLElement>("[data-film-origin]")].filter((element) => element.dataset.filmOrigin !== undefined);
  clocks.forEach((element) => {
    const origin = Number(element.dataset.filmOrigin);
    const rest = Number(element.dataset.filmRest);
    const time = freeze.kind === "stage" && Number.isFinite(rest) ? rest : fallback;
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = Math.max(0, (time - origin) * 1000);
    }
  });
}

function useFrozenClock(rootRef: RefObject<HTMLElement | null>, freeze: FilmFreeze | null, stage: number) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && freeze) seekFrozen(root, freeze);
  }, [freeze, rootRef, stage]);
}

// ---------------------------------------------------------------------------------------------
// Kerning

/**
 * Letters are separate boxes (each animates on its own), which drops the font's pair kerning; at
 * 160px "AT" would open by ~10px. Each pair is measured with canvas (kerning on, as the browser
 * shapes text) and restored as a margin (`--kern`, em) on every copy of the word, matched by letter
 * index. Like the browser's own shaping, pairs across a space or a change of font (a bold dot) are
 * not kerned. Kerns are measured once per word (module scope, so replays reuse them), ahead of time
 * while the film's first shot plays (`primeKerns`), and rendered inline with the letters, so a
 * mount neither measures nor restyles anything for them.
 */
type KernKind = "title" | "tagline";
const KERNS = new Map<string, readonly number[]>();
const kernKey = (kind: KernKind, text: string) => `${kind}\n${text}`;

const fontOf = (style: CSSStyleDeclaration) => `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;

function measureKerns(letters: readonly string[], fonts: readonly string[]): number[] | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const width = (text: string) => context.measureText(text).width;
  return letters.map((letter, i) => {
    const previous = i > 0 ? letters[i - 1] : "";
    if (i === 0 || fonts[i] !== fonts[i - 1] || !previous.trim() || !letter.trim()) return 0;
    context.font = fonts[i];
    return Math.round((width(previous + letter) - width(previous) - width(letter)) * 10) / 1000;
  });
}

const kernStyle = (kerns: readonly number[] | undefined, i: number): CssVars => (kerns?.[i] ? { "--kern": `${kerns[i]}em` } : {});

/** Fonts are ready when they are loaded (or failed and fell back, which is what the page shows too). */
const fontsSettled = () => !document.fonts || document.fonts.status === "loaded";

/**
 * Resolves once these faces are in or have failed, which is what the page shows too. load() starts
 * any face nothing has asked for yet (the document's font status alone reads "loaded" before that).
 * It rejects as soon as one face of a family list fails, such as next/font's local() fallback where
 * that font isn't installed, while the web face may still be loading: so the document's fonts must
 * also settle.
 */
function whenFontsIn(fonts: readonly string[]): Promise<unknown> {
  if (typeof document.fonts?.load !== "function") return Promise.resolve();
  return Promise.all(fonts.map((font) => document.fonts.load(font).catch(() => undefined)))
    .then(() => document.fonts.ready)
    .catch(() => undefined);
}

/**
 * Measures every title word and the tagline while the cold open plays. A display:none probe gives
 * the real computed fonts (no layout, no paint); they are measured once those faces are in.
 */
function primeKerns(root: HTMLElement) {
  const probe = document.createElement("div");
  probe.className = styles.kernProbe;
  const title = probe.appendChild(document.createElement("div"));
  title.className = styles.title;
  const titleGlyph = title.appendChild(document.createElement("span"));
  titleGlyph.className = styles.glyph;
  const tagline = probe.appendChild(document.createElement("p"));
  tagline.className = styles.tagline;
  const tagLetter = tagline.appendChild(document.createElement("span"));
  const tagBold = tagline.appendChild(document.createElement("b"));
  tagLetter.className = styles.tagLetter;
  tagBold.className = styles.tagLetter;
  root.appendChild(probe);
  const titleFont = fontOf(getComputedStyle(titleGlyph));
  const tagFont = fontOf(getComputedStyle(tagLetter));
  const tagBoldFont = fontOf(getComputedStyle(tagBold));
  probe.remove();

  const measure = () => {
    for (const { text } of TITLES) {
      const letters = Array.from(text);
      const kerns = measureKerns(letters, letters.map(() => titleFont));
      if (kerns) KERNS.set(kernKey("title", text), kerns);
    }
    const kerns = measureKerns(TAGLINE, TAGLINE.map((letter) => (letter === "." ? tagBoldFont : tagFont)));
    if (kerns) KERNS.set(kernKey("tagline", TAGLINE.join("")), kerns);
  };
  void whenFontsIn([titleFont, tagFont, tagBoldFont]).then(measure);
}

/**
 * Fallback for a word mounted before `primeKerns` ran (a dev freeze, or fonts still loading): measure
 * the mounted letters, write every pair (zeros too, so a re-measure after the fonts load can clear a
 * kern taken from the fallback face) and keep the result once the fonts are in.
 */
function useGlyphKerning(rootRef: RefObject<HTMLElement | null>, key: string, needed: boolean) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !needed) return;
    let live = true;
    const apply = () => {
      const rows = root.matches("[data-glyph-row]") ? [root] : Array.from(root.querySelectorAll<HTMLElement>("[data-glyph-row]"));
      const reference = rows.length > 0 ? Array.from(rows[0].querySelectorAll<HTMLElement>("[data-glyph]")) : [];
      if (!live || reference.length < 2) return;
      const kerns = measureKerns(reference.map((glyph) => glyph.textContent ?? ""), reference.map((glyph) => fontOf(getComputedStyle(glyph))));
      if (!kerns) return;
      if (fontsSettled()) KERNS.set(key, kerns);
      rows.forEach((row) => {
        row.querySelectorAll<HTMLElement>("[data-glyph]").forEach((glyph, i) => {
          glyph.style.setProperty("--kern", `${kerns[i] ?? 0}em`);
        });
      });
    };
    apply();
    if (!fontsSettled()) document.fonts.ready.then(apply).catch(() => undefined);
    return () => { live = false; };
  }, [key, needed, rootRef]);
}

// ---------------------------------------------------------------------------------------------

type FilmGraphicsProps = {
  stage: number;
  /** Time of day of the film: sunrise (light) or night (dark). */
  theme: "light" | "dark";
  /** Dev-only review freeze; null during real playback. */
  freeze: FilmFreeze | null;
};

/** Letterbox, titles and callouts. Mount only while the 3D film plays; remount (key) per run. */
export function FilmGraphics({ stage, theme, freeze }: FilmGraphicsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const comp = useFilmComposition();
  const origin = stageStart(stage);
  const frozen = freeze !== null;
  const titles = freeze?.kind === "stage" ? beginningInStage(TITLES, stage) : liveDuringStage(TITLES, stage);
  const callouts = freeze?.kind === "stage" ? beginningInStage(CALLOUTS, stage) : liveDuringStage(CALLOUTS, stage);
  useFrozenClock(rootRef, freeze, stage);
  useFilmAnchors(rootRef, !frozen, stage);

  useEffect(() => {
    // Measure the kerning of every later word while the cold open plays, off the critical path.
    const root = rootRef.current;
    if (!root || KERNS.size > TITLES.length) return;
    const prime = () => primeKerns(root);
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prime, { timeout: 700 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prime, 250);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div ref={rootRef} className={styles.film} aria-hidden="true" data-film-graphics data-comp={comp ?? undefined}>
      {stage >= LETTERBOX.outStage
        ? <LetterboxBars key="out" phase="out" origin={origin} />
        : <LetterboxBars key="in" phase="in" origin={origin} />}
      {stage === STAGE.coldOpen && <ColdOpenSlate theme={theme} origin={origin} />}
      {titles.map((title) => (
        <KineticTitle key={title.text} title={title} index={TITLE_INDEX.get(title.text) ?? 0} origin={origin} frozen={frozen} />
      ))}
      {callouts.map((callout) => <DataCallout key={callout.id} callout={callout} comp={comp} origin={origin} frozen={frozen} />)}
    </div>
  );
}

function LetterboxBars({ phase, origin }: { phase: "in" | "out"; origin: number }) {
  const [mountOrigin] = useState(origin);
  const at = phase === "in" ? LETTERBOX.inAt : LETTERBOX.outAt;
  return (
    <div
      className={`${styles.letterbox} ${phase === "in" ? styles.barsIn : styles.barsOut}`}
      data-film-origin={mountOrigin}
      style={vars({ "--lb-at": sec(at - mountOrigin), "--lb-dur": sec(phase === "in" ? LETTERBOX.in : LETTERBOX.out) })}
    >
      <i className={`${styles.bar} ${styles.barTop}`} />
      <i className={`${styles.bar} ${styles.barBottom}`} />
    </div>
  );
}

/**
 * The cold open's time-of-day card, set in the bottom matte like a film super. The session line
 * tracks in letter by letter (each letter slides from its wide-tracked position: the monospace
 * face makes that exactly the old letter-spacing tween, without relayout).
 */
function ColdOpenSlate({ theme, origin }: { theme: "light" | "dark"; origin: number }) {
  const [mountOrigin] = useState(origin);
  const end = stageStart(STAGE.run);
  const session = Array.from(theme === "dark" ? "NIGHT SESSION" : "MORNING SESSION");
  return (
    <div
      className={styles.slate}
      data-film-origin={mountOrigin}
      data-film-rest={end * 0.62}
      style={vars({ "--at": sec(end * 0.3 - mountOrigin), "--hold": sec(end * 0.56), "--out": sec(0.18) })}
    >
      <span className={styles.slateFade}>{theme === "dark" ? "21:40" : "06:12"}</span>
      <i className={styles.slateFade} />
      <span>
        {session.map((letter, i) => (
          <span key={i} className={styles.slateLetter} style={vars({ "--i": i })}>{letter}</span>
        ))}
      </span>
    </div>
  );
}

/** One copy of the title word (shadow, out-of-focus twin, sharp fill or exit blur); see the CSS. */
function GlyphRow({ letters, kerns, className, dot }: { letters: string[]; kerns: readonly number[] | undefined; className: string; dot: boolean }) {
  return (
    <span className={`${styles.glyphRow} ${className}`} data-glyph-row>
      {letters.map((letter, i) => (
        <span key={i} className={styles.glyph} data-glyph style={vars({ "--i": i, ...kernStyle(kerns, i) })}>{letter}</span>
      ))}
      {dot && <span className={styles.titleDot} style={vars({ "--i": letters.length })} />}
    </span>
  );
}

type KineticTitleProps = { title: FilmTitle; index: number; origin: number; frozen: boolean };

function KineticTitleBlock({ title, index, origin, frozen }: KineticTitleProps) {
  const [mountOrigin] = useState(origin);
  const titleRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLDivElement>(null);
  const timing = titleTiming(title);
  const letters = Array.from(title.text);
  const key = kernKey("title", title.text);
  const kerns = KERNS.get(key);
  useGlyphKerning(titleRef, key, kerns === undefined);
  // The exit's move (on .titleExit, attached at mount) starting cues its fade.
  useExitCue(exitRef, exitRef, !frozen);
  const at = title.start - mountOrigin;
  return (
    <div
      className={styles.titleBlock}
      data-title={title.text.toLowerCase()}
      data-film-origin={mountOrigin}
      data-film-rest={title.start + timing.rest}
      style={vars({
        "--at": sec(at),
        "--dur": sec(timing.duration),
        "--reveal": sec(timing.reveal),
        "--stagger": sec(timing.stagger),
        "--landed": sec(timing.reveal + timing.stagger * (letters.length - 1)),
        "--exit": sec(timing.exit),
        "--exit-at": sec(at + timing.exitAt),
      })}
    >
      <span className={styles.scrimExit}>
        <span className={styles.titleScrim} />
      </span>
      <div ref={titleRef} className={styles.title}>
        <div ref={exitRef} className={styles.titleExit} data-exiting={frozen ? "" : undefined}>
          <span className={styles.titleKicker}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <i />
          </span>
          <span className={styles.titleWord}>
            <GlyphRow letters={letters} kerns={kerns} className={styles.rowShade} dot />
            <GlyphRow letters={letters} kerns={kerns} className={styles.rowTwin} dot={false} />
            <GlyphRow letters={letters} kerns={kerns} className={styles.rowFill} dot />
          </span>
        </div>
        {/* Outside the exit's fade: the blurred copy takes over as the sharp title leaves. */}
        <GlyphRow letters={letters} kerns={kerns} className={styles.rowExit} dot />
      </div>
    </div>
  );
}

/** Stage changes re-render FilmGraphics; a mounted title keeps its own clock, so it never needs to. */
const KineticTitle = memo(KineticTitleBlock, (a, b) => a.title === b.title && a.index === b.index && a.frozen === b.frozen);

/**
 * A count-up readout as a reel: every frame of the count (`formatCount` along `easeOutQuart`,
 * sampled at COUNT_FPS) is one line of a tall text block that steps up behind a one-line window.
 * A stepped transform on the compositor replaces per-frame text writes (and their relayout and
 * repaint); the CSS delay, pause-while-hidden and dev freezes apply to it for free.
 */
function CountReel({ token, steps }: { token: CountNumber; steps: number }) {
  const frames = Array.from({ length: steps + 1 }, (_, k) => (k === steps ? token.text : formatCount(token, easeOutQuart(k / steps))));
  return (
    <span className={styles.num}>
      {/* The ghost holds the widest frame's width, so the chip never jitters while counting. */}
      <span className={styles.numGhost}>{token.widest}</span>
      <span className={styles.numWindow}>
        <span className={styles.numReel} style={vars({ "--steps": steps })}>{frames.join("\n")}</span>
      </span>
    </span>
  );
}

function CountText({ tokens, steps, className }: { tokens: CountToken[]; steps: number; className?: string }) {
  return (
    <span className={className}>
      {tokens.map((token, i) => (token.kind === "text"
        ? <span key={i} className={styles.unit}>{token.text}</span>
        : <CountReel key={i} token={token} steps={steps} />))}
    </span>
  );
}

/** `comp` null: wave 1's fixed placement (the 11.9 s cuts), placed by the CSS alone. */
type DataCalloutProps = { callout: FilmCallout; comp: FilmComposition | null; origin: number; frozen: boolean };

function DataCalloutBlock({ callout, comp, origin, frozen }: DataCalloutProps) {
  const [mountOrigin] = useState(origin);
  const calloutRef = useRef<HTMLDivElement>(null);
  const chipExitRef = useRef<HTMLDivElement>(null);
  const timing = calloutTiming(callout);
  const counts = COUNTS.get(callout.id);
  const valueTokens = counts?.value ?? [{ kind: "text" as const, text: callout.value }];
  const detailTokens = counts?.detail ?? [{ kind: "text" as const, text: callout.detail }];
  const detailIsBadge = !detailTokens.some((token) => token.kind === "number");
  const steps = Math.max(1, Math.round(timing.count * COUNT_FPS));
  const at = callout.start - mountOrigin;
  const placement = comp ? callout.placement[comp] : SEED_PLACEMENT[callout.id];
  const zone = comp ? CALLOUT_ZONES[comp][placement] : null;
  // The chip's exit slide (attached at mount) starting cues the callout's group fade.
  useExitCue(chipExitRef, calloutRef, !frozen);

  return (
    <div
      ref={calloutRef}
      className={styles.callout}
      data-callout={callout.id}
      data-placement={placement}
      data-film-origin={mountOrigin}
      data-film-rest={callout.start + timing.rest}
      data-exiting={frozen ? "" : undefined}
      style={vars({
        ...(zone ? { "--zx0": zone.x0, "--zy0": zone.y0, "--zx1": zone.x1, "--zy1": zone.y1 } : {}),
        "--at": sec(at),
        "--chip-in": sec(timing.chipIn),
        "--line-at": sec(at + timing.lineAt),
        "--line": sec(timing.line),
        "--dot-at": sec(at + timing.dotAt),
        "--dot": sec(timing.dot),
        "--count-at": sec(at + timing.countAt),
        "--count": sec(timing.count),
        "--detail-at": sec(at + timing.detailAt),
        "--detail": sec(timing.detail),
        "--exit": sec(timing.exit),
        "--exit-at": sec(at + timing.exitAt),
        // The pip blinks only while the chip is on screen (an endless loop would outlive it).
        "--blinks": Math.max(1, Math.ceil(timing.duration)),
      })}
    >
      <span className={styles.leader}>
        <i className={styles.leaderLine} />
        <i className={styles.leaderDot} />
      </span>
      <div ref={chipExitRef} className={styles.chipExit}>
        <div className={styles.chip}>
          <span className={styles.label}><i className={styles.pip} />{callout.label}</span>
          <CountText tokens={valueTokens} steps={steps} className={styles.value} />
          {detailIsBadge
            ? <span className={`${styles.detail} ${styles.badge}`}>{callout.detail}</span>
            : <CountText tokens={detailTokens} steps={steps} className={styles.detail} />}
        </div>
      </div>
    </div>
  );
}

const DataCallout = memo(DataCalloutBlock, (a, b) => a.callout === b.callout && a.comp === b.comp && a.frozen === b.frozen);

// ---------------------------------------------------------------------------------------------

type BrandEndCardProps = {
  stage: number;
  freeze: FilmFreeze | null;
  /** Shared logo styling from the overlay shell, so the end card matches the static brand exactly. */
  logoClassName?: string;
};

/**
 * Stage 6. On a film with the 2.0 s tail (BRIEF-2 3.3) the film itself clears to the page colour and
 * `LogoReveal variant="film-end"` forms over it and holds to the last frame (no backdrop of its own,
 * so the light falling off behind the mark stays the film's). On the 11.9 s cuts encoded before wave
 * 2, which end too soon for that reveal, the short card: the frame clears to the theme background,
 * the FITX mark forms, the tagline settles.
 */
export function BrandEndCard(props: BrandEndCardProps) {
  // Mounted on the client only, once the film reaches its brand stage: decided once per card.
  const [kind] = useState<EndCardKind>(() => (typeof document === "undefined" ? "short" : endCardFor(playingDuration())));
  return kind === "film-end" ? <FilmEndCard {...props} /> : <ShortEndCard {...props} />;
}

function FilmEndCard({ stage, freeze }: BrandEndCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [origin] = useState(() => stageStart(Math.max(stage, STAGE.brand)));
  useFrozenClock(rootRef, freeze, stage);
  useFilmAnchors(rootRef, freeze === null, stage);
  return (
    <div ref={rootRef} className={styles.brandCard} data-film-origin={origin} data-film-brand="film-end">
      <LogoReveal variant="film-end" className={styles.filmEndReveal} />
    </div>
  );
}

function ShortEndCard({ stage, freeze, logoClassName }: BrandEndCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const [origin] = useState(() => stageStart(Math.max(stage, STAGE.brand)));
  const at = BRAND.at - origin;
  const key = kernKey("tagline", TAGLINE.join(""));
  const kerns = KERNS.get(key);
  useFrozenClock(rootRef, freeze, stage);
  useGlyphKerning(taglineRef, key, kerns === undefined);
  useFilmAnchors(rootRef, freeze === null, stage);
  const middle = (TAGLINE.length - 1) / 2;

  return (
    <div
      ref={rootRef}
      className={styles.brandCard}
      data-film-origin={origin}
      data-film-brand="short"
      style={vars({
        "--at": sec(at),
        "--backdrop": sec(BRAND.backdrop),
        "--line-at": sec(at + BRAND.lineAt),
        "--line": sec(BRAND.line),
        "--tagline-at": sec(at + BRAND.taglineAt),
        "--tagline": sec(BRAND.tagline),
      })}
    >
      <div className={styles.brandBackdrop} />
      <div className={styles.brandLockup}>
        <Logo size={68} className={logoClassName} animateMark />
        <i className={styles.finishLine} aria-hidden="true" />
        {/* Tracks in from wide spacing: each letter slides in from where the wide tracking put it. */}
        <p ref={taglineRef} className={styles.tagline} aria-hidden="true" data-glyph-row>
          {TAGLINE.map((letter, i) => {
            const Letter = letter === "." ? "b" : "span";
            return <Letter key={i} className={styles.tagLetter} data-glyph style={vars({ "--o": i - middle, ...kernStyle(kerns, i) })}>{letter}</Letter>;
          })}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Dev review mode backdrop (stands in for the WebGL canvas). Never rendered in production. */
export function DebugBackdrop({ image, theme }: { image: string | null; theme: "light" | "dark" }) {
  return (
    <div
      className={styles.debugBackdrop}
      data-theme={theme}
      aria-hidden="true"
      style={image ? { backgroundImage: `url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    />
  );
}
