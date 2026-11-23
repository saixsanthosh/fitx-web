"use client";

import Image from "next/image";
import { AnimatePresence, m } from "framer-motion";
import { usePageVisible, useReducedMotionSafe } from "@/components/motion";
import { sceneImage, type Scene } from "@/lib/home/scenes";
import styles from "./HomeScene.module.css";

/** Fixed positions, sizes and timings for the dust motes, so the picture is the same on every render. */
const MOTES = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 37 + 11) % 92 + 4}%`,
  top: `${(index * 53 + 29) % 70 + 18}%`,
  size: 2 + (index % 3),
  delay: `${-((index * 1.7) % 12).toFixed(1)}s`,
  duration: `${11 + (index % 5) * 2}s`,
}));

/**
 * Home's moving background: the scene's still, drifting like a slow camera move, with the movement that belongs
 * to the picture drawn over it (dust in the light, rain, mist, light rays or a rising glow). Transform and opacity
 * only, paused while the tab is hidden, and a still picture with reduced motion. A new scene crossfades in.
 * Decorative: the quote and greeting carry the meaning.
 */
export function HomeScene({ scene }: { scene: Scene | null }) {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const still = reduced || !visible;
  return (
    <div className={styles.scene} data-still={reduced ? "" : undefined} data-paused={still ? "" : undefined} aria-hidden="true">
      <AnimatePresence initial={false}>
        {scene && (
          <m.div
            key={scene.id}
            className={styles.plate}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 1.6, ease: [0.33, 0, 0.2, 1] }}
          >
            <div className={`${styles.camera} ${styles[scene.drift]}`}>
              <Image
                src={sceneImage(scene).src}
                alt=""
                fill
                priority
                sizes="(min-width: 1440px) 1200px, 100vw"
                placeholder="blur"
                blurDataURL={sceneImage(scene).blurDataURL}
                style={{ objectFit: "cover", objectPosition: scene.focus }}
              />
            </div>
            {!reduced && <Motion kind={scene.motion} />}
          </m.div>
        )}
      </AnimatePresence>
      <div className={styles.shade} />
    </div>
  );
}

function Motion({ kind }: { kind: Scene["motion"] }) {
  if (kind === "dust") {
    return (
      <div className={styles.dust}>
        {MOTES.map((mote, index) => (
          <span key={index} style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size, animationDelay: mote.delay, animationDuration: mote.duration }} />
        ))}
      </div>
    );
  }
  if (kind === "rain") return <div className={styles.rain}><span /><span /></div>;
  if (kind === "mist") return <div className={styles.mist}><span /><span /></div>;
  if (kind === "rays") return <div className={styles.rays}><span /></div>;
  return <div className={styles.glow}><span /></div>;
}
