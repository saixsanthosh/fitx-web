"use client";

/**
 * One piece of equipment as a toggle tile (aria-pressed): its studio photo (src/lib/training/equipment-photos.ts),
 * or its line icon when it has none, its name and a check mark. Used by the Workouts setup and the library's
 * "Equipment you have". `size="sm"` is the narrow tile of a sideways rail on phones.
 */
import Image from "next/image";
import { useState } from "react";
import { Check } from "lucide-react";
import { equipmentPhoto } from "@/lib/training/equipment-photos";
import { cn } from "@/lib/utils";
import { EquipmentIcon } from "./EquipmentIcon";
import styles from "./EquipmentTile.module.css";

export function EquipmentTile({ equipmentKey, label, on, onClick, disabled = false, size = "md", className }: {
  /** An equipment key, or "none" for no equipment. */
  equipmentKey: string;
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const photo = failed ? null : equipmentPhoto(equipmentKey);
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className={cn(styles.tile, size === "sm" && styles.sm, on && styles.on, className)}>
      <span className={styles.picture} aria-hidden="true">
        {photo ? (
          <Image src={photo.src} alt="" fill sizes={size === "sm" ? "104px" : "(min-width: 768px) 160px, 33vw"} placeholder="blur" blurDataURL={photo.blurDataURL} className={styles.photo} onError={() => setFailed(true)} />
        ) : (
          <span className={styles.icon}><EquipmentIcon name={equipmentKey} size={size === "sm" ? 30 : 36} /></span>
        )}
      </span>
      <span className={styles.label}>{label}</span>
      <span aria-hidden="true" className={styles.check}>{on && <Check size={12} strokeWidth={3} />}</span>
    </button>
  );
}
