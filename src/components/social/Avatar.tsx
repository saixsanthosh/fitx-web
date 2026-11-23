"use client";

import type { SocialAuthor } from "@/lib/social";
import { AVATAR_RING } from "@/lib/social/slots";
import { usePhotoUrl } from "./usePhotoUrl";
import styles from "./Explore.module.css";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

type AvatarUser = Pick<SocialAuthor, "display_name" | "avatar_path"> & { id?: string };

/**
 * A member's Explore picture, or their initials. Decorative: the name is always next to it. When AVATAR_RING is
 * filled (the story ring, wave 2) and the member's id is known, it wraps the picture.
 */
export function Avatar({ user, size = 40, ring = false }: { user: AvatarUser; size?: number; ring?: boolean }) {
  const picture = <AvatarPicture user={user} size={size} ring={ring} />;
  const Ring = AVATAR_RING;
  if (Ring && user.id) return <Ring userId={user.id} size={size}>{picture}</Ring>;
  return picture;
}

function AvatarPicture({ user, size, ring }: { user: AvatarUser; size: number; ring: boolean }) {
  const url = usePhotoUrl(user.avatar_path);
  return (
    <span aria-hidden="true" className={`${styles.avatar} ${ring ? styles.avatarRing : ""}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private photo
        <img src={url} alt="" className={styles.avatarImg} width={size} height={size} decoding="async" />
      ) : initials(user.display_name)}
    </span>
  );
}
