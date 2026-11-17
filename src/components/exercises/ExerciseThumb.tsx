"use client";

import Image from "next/image";
import { useState } from "react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { isOptimizableImageUrl } from "@/lib/training/media";
import { exerciseInitials, THUMB_SIZES, thumbSource, type ThumbSize, type ThumbSourceInput } from "./thumb-source";

type ExerciseThumbProps = Omit<ThumbSourceInput, "supabaseUrl"> & {
  size?: ThumbSize;
  /** The exercise's equipment keys. With no photo, its icon is shown ("none" for body weight when the list is empty). */
  equipment?: readonly string[];
  className?: string;
};

/**
 * A square, rounded thumbnail of an exercise's first photo. Lazy-loaded. Without a photo, or when it
 * fails to load, it shows the equipment icon (when `equipment` is given) or the exercise's initials.
 */
export function ExerciseThumb({ size = "md", equipment, className = "", ...source }: ExerciseThumbProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const px = THUMB_SIZES[size];
  const found = thumbSource({ ...source, supabaseUrl: SUPABASE_URL });
  const showPhoto = found !== null && failedUrl !== found.url;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fitx-surface-variant text-fitx-text-secondary ${className}`}
      style={{ width: px, height: px }}
    >
      {showPhoto ? (
        <Image
          src={found.url}
          alt={found.alt}
          width={px}
          height={px}
          sizes={`${px}px`}
          loading="lazy"
          unoptimized={!isOptimizableImageUrl(found.url, SUPABASE_URL)}
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(found.url)}
        />
      ) : equipment ? (
        <EquipmentIcon name={equipment[0] ?? "none"} size={Math.round(px * 0.55)} title={`${source.name}: no photo`} />
      ) : (
        <span role="img" aria-label={`${source.name}: no photo`} className="font-heading font-extrabold tracking-wide" style={{ fontSize: Math.max(12, Math.round(px * 0.34)) }}>
          {exerciseInitials(source.name)}
        </span>
      )}
    </span>
  );
}
