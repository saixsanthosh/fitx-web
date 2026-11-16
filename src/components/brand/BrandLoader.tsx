import { Logo } from "@/components/ui/Logo";
import { BrandLoaderRelease } from "./BrandLoaderRelease";
import styles from "./BrandLoader.module.css";

/**
 * The short FITX moment on a cold load for returning devices (the full film plays once per account).
 * Hidden unless the head script sets `data-fitx-loader`; it lasts from first paint until the app
 * hydrates, at least 0.65 s and at most about 1.2 s, and never shows with reduced motion.
 */
export function BrandLoader() {
  return (
    <div className={styles.loader} aria-hidden="true">
      <div className={styles.lockup}>
        <Logo size={60} animateMark />
        <span className={styles.tagline}>TRAIN SMART. LIVE FIT.</span>
      </div>
      <BrandLoaderRelease />
    </div>
  );
}
