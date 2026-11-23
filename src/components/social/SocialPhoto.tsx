"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { usePhotoUrl } from "./usePhotoUrl";
import styles from "./Explore.module.css";

type Props = {
  path: string;
  alt: string;
  /** The box's shape (width / height). The space is kept before the photo arrives. */
  ratio: number;
  priority?: boolean;
  className?: string;
  sizes?: string;
};

/** A private Explore photo behind a signed link: a calm wash while it loads, then a fade in once decoded. */
export function SocialPhoto({ path, alt, ratio, priority = false, className = "" }: Props) {
  const url = usePhotoUrl(path);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = url && loaded === url;
  return (
    <div className={`${styles.photoBox} ${className}`} style={{ aspectRatio: String(ratio) }}>
      {!ready && url !== null && failed !== url && <span aria-hidden="true" className={styles.photoWash} />}
      {(url === null || (url && failed === url)) && (
        <span className={styles.photoGone}><ImageOff size={20} aria-hidden="true" /><span className="sr-only">Photo not available</span></span>
      )}
      {url && failed !== url && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private photo
        <img
          src={url}
          alt={alt}
          className={`${styles.photo} ${ready ? styles.photoReady : ""}`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
        />
      )}
    </div>
  );
}

/** A post's frame shape from its first photo, kept between 4:5 and 1.91:1 so the feed keeps a steady rhythm. */
export function frameRatio(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 4 / 5;
  return Math.min(1.91, Math.max(0.8, width / height));
}
