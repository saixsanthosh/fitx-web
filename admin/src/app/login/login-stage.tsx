"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { FitxMark } from "@/components/fitx-mark";
import styles from "./login.module.css";

const TICKS = Array.from({ length: 60 }, (_, index) => index);
// Decorative bar heights for the ten sections (artwork, not data).
const BARS = [0.42, 0.66, 0.54, 0.82, 0.6, 0.95, 0.7, 0.5, 0.76, 0.58];

/**
 * The sign-in scene: a dial that draws itself and turns, a pulse line with a travelling scan, and ten
 * bars for the console's ten sections. SVG and CSS only. It pauses with the button, while the tab is
 * hidden, and does not move at all with reduced motion.
 */
export function LoginStage() {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return (
    <section className={`${styles.stage}${paused || hidden ? ` ${styles.paused}` : ""}`} aria-label="FITX Admin">
      <div className={styles.stageBrand}><FitxMark size={30} /><span>FITX <em>ADMIN</em></span></div>
      <svg className={styles.scene} viewBox="0 0 600 600" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
        <g className={styles.grid}>
          {Array.from({ length: 13 }, (_, index) => <line key={`v${index}`} x1={index * 50} y1={0} x2={index * 50} y2={600} />)}
          {Array.from({ length: 13 }, (_, index) => <line key={`h${index}`} x1={0} y1={index * 50} x2={600} y2={index * 50} />)}
        </g>
        <g className={styles.dial} transform="translate(300 280)">
          <g className={styles.ticks}>
            {TICKS.map((tick) => <line key={tick} x1={0} y1={-214} x2={0} y2={tick % 5 === 0 ? -198 : -206} transform={`rotate(${tick * 6})`} />)}
          </g>
          <circle className={styles.ringOuter} r={176} pathLength={1} />
          <g className={styles.spinSlow}><circle className={styles.arcA} r={150} pathLength={1} /></g>
          <g className={styles.spinReverse}><circle className={styles.arcB} r={122} pathLength={1} /></g>
          <circle className={styles.ringInner} r={92} pathLength={1} />
          <g className={styles.core}>
            <circle r={7} />
          </g>
        </g>
        <g className={styles.pulseGroup}>
          <path className={styles.pulseLine} pathLength={1} d="M40 280H196L214 248L236 318L258 214L280 340L300 280H560" />
          <path className={styles.pulseScan} pathLength={1} d="M40 280H196L214 248L236 318L258 214L280 340L300 280H560" />
        </g>
        <g className={styles.bars} transform="translate(120 560)">
          {BARS.map((height, index) => (
            <g key={index} transform={`translate(${index * 38} 0)`}>
              <rect className={styles.bar} x={0} y={-90 * height} width={22} height={90 * height} rx={3} />
              <text className={styles.barLabel} x={11} y={20} textAnchor="middle">{String(index + 1).padStart(2, "0")}</text>
            </g>
          ))}
        </g>
      </svg>
      <p className={styles.stageLine}>Operations console</p>
      <button type="button" className={styles.pause} onClick={() => setPaused((value) => !value)} aria-pressed={paused} aria-label={paused ? "Play motion" : "Pause motion"}>
        {paused ? <Play aria-hidden="true" size={18} /> : <Pause aria-hidden="true" size={18} />}
      </button>
    </section>
  );
}
