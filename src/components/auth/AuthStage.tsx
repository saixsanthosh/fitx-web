"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useInView } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { EASE, useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { Logo } from "@/components/ui/Logo";
import { ANKLE, BONES, cueFor, hipPath, jointPoints, kneeAngle, squatDepth, squatPose, type Cue, type SquatPose } from "./squat-pose";
import s from "./auth.module.css";

/** One rep, down and up. */
const REP_SECONDS = 3.6;
/** The still frame: lowering, near depth. Shown before hydration, with reduced motion and while paused at load. */
const STILL_PHASE = 0.32;
const WORDS = ["Lift", "Run", "Fuel", "Recover"] as const;
const WORD_SECONDS = 2.6;
const TRAIL = hipPath();

function transforms(pose: SquatPose) {
  return {
    shin: `rotate(${pose.shin.toFixed(2)})`,
    knee: `translate(0 ${-BONES.shin}) rotate(${pose.knee.toFixed(2)})`,
    hip: `translate(0 ${-BONES.thigh}) rotate(${pose.hip.toFixed(2)})`,
    shoulder: `translate(0 ${-(BONES.torso - 4)}) rotate(${pose.shoulder.toFixed(2)})`,
    elbow: `translate(0 ${BONES.upperArm}) rotate(${pose.elbow.toFixed(2)})`,
  };
}

function labelTransform(pose: SquatPose) {
  const { knee } = jointPoints(pose);
  return `translate(${(knee.x + 14).toFixed(1)} ${(knee.y - 10).toFixed(1)})`;
}

/** One side of the body. `far` is the leg and arm behind, drawn fainter and offset for depth. */
function Limbs({ pose, far = false }: { pose: SquatPose; far?: boolean }) {
  const t = transforms(pose);
  const bone = far ? `${s.bone} ${s.boneFar}` : s.bone;
  return (
    <g transform={`translate(${ANKLE.x + (far ? -9 : 0)} ${ANKLE.y})`}>
      <line className={bone} x1={-6} y1={0} x2={24} y2={0} />
      <g data-joint="shin" transform={t.shin}>
        <line className={bone} x1={0} y1={0} x2={0} y2={-BONES.shin} />
        <g data-joint="knee" transform={t.knee}>
          <line className={bone} x1={0} y1={0} x2={0} y2={-BONES.thigh} />
          <g data-joint="hip" transform={t.hip}>
            {!far && <line className={bone} x1={0} y1={0} x2={0} y2={-BONES.torso} />}
            {!far && <circle className={s.head} cx={0} cy={-(BONES.torso + 4 + BONES.head)} r={BONES.head} />}
            <g data-joint="shoulder" transform={t.shoulder}>
              <line className={bone} x1={0} y1={0} x2={0} y2={BONES.upperArm} />
              <g data-joint="elbow" transform={t.elbow}>
                <line className={bone} x1={0} y1={0} x2={0} y2={BONES.forearm} />
                {!far && <circle className={s.joint} cx={0} cy={BONES.forearm} r={3.5} />}
              </g>
              {!far && <circle className={s.joint} cx={0} cy={BONES.upperArm} r={4} />}
            </g>
            {!far && <circle className={s.joint} cx={0} cy={-(BONES.torso - 4)} r={4.5} />}
            {!far && <circle className={s.joint} r={5} />}
          </g>
          {!far && <circle className={s.joint} r={5} />}
        </g>
        {!far && <circle className={s.joint} r={4.5} />}
      </g>
    </g>
  );
}

/**
 * The sign-in pages' moving picture: a figure squatting under a form-check frame, the knee angle and the
 * coaching cue read from the drawing itself, and the headline's first word changing. It animates SVG
 * transforms only, stops when it is off screen, the tab is hidden or the visitor pauses it, and shows one
 * still frame with reduced motion.
 */
export function AuthStage() {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const root = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const angleText = useRef<SVGTextElement>(null);
  const label = useRef<SVGGElement>(null);
  const inView = useInView(root);
  const [paused, setPaused] = useState(false);
  const [cue, setCue] = useState<Cue>(cueFor(STILL_PHASE));
  const [word, setWord] = useState(0);
  const phase = useRef(STILL_PHASE);
  const running = !reduced && !paused && visible && inView;
  const still = squatPose(squatDepth(STILL_PHASE));

  useEffect(() => {
    if (!running || !svg.current) return;
    const groups = Array.from(svg.current.querySelectorAll<SVGGElement>("[data-joint]"));
    let frame = 0;
    let last = performance.now();
    let lastCue: Cue | null = null;
    let lastAngle = -1;
    const tick = (now: number) => {
      phase.current = (phase.current + (now - last) / 1000 / REP_SECONDS) % 1;
      last = now;
      const pose = squatPose(squatDepth(phase.current));
      const t = transforms(pose);
      for (const group of groups) group.setAttribute("transform", t[group.dataset.joint as keyof typeof t]);
      const angle = kneeAngle(pose);
      if (angle !== lastAngle && angleText.current) {
        angleText.current.textContent = `${angle}°`;
        lastAngle = angle;
      }
      label.current?.setAttribute("transform", labelTransform(pose));
      const next = cueFor(phase.current);
      if (next !== lastCue) {
        lastCue = next;
        setCue(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setWord((index) => (index + 1) % WORDS.length), WORD_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <section ref={root} className={`${s.stage} fitx-inverse`} data-running={running} aria-label="FITX">
      <div className={s.dots} aria-hidden="true" />
      <div className={s.stageTop}>
        <Link href="/" className={s.homeLink} aria-label="FITX home"><Logo size={30} /></Link>
        <span className={s.live} aria-hidden="true"><span className={s.liveDot} />Form check</span>
      </div>

      <div className={s.figure} aria-hidden="true">
        <div className={s.frame}><i /><span className={s.scan} /></div>
        <svg ref={svg} className={s.figureSvg} viewBox="0 0 240 300" preserveAspectRatio="xMidYMax meet" focusable="false">
          <line className={s.ground} x1={40} y1={ANKLE.y + 4} x2={220} y2={ANKLE.y + 4} />
          <path className={s.trail} d={TRAIL} />
          <Limbs pose={still} far />
          <Limbs pose={still} />
          <g ref={label} transform={labelTransform(still)}>
            <rect className={s.readoutBg} x={0} y={-13} width={44} height={20} rx={10} />
            <text ref={angleText} className={s.readout} x={22} y={1} textAnchor="middle">{kneeAngle(still)}°</text>
          </g>
        </svg>
      </div>

      <p className={s.headline}>
        <span className="sr-only">Train smarter.</span>
        <span className={s.wordSlot} aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={WORDS[word]}
              initial={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE.out }}
            >
              {WORDS[word]}
            </m.span>
          </AnimatePresence>
        </span>
        <span className={s.wordRest} aria-hidden="true">smarter.</span>
      </p>

      <p className={s.cue} aria-hidden="true">{cue}</p>

      {!reduced && (
        <button type="button" className={s.pause} onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play animation" : "Pause animation"}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}
