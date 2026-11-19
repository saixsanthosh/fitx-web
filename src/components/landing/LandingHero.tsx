"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { m, useScroll, useTransform } from "framer-motion";
import { useReducedMotionSafe } from "@/components/motion";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";
import { LANDING_MEDIA } from "@/data/landing-media";
import styles from "./landing.module.css";

/** Full-bleed opening frame. The photo slowly pushes in and the words lift away as the page scrolls. */
export function LandingHero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1.04, 1.16]);
  const photoY = useTransform(scrollYProgress, [0, 1], ["0%", "8%"]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const hero = LANDING_MEDIA.hero;

  return (
    <section ref={ref} className={styles.hero} aria-labelledby="hero-title">
      <m.div className={styles.heroMedia} style={reduced ? undefined : { scale, y: photoY }}>
        <Image src={hero.src} alt={hero.alt} fill sizes="100vw" preload placeholder="blur" blurDataURL={hero.blurDataURL} />
      </m.div>
      <div className={styles.heroShade} aria-hidden="true" />
      <m.div className={styles.heroInner} style={reduced ? undefined : { y: textY, opacity: textOpacity }}>
        <p className={`${styles.eyebrow} ${styles.stageEyebrow} ${styles.heroRise}`}>Train · Eat · Progress</p>
        <h1 id="hero-title" className={styles.heroTitle}>
          <span className={styles.heroLine}><span>Train smart.</span></span>
          <span className={styles.heroLine}><span>Live fit.</span></span>
        </h1>
        <div className={`${styles.heroActions} ${styles.heroRise}`}>
          <Link href="/signup" prefetch={false} className={`${styles.primary} fitx-when-signed-out`}>
            Start training <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/dashboard" prefetch={false} className={`${styles.primary} fitx-when-signed-in`}>
            Open dashboard <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a href="#scenes" className={styles.ghost}>
            See it move <ArrowDown size={15} aria-hidden="true" />
          </a>
        </div>
        <div className={`${styles.heroMeta} ${styles.heroRise}`}>
          <span>Gym · Home · Food · Activity</span>
          <IntroReplayControl className={styles.replay} />
        </div>
      </m.div>
    </section>
  );
}
