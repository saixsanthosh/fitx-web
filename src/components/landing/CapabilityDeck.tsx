"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, Check, Minus, Pause, Play, Plus } from "lucide-react";
import { m, useInView, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { LANDING_MEDIA } from "@/data/landing-media";
import { CAPABILITIES, DECK_SECONDS, nextCard, previousCard, type Capability } from "./capabilities";
import { portionNutrition, type PieceFood } from "./portion";
import { EXAMPLE_PLAN, POSE_FRAME, bonesPath, cueAt, frameAt, jointsPath, kneeAngle, planDoneAt, poseAt, ramp, squatDepth } from "./story";
import styles from "./landing.module.css";

const SIZES = "(max-width: 767px) 100vw, (max-width: 1280px) 60vw, 760px";

/** Discrete values that follow a motion value, re-rendering only when they change. */
function useStep<T extends string | number>(value: MotionValue<number>, read: (p: number) => T): T {
  const subscribe = useCallback((onChange: () => void) => value.on("change", onChange), [value]);
  return useSyncExternalStore(
    subscribe,
    () => read(value.get()),
    () => read(value.get()),
  );
}

/**
 * What FITX does, as a deck of seven cards: a photo animated in code (a slow push and a passing light) with a small
 * live example drawn over it. It moves on by itself every few seconds while on screen, until someone picks a card
 * (tabs, arrow keys or a swipe) or moves keyboard focus into it; then it stays where they put it. It waits while a
 * mouse is over the picture. Pause stops everything (each example shows its final frame); only Play starts the
 * deck moving on again. Reduced motion: no auto-advance, no movement, each example shows its final frame.
 */
export function CapabilityDeck({ food }: { food: PieceFood | null }) {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const root = useRef<HTMLElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const inView = useInView(root, { amount: 0.35 });
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Said to screen readers only when the visitor changed the card (a swipe or a tab), never on an auto-advance.
  const [announced, setAnnounced] = useState("");
  const progress = useMotionValue(reduced ? 1 : 0);
  const auto = !reduced && !held && !paused && !hovered && visible && inView;
  const animate = !reduced && !paused && visible && inView;
  // The clock reads this at the end of a card, so a hover starting or ending does not restart the card's example.
  const advance = useRef(auto);
  useEffect(() => {
    advance.current = auto;
  }, [auto]);

  // One clock per card: 0 to 1 over DECK_SECONDS; the overlays read it, the deck advances at the end.
  useEffect(() => {
    if (reduced || paused) {
      progress.set(1);
      return;
    }
    progress.set(0);
    if (!animate) return;
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      elapsed += dt;
      progress.set(Math.min(1, elapsed / DECK_SECONDS));
      if (elapsed >= DECK_SECONDS && advance.current) {
        setActive((index) => nextCard(index));
        return;
      }
      // A held card keeps looping its example.
      if (elapsed >= DECK_SECONDS) elapsed = 0;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, animate, paused, reduced, progress]);

  const choose = (index: number, focus = false) => {
    setHeld(true);
    setActive(index);
    // Arrow keys move focus to the tab, which says its own name; a click or a swipe is announced here.
    if (focus) tabs.current[index]?.focus();
    else setAnnounced(CAPABILITIES[index].tab);
  };

  // Keyboard focus anywhere in the deck (a tab, a card's link) holds it, so a focused link is never hidden under it.
  const toggle = useRef<HTMLButtonElement>(null);
  const onFocusIn = (event: FocusEvent<HTMLElement>) => {
    if (event.target !== toggle.current) setHeld(true);
  };
  const onToggle = () => {
    if (paused) setHeld(false);
    setPaused(!paused);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: nextCard(active),
      ArrowDown: nextCard(active),
      ArrowLeft: previousCard(active),
      ArrowUp: previousCard(active),
      Home: 0,
      End: CAPABILITIES.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    choose(keys[event.key], true);
  };

  // Swipe on the picture (phones): left for the next card, right for the previous one.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.4) choose(dx < 0 ? nextCard(active) : previousCard(active));
  };

  return (
    <section ref={root} id="capabilities" className={styles.deck} aria-labelledby="deck-title" data-auto={auto} data-paused={paused} onFocus={onFocusIn}>
      <div className={styles.deckBody}>
        <div className={styles.deckSide}>
          <div className={styles.deckHead}>
            <div className={styles.deckEyebrowRow}>
              <p className={styles.eyebrow}>What FITX does</p>
              {!reduced && (
                <button ref={toggle} type="button" className={styles.deckToggle} onClick={onToggle} aria-label={paused ? "Play cards" : "Pause cards"}>
                  {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
                </button>
              )}
            </div>
            <h2 id="deck-title" className={styles.sectionTitle}>
              Seven tools. One routine.
            </h2>
          </div>
          <div className={styles.deckTabs} role="tablist" aria-label="FITX features" onKeyDown={onKey}>
            {CAPABILITIES.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`deck-tab-${item.id}`}
                aria-selected={index === active}
                aria-controls={`deck-panel-${item.id}`}
                tabIndex={index === active ? 0 : -1}
                className={styles.deckTab}
                onClick={() => choose(index)}
              >
                <span className={styles.deckIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.deckTabLabel}>{item.tab}</span>
                <span className={styles.deckTimer} aria-hidden="true">
                  {index === active && <m.i style={{ scaleX: held || paused || reduced ? 1 : progress }} />}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          className={styles.deckStage}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setHovered(true);
          }}
          onPointerLeave={() => setHovered(false)}
        >
          {CAPABILITIES.map((item, index) => (
            <article
              key={item.id}
              id={`deck-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`deck-tab-${item.id}`}
              hidden={index !== active}
              className={styles.deckCard}
              data-card={item.id}
              data-active={index === active}
              data-moving={animate && index === active}
            >
              <div className={styles.deckPhoto}>
                <Image
                  src={item.image.src}
                  alt={item.image.alt}
                  fill
                  sizes={SIZES}
                  placeholder="blur"
                  blurDataURL={item.image.blurDataURL}
                  style={{ objectPosition: item.focus }}
                />
              </div>
              <div className={styles.deckLight} aria-hidden="true" />
              <div className={styles.deckShade} aria-hidden="true" />
              {index === active && <Overlay item={item} progress={progress} food={food} />}
              <div className={styles.deckCopy}>
                <h3>{item.title}</h3>
                <p>{item.line}</p>
                <Link href={item.href} prefetch={false} className={styles.deckLink}>
                  {item.cta} <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
          <p className={styles.srOnly} aria-live="polite">
            {announced}
          </p>
        </div>
      </div>
    </section>
  );
}

function Overlay({ item, progress, food }: { item: Capability; progress: MotionValue<number>; food: PieceFood | null }) {
  switch (item.id) {
    case "train":
      return <PlanCard progress={progress} />;
    case "form":
      return <FormScan progress={progress} />;
    case "fuel":
      return food ? <PortionCard food={food} /> : null;
    case "move":
      return <Route progress={progress} />;
    case "coach":
      return <Chat progress={progress} />;
    case "progress":
      return <Rings progress={progress} />;
    case "explore":
      // No example overlay: a made-up post or member would be invented engagement.
      return null;
  }
}

const readPlanDone = (p: number) => planDoneAt(Math.min(1, p * 1.25));

function PlanCard({ progress }: { progress: MotionValue<number> }) {
  const done = useStep(progress, readPlanDone);
  return (
    <div className={styles.overlayCard} role="group" aria-label="Example plan in FITX">
      <div className={styles.overlayTop}>
        <strong>Push · Today</strong>
        <span className={styles.tag}>Example</span>
      </div>
      <div className={styles.planBar} aria-hidden="true">
        <span style={{ transform: `scaleX(${done / EXAMPLE_PLAN.length})` }} />
      </div>
      <ol className={styles.planList}>
        {EXAMPLE_PLAN.map((row, index) => (
          <li key={row.name} data-done={index < done} data-current={index === done}>
            <span className={styles.planCheck} aria-hidden="true">
              <Check size={10} strokeWidth={3} />
            </span>
            <span>{row.name}</span>
            <small>{row.detail}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

const readCue = (p: number) => cueAt(p);

/** The squat photos (standing, half way, the bottom) under the skeleton the camera would draw, one and a half reps. */
function FormScan({ progress }: { progress: MotionValue<number> }) {
  const frame = useTransform<number, number>(progress, (p) => frameAt(squatDepth(p)));
  const mid = useTransform<number, number>(frame, (f) => (f === 1 ? 1 : 0));
  const bottom = useTransform<number, number>(frame, (f) => (f === 2 ? 1 : 0));
  const pose = useTransform(progress, (p) => poseAt(squatDepth(p)));
  const bones = useTransform(pose, (value) => bonesPath(value));
  const joints = useTransform(pose, (value) => jointsPath(value));
  const angle = useTransform(pose, (value) => `Knee ${kneeAngle(value)}°`);
  const angleX = useTransform(pose, (value) => value.knee[0] + 64);
  const angleY = useTransform(pose, (value) => value.knee[1] + 96);
  const draw = useTransform<number, number>(progress, (p) => ramp(p, 0, 0.08, 0.001, 1));
  const cue = useStep(progress, readCue);
  return (
    <div className={styles.formScan} aria-hidden="true">
      <m.div className={styles.formFrame} style={{ opacity: mid }}>
        <Image src={LANDING_MEDIA["woman-mid"].src} alt="" fill sizes={SIZES} />
      </m.div>
      <m.div className={styles.formFrame} style={{ opacity: bottom }}>
        <Image src={LANDING_MEDIA["woman-squat"].src} alt="" fill sizes={SIZES} />
      </m.div>
      <svg className={styles.poseLayer} viewBox={`0 0 ${POSE_FRAME.width} ${POSE_FRAME.height}`} preserveAspectRatio="xMidYMid slice">
        <m.path className={styles.boneHalo} d={bones} style={{ pathLength: draw }} />
        <m.path className={styles.bone} d={bones} style={{ pathLength: draw }} />
        <m.path className={styles.joints} d={joints} style={{ opacity: draw }} />
        <m.text className={styles.angleText} x={angleX} y={angleY} style={{ opacity: draw }}>
          {angle}
        </m.text>
      </svg>
      <span className={styles.liveTag}>
        <i className={styles.liveDot} />
        Form check
      </span>
      <span className={styles.cue} data-scene-cue="">
        {cue}
      </span>
    </div>
  );
}

function PortionCard({ food }: { food: PieceFood }) {
  const [pieces, setPieces] = useState(2);
  const totals = portionNutrition(food, pieces);
  return (
    <div className={styles.overlayCard} role="group" aria-label={`Portion example: ${food.name}`}>
      <div className={styles.foodRow}>
        <strong>{food.name}</strong>
        <div className={styles.stepper}>
          <button type="button" onClick={() => setPieces((n) => Math.max(1, n - 1))} disabled={pieces <= 1} aria-label={`One ${food.pieceLabel} fewer`}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <output aria-live="polite" aria-label={`${pieces} ${food.pieceLabel}`}>
            {pieces}
          </output>
          <button type="button" onClick={() => setPieces((n) => Math.min(9, n + 1))} disabled={pieces >= 9} aria-label={`One ${food.pieceLabel} more`}>
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <dl className={styles.macros}>
        <div>
          <dt>Energy</dt>
          <dd>
            {totals.kcal}
            <small> kcal</small>
          </dd>
        </div>
        <div>
          <dt>Protein</dt>
          <dd>
            {totals.protein}
            <small> g</small>
          </dd>
        </div>
        <div>
          <dt>Carbs</dt>
          <dd>
            {totals.carbs}
            <small> g</small>
          </dd>
        </div>
        <div>
          <dt>Fat</dt>
          <dd>
            {totals.fat}
            <small> g</small>
          </dd>
        </div>
      </dl>
      <span className={styles.source}>
        ≈ {totals.grams} g · 1 {food.pieceLabel} ≈ {food.pieceGrams} g · {food.source}
      </span>
    </div>
  );
}

const ROUTE = "M40 520C120 470 150 400 230 392S330 450 390 400 420 290 500 276 600 310 640 240 700 160 780 150";

function Route({ progress }: { progress: MotionValue<number> }) {
  const draw = useTransform<number, number>(progress, (p) => ramp(p, 0.05, 0.75, 0.001, 1));
  return (
    <svg className={styles.route} viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path className={styles.routeTrack} d={ROUTE} />
      <m.path className={styles.routeLine} d={ROUTE} style={{ pathLength: draw }} />
      <circle className={styles.routeDot} cx="40" cy="520" r="9" />
    </svg>
  );
}

const CHAT = [
  { from: "you", text: "Legs are sore from yesterday. Train today?" },
  { from: "coach", text: "Yes, but go easy on legs: upper body, or a 30-minute walk. Squats again on Thursday." },
] as const;
const readChat = (p: number) => (p < 0.12 ? 0 : p < 0.4 ? 1 : p < 0.5 ? 1.5 : 2);

function Chat({ progress }: { progress: MotionValue<number> }) {
  const shown = useStep(progress, readChat);
  return (
    <div className={styles.chat} role="group" aria-label="Example question to the AI Coach">
      <span className={styles.tag}>Example</span>
      {CHAT.map((line, index) => (
        <p key={line.from} className={styles.bubble} data-from={line.from} data-shown={shown > index} aria-hidden={shown <= index}>
          {line.text}
        </p>
      ))}
      <span className={styles.typing} data-shown={shown === 1.5} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

const RINGS = [
  { id: "training", label: "Training", r: 46, to: 0.82 },
  { id: "food", label: "Food", r: 34, to: 0.64 },
  { id: "movement", label: "Movement", r: 22, to: 0.9 },
] as const;

function Rings({ progress }: { progress: MotionValue<number> }) {
  return (
    <div className={styles.overlayCard} role="group" aria-label="Example week in FITX">
      <div className={styles.overlayTop}>
        <strong>This week</strong>
        <span className={styles.tag}>Example</span>
      </div>
      <div className={styles.rings}>
        <svg viewBox="0 0 110 110" aria-hidden="true">
          {RINGS.map((ring) => (
            <Ring key={ring.id} r={ring.r} to={ring.to} progress={progress} />
          ))}
        </svg>
        <ul>
          {RINGS.map((ring) => (
            <li key={ring.id} data-ring={ring.id}>
              {ring.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Ring({ r, to, progress }: { r: number; to: number; progress: MotionValue<number> }) {
  const length = useTransform<number, number>(progress, (p) => Math.max(0.001, ramp(p, 0.05, 0.6, 0, to)));
  return (
    <>
      <circle className={styles.ringTrack} cx="55" cy="55" r={r} />
      <m.circle className={styles.ringValue} cx="55" cy="55" r={r} style={{ pathLength: length }} transform="rotate(-90 55 55)" />
    </>
  );
}
