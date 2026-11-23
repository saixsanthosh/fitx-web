"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { useInView } from "framer-motion";
import styles from "./landing.module.css";

const WORDS = ["Train.", "Eat.", "Move.", "Progress."] as const;

/**
 * The vision, and the way in: the film's last shot (the three athletes walking out of the coral light) as a slow
 * push-in behind four words that land one after another, then the call to start. Reduced motion: everything is
 * simply there.
 */
export function VisionReel() {
  const root = useRef<HTMLElement>(null);
  const inView = useInView(root, { amount: 0.4, once: true });
  return (
    <section ref={root} className={styles.vision} aria-labelledby="vision-title" data-in={inView}>
      <div className={styles.visionStill} aria-hidden="true" />
      <div className={styles.visionGlow} aria-hidden="true" />
      <div className={styles.visionShade} aria-hidden="true" />
      <div className={styles.visionInner}>
        <p className={`${styles.eyebrow} ${styles.stageEyebrow}`}>The idea</p>
        <h2 id="vision-title" className={styles.visionTitle}>
          {WORDS.map((word, index) => (
            <span key={word} className={styles.visionWord} style={{ transitionDelay: `${120 + index * 140}ms` }}>{word}{index < WORDS.length - 1 ? " " : ""}</span>
          ))}
        </h2>
        <p className={styles.visionLine}>The gym, the kitchen and the road in one place, so every part of your day pulls the same way.</p>
        <Link href="/signup" prefetch={false} className={`${styles.primary} fitx-when-signed-out`}>
          Create account <ArrowRight size={17} aria-hidden="true" />
        </Link>
        <Link href="/dashboard" prefetch={false} className={`${styles.primary} fitx-when-signed-in`}>
          Open dashboard <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
