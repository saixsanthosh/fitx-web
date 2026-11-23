"use client";

import Image from "next/image";
import { useState } from "react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { isOptimizableImageUrl } from "@/lib/training/media";
import { useDemoIndexData, useDemoModel } from "@/lib/training/use-demo-model";
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
 * When the demonstration index has the member's model for it, the card shows that model's start frame instead, so
 * library cards follow the member's choice with no page changes; it is marked "AI demo". Without a photo, or when it
 * fails, FITX's drawing of the equipment sits on the surface colour instead.
 */
export function ExerciseCover({ equipment, sizes, eager = false, className = "", imageClassName = "", ...source }: ExerciseCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const index = useDemoIndexData();
  const model = useDemoModel();
  // A demonstration frame that fails to load gives way to the exercise's own photo.
  const [demoFailed, setDemoFailed] = useState(false);
  const found = thumbSource({ ...source, supabaseUrl: SUPABASE_URL, demo: demoFailed ? null : { index, model } });
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
          onError={() => (found.aiDemo ? setDemoFailed(true) : setFailedUrl(found.url))}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-fitx-text-secondary">
          <EquipmentIcon name={equipment[0] ?? "none"} size={56} title={`${source.name}: no photo`} />
        </span>
      )}
      {showPhoto && found.aiDemo && <span className="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-fitx-scrim/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[.12em] text-fitx-on-inverse">AI demo</span>}
    </span>
  );
}
