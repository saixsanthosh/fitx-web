"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";
import { m, useScroll, useTransform } from "framer-motion";
import { useReducedMotionSafe } from "@/components/motion";
import { LANDING_MEDIA } from "@/data/landing-media";
import { portionNutrition, type PieceFood } from "./portion";
import { ramp } from "./story";
import styles from "./landing.module.css";

const TILE_SIZES = "(max-width: 767px) 100vw, 50vw";

/** Food and Activity, side by side from 768 px. */
export function MoreTiles({ food }: { food: PieceFood | null }) {
  return (
    <section className={styles.section} aria-labelledby="more-title">
      <div className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>Also in FITX</p>
          <h2 id="more-title" className={styles.sectionTitle}>Eat. Move. Log it.</h2>
        </div>
      </div>
      <div className={styles.tiles}>
        <FoodTile food={food} />
        <ActivityTile />
      </div>
    </section>
  );
}

function useDrift() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform<number, string>(scrollYProgress, (p) => `${ramp(p, 0, 1, -5, 5)}%`);
  return { ref, reduced, progress: scrollYProgress, y };
}

function FoodTile({ food }: { food: PieceFood | null }) {
  const { ref, reduced, y } = useDrift();
  const [pieces, setPieces] = useState(2);
  const image = LANDING_MEDIA.food;
  const totals = food ? portionNutrition(food, pieces) : null;
  return (
    <article ref={ref} className={styles.tile} aria-labelledby="tile-food-title">
      <m.div className={styles.tilePhoto} style={reduced ? undefined : { y }}>
        <Image src={image.src} alt={image.alt} fill sizes={TILE_SIZES} placeholder="blur" blurDataURL={image.blurDataURL} />
      </m.div>
      <div className={styles.tileShade} aria-hidden="true" />
      <div className={styles.tileBody}>
        <h3 id="tile-food-title">Log food</h3>
        <p>Grams or pieces. Search, scan or pick a recent meal.</p>
        {food && totals && (
          <div className={styles.foodCard} role="group" aria-label={`Portion example: ${food.name}`}>
            <div className={styles.foodRow}>
              <div className={styles.foodCardTop}>
                <strong>{food.name}</strong>
              </div>
              <div className={styles.stepper}>
                <button type="button" onClick={() => setPieces((n) => Math.max(1, n - 1))} disabled={pieces <= 1} aria-label={`One ${food.pieceLabel} fewer`}>
                  <Minus size={15} aria-hidden="true" />
                </button>
                <output aria-live="polite" aria-label={`${pieces} ${food.pieceLabel}`}>{pieces}</output>
                <button type="button" onClick={() => setPieces((n) => Math.min(9, n + 1))} disabled={pieces >= 9} aria-label={`One ${food.pieceLabel} more`}>
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <dl className={styles.macros}>
              <div><dt>Energy</dt><dd>{totals.kcal}<small> kcal</small></dd></div>
              <div><dt>Protein</dt><dd>{totals.protein}<small> g</small></dd></div>
              <div><dt>Carbs</dt><dd>{totals.carbs}<small> g</small></dd></div>
              <div><dt>Fat</dt><dd>{totals.fat}<small> g</small></dd></div>
            </dl>
            <span className={styles.source}>≈ {totals.grams} g · 1 {food.pieceLabel} ≈ {food.pieceGrams} g · {food.source}</span>
          </div>
        )}
        <Link href="/nutrition" prefetch={false} className={styles.tileLink}>Open Nutrition <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
    </article>
  );
}

const ROUTE = "M70 470C140 430 150 360 230 352S330 410 390 360 420 250 500 236 600 270 640 200 700 120 760 110";

function ActivityTile() {
  const { ref, reduced, progress, y } = useDrift();
  const draw = useTransform<number, number>(progress, (p) => ramp(p, 0.15, 0.65, 0.001, 1));
  const image = LANDING_MEDIA.run;
  return (
    <article ref={ref} className={styles.tile} aria-labelledby="tile-activity-title">
      <m.div className={styles.tilePhoto} style={reduced ? undefined : { y }}>
        <Image src={image.src} alt={image.alt} fill sizes={TILE_SIZES} placeholder="blur" blurDataURL={image.blurDataURL} style={{ objectPosition: "30% 50%" }} />
      </m.div>
      <div className={styles.tileShade} aria-hidden="true" />
      <svg className={styles.route} viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path className={styles.routeTrack} d={ROUTE} />
        <m.path className={styles.routeLine} d={ROUTE} style={{ pathLength: reduced ? 1 : draw }} />
        <circle className={styles.routeDot} cx="70" cy="470" r="9" />
      </svg>
      <div className={styles.tileBody}>
        <h3 id="tile-activity-title">Track activity</h3>
        <p>Live GPS route, distance and pace.</p>
        <ul className={styles.sports} aria-label="Sports">
          <li>Walk</li><li>Run</li><li>Ride</li>
        </ul>
        <Link href="/activity" prefetch={false} className={styles.tileLink}>Open Activity <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
    </article>
  );
}
