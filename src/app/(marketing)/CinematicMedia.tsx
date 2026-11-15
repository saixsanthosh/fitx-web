"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./page.module.css";

type CinematicMediaProps = {
  src: string;
  alt: string;
  ratio: "cinema" | "wide" | "portrait" | "square";
  mobileSrc?: string;
  videoSrc?: string;
  posterSrc?: string;
  priority?: boolean;
  className?: string;
};

/** Keeps a calm, accessible frame in place when a remote image cannot load. */
export function CinematicMedia({ src, alt, ratio, mobileSrc, videoSrc, posterSrc, priority = false, className = "" }: CinematicMediaProps) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className={`${styles.mediaFrame} ${styles[ratio]} ${videoSrc ? styles.hasVideo : ""} ${className}`}>
      {failed ? (
        <div role="img" aria-label={alt} className={styles.mediaFallback} />
      ) : (
        <picture className={styles.mediaPicture}>
          {mobileSrc && <source media="(max-width: 767px)" srcSet={mobileSrc} />}
          <Image
            src={src}
            alt={alt}
            fill
            sizes={ratio === "cinema" ? "100vw" : "(max-width: 767px) 100vw, (max-width: 1100px) 50vw, 44vw"}
            quality={75}
            preload={priority}
            loading={priority ? undefined : "lazy"}
            onError={() => setFailed(true)}
            className={styles.mediaImage}
          />
        </picture>
      )}
      {videoSrc && (
        <video className={styles.mediaVideo} controls preload="none" playsInline poster={posterSrc ?? src} aria-label={`Video: ${alt}`}>
          <source src={videoSrc} type="video/mp4" />
          Your browser cannot play this video.
        </video>
      )}
    </figure>
  );
}
