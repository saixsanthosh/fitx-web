"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Logo } from "@/components/ui/Logo";
import { CALLOUTS, STAGE, TITLES } from "./intro/timeline";
import {
  BRAND,
  beginningInStage,
  calloutTiming,
  easeOutQuart,
  formatCount,
  letterboxTiming,
  liveDuringStage,
  stageRestTime,
  stageStart,
  titleTiming,
  tokenizeCount,
  type CountNumber,
  type CountToken,
  type FilmCallout,
  type FilmFreeze,
  type FilmTitle,
} from "./introOverlayTiming";
import styles from "./IntroFilmOverlay.module.css";

/**
 * The film's DOM motion graphics: 2.39:1 letterbox, kinetic titles, data callouts (stages 0–5) and
 * the brand end card (stage 6). React state changes only when the scene reports a stage; every
 * element then runs CSS animations whose delays are film times measured from the *origin* (the
 * `STAGE_START` of the stage in which it mounted). Each element captures its origin once, so a
 * later stage never retimes an animation that is already running.
 *
 * Performance contract (the film plays on low-end phones): every animation here moves only
 * `transform` and `opacity`, at most one animation per property per element, so all of them run
 * on the compositor with no per-frame style, layout or paint, and no script runs per frame (the
 * exceptions: the titles' one-step mask release, and the FITX mark's own formation from
 * globals.css, shared with the static brand). Soft looks (focus pulls, drop shadows) come from
 * copies blurred once at mount and cross-faded; see IntroFilmOverlay.module.css.
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

/**
 * Letters are separate boxes (each animates on its own), which drops the font's pair kerning; at
 * 160px "AT" would open by ~10px. Measure each pair once with canvas (kerning on) and restore it on
 * every copy of the word (`[data-glyph-row]`, matched by letter index). Like the browser's own
 * shaping, pairs across a space or a change of font (a bold dot) are not kerned.
 */
function useGlyphKerning(rootRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let live = true;
    const apply = () => {
      const rows = root.matches("[data-glyph-row]") ? [root] : Array.from(root.querySelectorAll<HTMLElement>("[data-glyph-row]"));
      const reference = rows.length > 0 ? Array.from(rows[0].querySelectorAll<HTMLElement>("[data-glyph]")) : [];
      const context = document.createElement("canvas").getContext("2d");
      if (!live || reference.length < 2 || !context) return;
      const fonts = reference.map((glyph) => {
        const style = getComputedStyle(glyph);
        return `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
      });
      const width = (text: string) => context.measureText(text).width;
      const kerns = reference.map((glyph, i) => {
        const a = i > 0 ? reference[i - 1].textContent ?? "" : "";
        const b = glyph.textContent ?? "";
        if (i === 0 || fonts[i] !== fonts[i - 1] || !a.trim() || !b.trim()) return 0;
        context.font = fonts[i];
        return width(a + b) - width(a) - width(b);
      });
      rows.forEach((row) => {
        row.querySelectorAll<HTMLElement>("[data-glyph]").forEach((glyph, i) => {
          if (kerns[i]) glyph.style.setProperty("--kern", `${Math.round(kerns[i] * 10) / 1000}em`);
        });
      });
    };
    apply();
    if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(apply).catch(() => undefined);
    return () => { live = false; };
  }, [rootRef]);
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
  const origin = stageStart(stage);
  const titles = freeze?.kind === "stage" ? beginningInStage(TITLES, stage) : liveDuringStage(TITLES, stage);
  const callouts = freeze?.kind === "stage" ? beginningInStage(CALLOUTS, stage) : liveDuringStage(CALLOUTS, stage);
  useFrozenClock(rootRef, freeze, stage);

  return (
    <div ref={rootRef} className={styles.film} aria-hidden="true" data-film-graphics>
      {stage >= LETTERBOX.outStage
        ? <LetterboxBars key="out" phase="out" origin={origin} />
        : <LetterboxBars key="in" phase="in" origin={origin} />}
      {stage === STAGE.coldOpen && <ColdOpenSlate theme={theme} origin={origin} />}
      {titles.map((title) => (
        <KineticTitle key={title.text} title={title} index={TITLE_INDEX.get(title.text) ?? 0} origin={origin} />
      ))}
      {callouts.map((callout) => <DataCallout key={callout.id} callout={callout} origin={origin} />)}
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
function GlyphRow({ letters, className, dot }: { letters: string[]; className: string; dot: boolean }) {
  return (
    <span className={`${styles.glyphRow} ${className}`} data-glyph-row>
      {letters.map((letter, i) => (
        <span key={i} className={styles.glyph} data-glyph style={vars({ "--i": i })}>{letter}</span>
      ))}
      {dot && <span className={styles.titleDot} style={vars({ "--i": letters.length })} />}
    </span>
  );
}

function KineticTitle({ title, index, origin }: { title: FilmTitle; index: number; origin: number }) {
  const [mountOrigin] = useState(origin);
  const titleRef = useRef<HTMLDivElement>(null);
  const timing = titleTiming(title);
  useGlyphKerning(titleRef);
  const letters = Array.from(title.text);
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
        <div className={styles.titleExit}>
          <span className={styles.titleKicker}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <i />
          </span>
          <span className={styles.titleWord}>
            <GlyphRow letters={letters} className={styles.rowShade} dot />
            <GlyphRow letters={letters} className={styles.rowTwin} dot={false} />
            <GlyphRow letters={letters} className={styles.rowFill} dot />
          </span>
        </div>
        {/* Outside the exit's fade: the blurred copy takes over as the sharp title leaves. */}
        <GlyphRow letters={letters} className={styles.rowExit} dot />
      </div>
    </div>
  );
}

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

function DataCallout({ callout, origin }: { callout: FilmCallout; origin: number }) {
  const [mountOrigin] = useState(origin);
  const timing = calloutTiming(callout);
  const counts = COUNTS.get(callout.id);
  const valueTokens = counts?.value ?? [{ kind: "text" as const, text: callout.value }];
  const detailTokens = counts?.detail ?? [{ kind: "text" as const, text: callout.detail }];
  const detailIsBadge = !detailTokens.some((token) => token.kind === "number");
  const steps = Math.max(1, Math.round(timing.count * COUNT_FPS));
  const at = callout.start - mountOrigin;

  return (
    <div
      className={styles.callout}
      data-callout={callout.id}
      data-placement={callout.placement}
      data-film-origin={mountOrigin}
      data-film-rest={callout.start + timing.rest}
      style={vars({
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
      <div className={styles.chipExit}>
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

// ---------------------------------------------------------------------------------------------

type BrandEndCardProps = {
  stage: number;
  freeze: FilmFreeze | null;
  /** Shared logo styling from the overlay shell, so the end card matches the static brand exactly. */
  logoClassName?: string;
};

/** Stage 6: the frame clears to the theme background, the FITX mark forms, the tagline settles. */
export function BrandEndCard({ stage, freeze, logoClassName }: BrandEndCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const [origin] = useState(() => stageStart(Math.max(stage, STAGE.brand)));
  const at = BRAND.at - origin;
  useFrozenClock(rootRef, freeze, stage);
  useGlyphKerning(taglineRef);
  const middle = (TAGLINE.length - 1) / 2;

  return (
    <div
      ref={rootRef}
      className={styles.brandCard}
      data-film-origin={origin}
      data-film-brand
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
            return <Letter key={i} className={styles.tagLetter} data-glyph style={vars({ "--o": i - middle })}>{letter}</Letter>;
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
