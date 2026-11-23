"use client";

import Link from "next/link";
import { SOCIAL_LIMITS, type AgeBand } from "@/lib/social";
import styles from "./Explore.module.css";

/**
 * What a member reads when a part of Explore is closed to them by age (social_age_restricted; O1 a). Members with no
 * date of birth get the teen rules and a link to add it; teens read plainly why. For the groups stream's messages,
 * communities and leaderboards: pass the database's hint (the age band) or the member's `age_band`.
 */
export function AgeNotice({ band, feature = "This part of Explore" }: { band: AgeBand | string | null | undefined; feature?: string }) {
  if (band === "unknown") {
    return (
      <p className={styles.note} role="note">
        {feature} is for members aged {SOCIAL_LIMITS.adultAge} and over, and FITX has no date of birth for you.{" "}
        <Link href="/explore/settings#birth-date" className="font-semibold underline">Add your date of birth</Link>
      </p>
    );
  }
  return (
    <p className={styles.note} role="note">
      {feature} is for members aged {SOCIAL_LIMITS.adultAge} and over. It opens for you on your {SOCIAL_LIMITS.adultAge}th birthday.
    </p>
  );
}
