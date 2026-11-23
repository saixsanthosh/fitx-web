"use client";

import type { ReactNode } from "react";
import { AnimatePresence, m } from "framer-motion";
import Image from "next/image";
import { CountUp, SPRING, useReducedMotionSafe } from "@/components/motion";
import type { SiteImage } from "@/data/onboarding-media";
import styles from "./Onboarding.module.css";

/**
 * What the dark stage beside each setup page shows: a photograph that drifts slowly (and changes with the goal
 * chosen), the figure that grows with the height, and readouts of the answers so far. The pictures are
 * decorative; the readouts carry the same values as text. Reduced motion: no movement, the final state only.
 */

/** The stage's photograph, crossfading when it changes and drifting slowly while it shows. */
export function StagePhoto({ photo, dim = false }: { photo: SiteImage; dim?: boolean }) {
  const reduced = useReducedMotionSafe();
  return (
    <div className={styles.photoLayer} aria-hidden="true">
      <AnimatePresence initial={false}>
        <m.div
          key={photo.src}
          className={`${styles.photo} ${dim ? styles.photoDim : ""}`}
          initial={reduced ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <Image src={photo.src} alt="" fill sizes="(min-width: 1024px) 42vw, 100vw" placeholder="blur" blurDataURL={photo.blurDataURL} priority />
        </m.div>
      </AnimatePresence>
      <div className={styles.photoWash} />
    </div>
  );
}

export function Readout({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[.6875rem] font-semibold uppercase tracking-[.14em] text-fitx-on-stage-secondary">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold leading-tight tracking-[-.02em] text-fitx-on-stage sm:text-lg lg:text-xl">{value}</dd>
      {hint && <dd className="mt-0.5 text-[.6875rem] text-fitx-on-stage-secondary">{hint}</dd>}
    </div>
  );
}

/** An answer not given yet: an en dash on screen, "Not given" for screen readers. */
export function NotGiven() {
  return <><span aria-hidden="true">–</span><span className="sr-only">Not given</span></>;
}

const dash = <NotGiven />;

/** Page 1: a standing figure on a scale beside a height rule. */
export function PersonalArt({ heightCm }: { heightCm: number | null }) {
  const reduced = useReducedMotionSafe();
  const known = heightCm !== null && Number.isFinite(heightCm) && heightCm >= 90 && heightCm <= 250;
  // 150 cm draws at 0.86 of full height, 200 cm at 1; outside that the figure stops growing.
  const scale = known ? Math.min(1.02, Math.max(0.8, 0.86 + ((heightCm - 150) / 50) * 0.14)) : 0.92;
  const floor = 268;
  const top = floor - 228 * scale;
  const transition = reduced ? { duration: 0 } : SPRING;
  return (
    <svg viewBox="0 0 320 300" className="h-full w-full" aria-hidden="true" focusable="false">
      {/* Height rule */}
      <g className="text-fitx-on-stage-secondary" stroke="currentColor">
        <line x1="54" y1="30" x2="54" y2={floor} strokeWidth="1.5" strokeOpacity=".45" />
        {Array.from({ length: 20 }, (_, index) => {
          const y = floor - index * 12;
          return <line key={index} x1="54" x2={index % 4 === 0 ? 70 : 62} y1={y} y2={y} strokeWidth="1.5" strokeOpacity={index % 4 === 0 ? 0.7 : 0.35} />;
        })}
      </g>
      {/* The marker at the top of the head */}
      <m.g initial={false} animate={{ y: top - 40 }} transition={transition}>
        <line x1="54" x2="252" y1="40" y2="40" className="text-fitx-primary" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" />
        <circle cx="54" cy="40" r="5" className="text-fitx-primary" fill="currentColor" />
      </m.g>
      {/* Figure, scaled from the feet */}
      <m.g initial={false} animate={{ scaleY: scale, scaleX: 0.94 + scale * 0.06 }} transition={transition} style={{ originX: 0.5, originY: 1 }} className="text-fitx-on-stage">
        <g fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
          <circle cx="170" cy="62" r="20" />
          <path d="M146 96C146 90 152 86 158 86H182C188 86 194 90 194 96L200 168C200 172 197 175 193 175H147C143 175 140 172 140 168Z" />
          <path d="M146 98L124 156C122 161 125 165 130 165C133 165 135 163 136 160L152 118" />
          <path d="M194 98L216 156C218 161 215 165 210 165C207 165 205 163 204 160L188 118" />
          <path d="M150 175L148 258C148 263 151 266 156 266H162C166 266 168 263 168 259L170 196L172 259C172 263 174 266 178 266H184C189 266 192 263 192 258L190 175Z" />
        </g>
      </m.g>
      {/* Scale platform */}
      <g className="text-fitx-on-stage-secondary">
        <rect x="120" y={floor + 2} width="100" height="12" rx="6" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
        <rect x="158" y={floor + 5} width="24" height="6" rx="3" className="text-fitx-primary" fill="currentColor" />
      </g>
    </svg>
  );
}

export function PersonalReadouts({ age, height, weight, goal, kcal }: { age: number | null; height: string | null; weight: string | null; goal: ReactNode; kcal: number | null }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
      <Readout label="Age" value={age === null ? dash : `${age} yrs`} />
      <Readout label="Height" value={height ?? dash} />
      <Readout label="Weight" value={weight ?? dash} />
      <Readout label="Goal" value={goal} />
      <div className="col-span-2 rounded-2xl border border-fitx-on-stage-secondary/25 p-3.5" aria-live="polite">
        <dt className="flex items-center justify-between text-[.6875rem] font-semibold uppercase tracking-[.14em] text-fitx-on-stage-secondary">
          Daily target<span className="rounded-full border border-fitx-on-stage-secondary/40 px-2 py-0.5 normal-case tracking-normal">Estimate</span>
        </dt>
        <dd className="mt-1.5 text-2xl font-semibold tracking-[-.03em] text-fitx-on-stage">
          {kcal === null ? <span className="text-base font-medium text-fitx-on-stage-secondary">Add your details to see it</span> : <>≈ <CountUp value={kcal} format={(n) => Math.round(n).toLocaleString("en-IN")} /> <span className="text-sm font-medium text-fitx-on-stage-secondary">kcal a day</span></>}
        </dd>
      </div>
    </dl>
  );
}
