"use client";

import Image from "next/image";
import { useState } from "react";
import { IMG } from "@/data/images";

/**
 * The sign-in pages' photo is decorative. If it can't load (the photo host or the image optimizer failing), it is
 * dropped so the panel's dark background shows, instead of a broken-image icon and alt text over the logo.
 * Passing onError also makes next/image report an error that happened before hydration.
 */
export function AuthVisualImage() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      src={IMG.workoutMan}
      alt=""
      fill
      preload
      sizes="(max-width: 900px) 100vw, 52vw"
      className="auth-visual-image"
      onError={() => setFailed(true)}
    />
  );
}
