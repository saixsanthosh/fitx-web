"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { m } from "framer-motion";
import { Plus, ScanBarcode } from "lucide-react";
import { CountUp, EASE, useReducedMotionSafe } from "@/components/motion";
import { FoodNotes, SourceTag, SummaryGate, Unknown } from "@/components/widgets/HomeWidgets";
import type { GoalsData, Resource } from "@/components/widgets/useHomeData";
import { WidgetNote } from "@/components/widgets/WidgetCard";
import type { SummaryResult } from "@/lib/data/today";
import { unknownDayTotal } from "@/lib/domain/meal-totals";
import { todayTargets, type DailyTarget } from "@/lib/domain/today";
import styles from "./Home.module.css";

const kcal = (value: number) => Math.round(value).toLocaleString();

type Ring = { value: number; target: number | null; color: string };

const SIZE = 200;
const STROKE = 15;
const GAP = 7;

/** Today's rings: calories outside, protein inside. They draw in once; with reduced motion they are simply there. */
function HeroRing({ rings, label, children }: { rings: Ring[]; label: string; children: ReactNode }) {
  const reduced = useReducedMotionSafe();
  const center = SIZE / 2;
  return (
    <div role="img" aria-label={label} className={styles.ring}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className={styles.ringSvg}>
        {rings.map((ring, index) => {
          const radius = (SIZE - STROKE) / 2 - index * (STROKE + GAP);
          const done = ring.target && ring.target > 0 ? Math.max(0, Math.min(1, ring.value / ring.target)) : 0;
          return (
            <g key={index}>
              <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--fitx-track)" strokeWidth={STROKE} />
              {done > 0 && (
                <m.circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: done }}
                  transition={{ duration: 1.1, delay: index * 0.12, ease: EASE.out }}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className={styles.ringCenter}>{children}</div>
    </div>
  );
}

function Row({ name, color, target, unit, unknown, over }: { name: string; color: string; target: DailyTarget; unit: string; unknown: boolean; over: boolean }) {
  const format = unit === "kcal" ? kcal : (value: number) => String(Math.round(value));
  return (
    <div className={styles.row}>
      <span className={styles.dot} style={{ background: over ? "var(--fitx-warning)" : color }} aria-hidden="true" />
      <p className={styles.rowName}>{name} <SourceTag target={target} /></p>
      <p className={styles.rowValue}>
        <strong>{unknown ? <Unknown /> : format(target.value)}</strong>
        {target.target ? <> / {format(target.target)} {unit}</> : <> {unit}</>}
      </p>
      {target.target && !unknown ? <span className={styles.rowPercent}>{target.percent}%</span> : <span />}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className={styles.heroBody} aria-busy="true" aria-label="Loading today's numbers">
      <div className={`${styles.ring} ${styles.ringPlaceholder}`} />
      <div className={styles.side}><span className={styles.lineLong} /><span className={styles.lineShort} /><span className={styles.lineShort} /></div>
    </div>
  );
}

/**
 * Home's hero: today's calories and protein as rings against the member's targets, what is left, and the two
 * ways to log food. Unknown totals show a dash, never 0 (contract C11); estimated targets are labelled.
 */
export function HomeHero({ summary, goals, corner }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData>; corner: ReactNode }) {
  return (
    <section className={styles.hero} data-widget="today" aria-labelledby="home-today-title">
      <header className={styles.heroHead}>
        <h2 id="home-today-title" className={styles.heroTitle}>Today</h2>
        {corner}
      </header>
      <SummaryGate summary={summary} label="Loading today's numbers" loading={<HeroSkeleton />}>
        {({ summary: today, food }) => {
          const targets = todayTargets(today, goals.data?.goals);
          const calories = targets.calories;
          const protein = targets.protein;
          const caloriesUnknown = unknownDayTotal(food, "calories");
          const proteinUnknown = unknownDayTotal(food, "protein");
          const over = !caloriesUnknown && calories.target !== null && calories.over > 0;
          const estimated = calories.source === "estimate" || protein.source === "estimate";
          const label = [
            caloriesUnknown ? "Calories not known" : `${kcal(calories.value)} kcal${calories.target ? ` of ${calories.source === "estimate" ? "an estimated " : ""}${kcal(calories.target)} kcal` : " logged"}`,
            proteinUnknown ? "protein not known" : `${Math.round(protein.value)} g protein${protein.target ? ` of ${protein.source === "estimate" ? "an estimated " : ""}${Math.round(protein.target)} g` : ""}`,
          ].join("; ");
          return (
            <div className={styles.heroBody}>
              <HeroRing
                label={label}
                rings={[
                  { value: calories.value, target: caloriesUnknown ? null : calories.target, color: over ? "var(--fitx-warning)" : "var(--fitx-primary)" },
                  { value: protein.value, target: proteinUnknown ? null : protein.target, color: "var(--fitx-gold)" },
                ]}
              >
                <span className={styles.ringValue}>{caloriesUnknown ? <Unknown /> : <CountUp value={Math.round(calories.value)} format={kcal} />}</span>
                <span className={styles.ringUnit}>kcal eaten</span>
              </HeroRing>

              <div className={styles.side}>
                {!caloriesUnknown && calories.target ? (
                  <p className={styles.left}>
                    <strong className={over ? styles.overText : undefined}>{kcal(over ? calories.over : calories.target - calories.value)}</strong>
                    <span>kcal {over ? "over" : "left"}</span>
                  </p>
                ) : null}
                <div className={styles.rows}>
                  <Row name="Calories" color="var(--fitx-primary)" target={calories} unit="kcal" unknown={caloriesUnknown} over={over} />
                  <Row name="Protein" color="var(--fitx-gold)" target={protein} unit="g" unknown={proteinUnknown} over={false} />
                </div>
                <FoodNotes food={food} keys={["calories", "protein"]} />
                {!calories.target && !protein.target ? (
                  <WidgetNote href="/profile" action="Add them in Profile">Targets need your age, height and weight.</WidgetNote>
                ) : estimated ? (
                  <WidgetNote href="/nutrition" action="Set your own">Estimated from your profile.</WidgetNote>
                ) : null}
                <div className={styles.actions}>
                  <Link href="/nutrition" className="fitx-button"><Plus size={16} aria-hidden="true" />Log food</Link>
                  <Link href="/nutrition?scan=1" className={styles.quiet}><ScanBarcode size={16} aria-hidden="true" />Scan barcode</Link>
                </div>
              </div>
            </div>
          );
        }}
      </SummaryGate>
    </section>
  );
}
