import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import styles from "./landing.module.css";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Small drawn marks for each feature (FITX's own, not an icon set). */
const GLYPHS: Record<string, ReactNode> = {
  points: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M12 5v7m0 0-4 7m4-7 4 7M7 9h10" />
      {[[12, 3.5], [12, 12], [8, 19], [16, 19], [7, 9], [17, 9]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="currentColor" />)}
    </svg>
  ),
  reps: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path {...stroke} d="M20 4v4h-4" />
      <path {...stroke} d="M10 10.5 12 9v6" />
    </svg>
  ),
  demo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="4.5" r="1.8" fill="currentColor" />
      <path {...stroke} d="M12 7.5v5.5m0 0-3.5 3 1 4.5m2.5-7.5 3.5 3-1 4.5M8 10h8" />
      <path {...stroke} strokeDasharray="1.5 2.5" d="M4.5 15a8 8 0 0 1 2-8M19.5 15a8 8 0 0 0-2-8" />
    </svg>
  ),
  voice: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
    </svg>
  ),
  captions: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect {...stroke} x="3" y="6" width="18" height="12" rx="2.5" />
      <path {...stroke} d="M7 11h6M15 11h2M7 14.5h3M12 14.5h5" />
    </svg>
  ),
  range: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect {...stroke} x="9" y="3" width="6" height="18" rx="3" />
      <path {...stroke} d="M12 11v7M4 7h2M4 12h2M4 17h2" />
    </svg>
  ),
  device: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect {...stroke} x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path {...stroke} d="m9.5 12 2 2 3.5-4" />
    </svg>
  ),
};

// Only what the shipped Home workout does today (tests/landing/page.test.ts holds this list to the code,
// the exercise count included).
const FEATURES = [
  { glyph: "demo", title: "14 exercises", text: "Each opens with a drawn demonstration." },
  { glyph: "points", title: "33 body points", text: "A live figure follows your joints." },
  { glyph: "reps", title: "Counts every rep", text: "Reps and holds count as you move." },
  { glyph: "voice", title: "Your choice of voice", text: "Female or male cues, or none." },
  { glyph: "captions", title: "Big captions", text: "Every cue on screen, readable from afar." },
  { glyph: "device", title: "Stays on your device", text: "Video is never uploaded or recorded." },
] as const;

/** What Home workout does. The owner wants these features described here and nowhere else on the site. */
export function HomeWorkoutFeatures() {
  return (
    <section className={styles.section} aria-labelledby="home-workout-title">
      <Reveal className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>Home workout</p>
          <h2 id="home-workout-title" className={styles.sectionTitle}>A coach that watches.</h2>
        </div>
      </Reveal>
      <Stagger as="ul" className={styles.features} gap={0.07}>
        {FEATURES.map((feature) => (
          <StaggerItem as="li" key={feature.title} className={styles.feature}>
            <span className={styles.glyph}>{GLYPHS[feature.glyph]}</span>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </StaggerItem>
        ))}
      </Stagger>
      <div className={styles.featureFoot}>
        <p>Guidance, not medical advice.</p>
        <Link href="/home-workout" prefetch={false} className={styles.solid}>
          Try Home workout <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
