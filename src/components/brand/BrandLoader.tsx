import { FitxMark } from "@/components/ui/FitxMark";
import { BrandLoaderRelease } from "./BrandLoaderRelease";
import styles from "./BrandLoader.module.css";

/**
 * The short FITX moment on a cold load for returning devices (the full film plays once per account).
 * Hidden unless the head script sets `data-fitx-loader`; it lasts from first paint until the app hydrates,
 * at least 0.56 s and gone by 1.08 s (0.9 s plus a 0.18 s fade), and never shows with reduced motion.
 * The mark draws itself, the wordmark slides out from behind it and an ember hairline fills underneath.
 */
export function BrandLoader() {
  return (
    <div className={styles.loader} aria-hidden="true">
      <div className={styles.lockup}>
        <span className={styles.row}>
          <FitxMark size={46} animate className={styles.mark} />
          <span className={styles.wordClip}><span className={`fitx-wordmark ${styles.word}`}>FITX</span></span>
        </span>
        <span className={styles.track}><span className={styles.fill} /></span>
      </div>
      <BrandLoaderRelease />
    </div>
  );
}
