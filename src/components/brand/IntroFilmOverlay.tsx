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
 */

type CssVars = Record<`--${string}`, string | number>;
const vars = (values: CssVars) => values as CSSProperties;
const sec = (seconds: number) => `${Math.round(seconds * 1000) / 1000}s`;

const TITLE_INDEX = new Map(TITLES.map((title, index) => [title.text, index]));
const COUNTS = new Map(CALLOUTS.map((callout) => [callout.id, { value: tokenizeCount(callout.value), detail: tokenizeCount(callout.detail) }]));
const LETTERBOX = letterboxTiming();

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

/** The cold open's time-of-day card, set in the bottom matte like a film super. */
function ColdOpenSlate({ theme, origin }: { theme: "light" | "dark"; origin: number }) {
  const [mountOrigin] = useState(origin);
  const end = stageStart(STAGE.run);
  return (
    <div
      className={styles.slate}
      data-film-origin={mountOrigin}
      data-film-rest={end * 0.62}
      style={vars({ "--at": sec(end * 0.3 - mountOrigin), "--hold": sec(end * 0.56), "--out": sec(0.18) })}
    >
      <span>{theme === "dark" ? "21:40" : "06:12"}</span>
      <i />
      <span>{theme === "dark" ? "NIGHT SESSION" : "MORNING SESSION"}</span>
    </div>
  );
}

/**
 * Letters are separate boxes (each animates on its own), which drops the font's pair kerning; at
 * 160px "AT" would open by ~10px. Measure each pair once with canvas (kerning on) and restore it.
 */
function useGlyphKerning(wordRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const word = wordRef.current;
    if (!word) return;
    let live = true;
    const apply = () => {
      const glyphs = Array.from(word.querySelectorAll<HTMLElement>("[data-glyph]"));
      const context = document.createElement("canvas").getContext("2d");
      if (!live || glyphs.length < 2 || !context) return;
      const style = getComputedStyle(glyphs[0]);
      context.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      const width = (text: string) => context.measureText(text).width;
      glyphs.forEach((glyph, i) => {
        if (i === 0) return;
        const a = glyphs[i - 1].textContent ?? "";
        const b = glyph.textContent ?? "";
        const kern = width(a + b) - width(a) - width(b);
        glyph.style.setProperty("--kern", `${Math.round(kern * 10) / 1000}em`);
      });
    };
    apply();
    if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(apply).catch(() => undefined);
    return () => { live = false; };
  }, [wordRef]);
}

function KineticTitle({ title, index, origin }: { title: FilmTitle; index: number; origin: number }) {
  const [mountOrigin] = useState(origin);
  const wordRef = useRef<HTMLSpanElement>(null);
  const timing = titleTiming(title);
  useGlyphKerning(wordRef);
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
      <span className={styles.titleScrim} />
      <div className={styles.title}>
        <div className={styles.titleExit}>
          <span className={styles.titleKicker}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <i />
          </span>
          <span ref={wordRef} className={styles.titleWord}>
            {letters.map((letter, i) => (
              <span key={i} className={styles.glyph} data-glyph style={vars({ "--i": i })}>{letter}</span>
            ))}
            <span className={styles.titleDot} style={vars({ "--i": letters.length })} />
          </span>
        </div>
      </div>
    </div>
  );
}

function CountText({ tokens, offset, className }: { tokens: CountToken[]; offset: number; className?: string }) {
  return (
    <span className={className}>
      {tokens.map((token, i) => {
        if (token.kind === "text") return <span key={i} className={styles.unit}>{token.text}</span>;
        const slot = offset + tokens.slice(0, i).filter((previous) => previous.kind === "number").length;
        return (
          <span key={i} className={styles.num}>
            {/* The ghost holds the widest frame's width; the live text is written by the count-up loop, never by React. */}
            <span className={styles.numGhost}>{token.widest}</span>
            <span className={styles.numLive} data-count={slot} />
          </span>
        );
      })}
    </span>
  );
}

/**
 * Drives the numbers of one callout from the progress of its CSS "clock" animation, read through
 * the Web Animations API: the CSS delay, pause-while-hidden and dev freezes apply to the numbers
 * for free, and no React state changes per frame.
 */
function useCountUp(rootRef: RefObject<HTMLElement | null>, numbers: CountNumber[]) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const clock = root.querySelector<HTMLElement>("[data-count-clock]");
    const slots = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
    let frame = 0;
    const render = () => {
      const animation = clock?.getAnimations()[0];
      const progress = animation?.effect?.getComputedTiming().progress;
      const finished = !animation || animation.playState === "finished";
      const eased = finished ? 1 : easeOutQuart(progress ?? 0);
      slots.forEach((slot) => {
        const token = numbers[Number(slot.dataset.count)];
        if (!token) return;
        const text = formatCount(token, eased);
        if (slot.textContent !== text) slot.textContent = text;
      });
      if (!finished) frame = window.requestAnimationFrame(render);
    };
    render();
    return () => window.cancelAnimationFrame(frame);
  }, [numbers, rootRef]);
}

function DataCallout({ callout, origin }: { callout: FilmCallout; origin: number }) {
  const [mountOrigin] = useState(origin);
  const rootRef = useRef<HTMLDivElement>(null);
  const timing = calloutTiming(callout);
  const counts = COUNTS.get(callout.id);
  const valueTokens = counts?.value ?? [{ kind: "text" as const, text: callout.value }];
  const detailTokens = counts?.detail ?? [{ kind: "text" as const, text: callout.detail }];
  const [numbers] = useState(() => [...valueTokens, ...detailTokens].filter((token): token is CountNumber => token.kind === "number"));
  const valueNumbers = valueTokens.filter((token) => token.kind === "number").length;
  const detailIsBadge = !detailTokens.some((token) => token.kind === "number");
  const at = callout.start - mountOrigin;
  useCountUp(rootRef, numbers);

  return (
    <div
      ref={rootRef}
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
      })}
    >
      <span className={styles.leader}>
        <i className={styles.leaderLine} />
        <i className={styles.leaderDot} />
      </span>
      <div className={styles.chip}>
        <i className={styles.countClock} data-count-clock />
        <span className={styles.label}><i className={styles.pip} />{callout.label}</span>
        <CountText tokens={valueTokens} offset={0} className={styles.value} />
        {detailIsBadge
          ? <span className={`${styles.detail} ${styles.badge}`}>{callout.detail}</span>
          : <CountText tokens={detailTokens} offset={valueNumbers} className={styles.detail} />}
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
  const [origin] = useState(() => stageStart(Math.max(stage, STAGE.brand)));
  const at = BRAND.at - origin;
  useFrozenClock(rootRef, freeze, stage);

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
        <p className={styles.tagline} aria-hidden="true">
          TRAIN SMART<b>.</b> LIVE FIT<b>.</b>
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
