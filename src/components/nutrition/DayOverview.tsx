import Link from "next/link";
import { Droplets, SlidersHorizontal } from "lucide-react";
import { calorieBalance, goalPercent, goalProgress, MACRO_LABEL, type DayTargets, type KnownTotals } from "@/lib/domain/nutrition";
import { SegmentRing } from "./SegmentRing";
import styles from "./DayOverview.module.css";

const MACROS = [["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]] as const;

export interface DayOverviewProps {
  /** The section's accessible name ("Nutrition summary for …") and its heading ("Today"). */
  summaryLabel: string;
  heading: string;
  totals: KnownTotals;
  target: DayTargets | null;
  /** Where the targets come from, such as "Targets you set" or "Estimate from your profile". */
  targetSource: string;
  hasOwnTargets: boolean;
  estimateCount: number;
  onTargets: () => void;
  water: { ml: number; target: number | null; busy: boolean; goalHref: string; onAdd: (ml: number) => void };
}

/**
 * The top of Nutrition: calories against the day's target (goal − food = left, as the reference apps put it), the
 * three macros against theirs, and water. Nothing unknown is shown as 0: macros leave out entries with no value and
 * say how many, and with no target there is no "left".
 */
export function DayOverview({ summaryLabel, heading, totals, target, targetSource, hasOwnTargets, estimateCount, onTargets, water }: DayOverviewProps) {
  const eaten = Math.round(totals.calories);
  const goal = target?.calories ?? null;
  const progress = goal ? goalProgress(totals.calories, goal) : null;
  const balance = calorieBalance(totals.calories, goal);
  const ringLabel = `${eaten} calories logged${goal ? ` of ${goal} calorie target` : ""}${balance ? `, ${balance.remaining} ${balance.over ? "over" : "left"}` : ""}`;
  return (
    <section className={styles.overview} aria-label={summaryLabel}>
      <div className={styles.head}>
        <div className="min-w-0">
          <h2 className={styles.heading}>{heading}</h2>
          {target && <p className={styles.source}>{targetSource}</p>}
        </div>
        <button type="button" onClick={onTargets} className={styles.targets}><SlidersHorizontal size={14} aria-hidden="true"/>{hasOwnTargets ? "Your targets" : "Edit targets"}</button>
      </div>

      <div className={styles.body}>
        <div className={styles.energy}>
          <div role="img" aria-label={ringLabel} className={styles.ring}>
            <SegmentRing size="lg" segments={[{ percent: progress?.percent ?? 0, tone: progress?.isOver ? "over" : "energy" }]}>
              <strong className={styles.ringNumber}>{eaten.toLocaleString()}</strong>
              <span className={styles.ringUnit}>{goal ? `/ ${goal.toLocaleString()} kcal` : "kcal eaten"}</span>
            </SegmentRing>
          </div>
          <div className={styles.balance}>
            {balance ? <>
              <p className={`${styles.left} ${balance.over ? styles.over : ""}`}><strong>{balance.remaining.toLocaleString()}</strong> <span>kcal {balance.over ? "over your target" : "left"}</span></p>
              <dl className={styles.sum}>
                <div><dt>Goal</dt><dd>{goal?.toLocaleString()}</dd></div>
                <div aria-hidden="true" className={styles.op}>−</div>
                <div><dt>Food</dt><dd>{eaten.toLocaleString()}</dd></div>
              </dl>
              <p className={styles.fine}>Exercise isn&apos;t added back.{estimateCount > 0 ? ` Includes ${estimateCount} ${estimateCount === 1 ? "estimate" : "estimates"}.` : ""}</p>
            </> : <>
              <p className={styles.noTarget}>Set a target to see what&apos;s left.</p>
              {estimateCount > 0 && <p className={styles.fine}>Includes {estimateCount} {estimateCount === 1 ? "estimate" : "estimates"}.</p>}
            </>}
          </div>
        </div>

        <ul className={styles.macros} aria-label="Macros">
          {MACROS.map(([key, label]) => {
            const value = Math.round(totals[key]);
            const macroGoal = target?.[key] ?? null;
            const macro = macroGoal ? goalProgress(totals[key], macroGoal) : null;
            const unknown = totals.unknown[key];
            return (
              <li key={key} className={styles.macro} data-macro={key}>
                <div className={styles.macroTop}>
                  <span className={styles.macroName}><i aria-hidden="true"/>{label}</span>
                  <span className={styles.macroValue}><strong>{value}</strong>{macroGoal ? ` / ${macroGoal} g` : " g"}</span>
                </div>
                {macro && macroGoal
                  ? <div className={`${styles.track} ${macro.isOver ? styles.trackOver : ""}`} role="progressbar" aria-label={`${label} against target`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={macro.percent}><span style={{ transform: `scaleX(${macro.percent / 100})` }}/></div>
                  : <div className={styles.track} aria-hidden="true"/>}
                <span className={styles.macroNote}>
                  {macro && macroGoal ? (macro.isOver ? <span className={styles.over}>{macro.over} g over</span> : `${Math.max(0, Math.round(macroGoal) - value)} g left`) : "No target"}
                  {unknown > 0 && ` · ${unknown} without ${MACRO_LABEL[key]}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.water}>
        <Droplets size={16} aria-hidden="true" className={styles.waterIcon}/>
        <div className={styles.waterMain}>
          <p className={styles.waterText}><strong>{(water.ml / 1000).toFixed(1)} L</strong> water{water.target ? <span> / {(water.target / 1000).toFixed(1)} L</span> : null}</p>
          {water.target
            ? <div className={styles.waterTrack} role="progressbar" aria-label="Water against target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPercent(water.ml, water.target)}><span style={{ transform: `scaleX(${goalPercent(water.ml, water.target) / 100})` }}/></div>
            : <Link href={water.goalHref} className={styles.waterGoal}>Set a water goal</Link>}
        </div>
        <div className={styles.waterButtons}>
          {[250, 500].map((ml) => <button key={ml} type="button" disabled={water.busy} onClick={() => water.onAdd(ml)} className={styles.waterButton}>+{ml} ml</button>)}
        </div>
      </div>
    </section>
  );
}
