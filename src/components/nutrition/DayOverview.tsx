import Link from "next/link";
import { Droplets, SlidersHorizontal } from "lucide-react";
import type { DayTargets, KnownTotals } from "@/lib/domain/nutrition";
import { overviewView, type DayLoad, type OverviewLine } from "@/lib/domain/nutrition-day";
import { SegmentRing } from "./SegmentRing";
import styles from "./DayOverview.module.css";

export interface DayOverviewProps {
  /** The section's accessible name ("Nutrition summary for …") and its heading ("Today"). */
  summaryLabel: string;
  heading: string;
  /** Whether this day's figures are in: until they are, nothing is shown as a number (no "0 kcal", no "no target"). */
  state: DayLoad;
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
 * The top of Nutrition: calories and protein against the day's targets, large, with what is left; carbs and fat
 * small beneath; then water. Nothing unknown is shown as 0: totals leave out entries with no value and say how
 * many, with no target there is no "left", and while the day is loading (or failed to load) there are no figures
 * (overviewView). One structure for every state: the Targets and water buttons are the same elements before and
 * after the day loads, so one that has the focus keeps it when the figures come in.
 */
export function DayOverview({ summaryLabel, heading, state, totals, target, targetSource, hasOwnTargets, estimateCount, onTargets, water }: DayOverviewProps) {
  const view = overviewView({ state, totals, target, targetSource, hasOwnTargets, estimateCount, water: { ml: water.ml, target: water.target } });
  const line = (shown: OverviewLine, overTone: boolean) => (shown.kind === "amount"
    ? <p className={overTone && shown.over ? `${styles.left} ${styles.over}` : styles.left}><strong>{shown.amount}</strong> <span>{shown.text}</span></p>
    : <p role={view.status ? "status" : undefined} className={styles.noTarget}>{shown.text}</p>);
  return (
    <section className={styles.overview} aria-label={summaryLabel} aria-busy={view.busy || undefined}>
      <div className={styles.head}>
        <div className="min-w-0">
          <h2 className={styles.heading}>{heading}</h2>
          {view.source && <p className={styles.source}>{view.source}</p>}
        </div>
        {/* Marked unavailable while the day loads (its targets aren't known yet), never removed or disabled: focus stays on it. */}
        <button type="button" aria-disabled={view.targets.acts ? undefined : true} onClick={view.targets.acts ? onTargets : undefined} className={styles.targets}><SlidersHorizontal size={14} aria-hidden="true"/>{view.targets.label}</button>
      </div>

      <div className={styles.hero}>
        <div className={styles.meter} data-tone="energy">
          <div role="img" aria-label={view.energy.label} className={styles.ring}>
            <SegmentRing size="lg" segments={[{ percent: view.energy.percent, tone: view.energy.over ? "over" : "energy" }]}>
              <strong className={styles.ringNumber}>{view.energy.number}</strong>
              <span className={styles.ringUnit}>{view.energy.unit}</span>
            </SegmentRing>
          </div>
          {line(view.energy.line, true)}
        </div>
        <div className={styles.meter} data-tone="protein">
          <div role="img" aria-label={view.protein.label} className={styles.ring}>
            <SegmentRing size="lg" segments={[{ percent: view.protein.percent, tone: "protein" }]}>
              <strong className={styles.ringNumber}>{view.protein.number}{view.protein.grams && <small>g</small>}</strong>
              <span className={styles.ringUnit}>{view.protein.unit}</span>
            </SegmentRing>
          </div>
          {view.protein.line && line(view.protein.line, false)}
        </div>
      </div>

      <ul className={styles.macros} aria-label="Carbs and fat">
        {view.macros.map((macro) => (
          <li key={macro.key} className={styles.macro} data-macro={macro.key}>
            <div className={styles.macroTop}>
              <span className={styles.macroName}><i aria-hidden="true"/>{macro.name}</span>
              <span className={styles.macroValue}><strong>{macro.value}</strong>{macro.goal}</span>
            </div>
            {macro.progress
              ? <div className={`${styles.track} ${macro.progress.over ? styles.trackOver : ""}`} role="progressbar" aria-label={macro.progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={macro.progress.percent}><span style={{ transform: `scaleX(${macro.progress.percent / 100})` }}/></div>
              : <div className={styles.track} aria-hidden="true"/>}
          </li>
        ))}
      </ul>
      {view.fine && <p className={styles.fine}>{view.fine}</p>}

      <div className={styles.water}>
        <Droplets size={16} aria-hidden="true" className={styles.waterIcon}/>
        <div className={styles.waterMain}>
          <p className={styles.waterText}><strong>{view.water.amount}</strong> water{view.water.target ? <span>{view.water.target}</span> : null}</p>
          {view.water.percent !== null
            ? <div className={styles.waterTrack} role="progressbar" aria-label="Water against target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.water.percent}><span style={{ transform: `scaleX(${view.water.percent / 100})` }}/></div>
            : view.water.goalLink ? <Link href={water.goalHref} className={styles.waterGoal}>Set a water goal</Link> : null}
        </div>
        <div className={styles.waterButtons}>
          {/* Water is added once the day's total is known (a total read before the tap can't undo it), and while a tap is
              being saved the buttons are marked unavailable, not disabled: the one with the focus keeps it. */}
          {[250, 500].map((ml) => <button key={ml} type="button" aria-disabled={!view.water.acts || water.busy || undefined} onClick={() => { if (view.water.acts && !water.busy) water.onAdd(ml); }} className={styles.waterButton}>+{ml} ml</button>)}
        </div>
      </div>
    </section>
  );
}
