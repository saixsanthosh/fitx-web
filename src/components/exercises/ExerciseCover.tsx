"use client";

import Image from "next/image";
import { useState } from "react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { isOptimizableImageUrl } from "@/lib/training/media";
import { thumbSource, type ThumbSourceInput } from "./thumb-source";

type ExerciseCoverProps = Omit<ThumbSourceInput, "supabaseUrl"> & {
  /** The exercise's equipment keys: with no photo, the first one is drawn ("none" for body weight). */
  equipment: readonly string[];
  /** next/image `sizes` for the cover's rendered width. */
  sizes: string;
  /** Loads at once (the first row on screen) instead of lazily. */
  eager?: boolean;
  className?: string;
  imageClassName?: string;
};

/**
 * An exercise's first photo filling its box (the box sets the aspect ratio, so nothing shifts while it loads).
 * Without a photo, or when it fails, FITX's drawing of the equipment sits on the surface colour instead.
 */
export function ExerciseCover({ equipment, sizes, eager = false, className = "", imageClassName = "", ...source }: ExerciseCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const found = thumbSource({ ...source, supabaseUrl: SUPABASE_URL });
  const showPhoto = found !== null && failedUrl !== found.url;
  return (
    <span className={`relative block overflow-hidden bg-fitx-surface-variant ${className}`}>
      {showPhoto ? (
        <Image
          src={found.url}
          alt={found.alt}
          fill
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          unoptimized={!isOptimizableImageUrl(found.url, SUPABASE_URL)}
          className={`object-cover ${imageClassName}`}
          onError={() => setFailedUrl(found.url)}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-fitx-text-secondary">
          <EquipmentIcon name={equipment[0] ?? "none"} size={56} title={`${source.name}: no photo`} />
        </span>
      )}
    </span>
  );
}
