"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { toSocialError } from "@/lib/social";
import { BADGE_TEXT, challengesApi, type Challenge } from "@/lib/social/challenges";
import { useReadyExplore } from "../ExploreContext";
import { BadgeMark } from "./BadgeMark";
import { ChallengeCard } from "./ChallengeCard";
import styles from "./Challenges.module.css";
import exploreStyles from "../Explore.module.css";

type Box = "open" | "closed";

/** /explore/challenges: open weekly and monthly challenges (the member's own first), and the ones they finished. */
export function ChallengesView() {
  const { db } = useReadyExplore();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/explore/challenges";
  const box: Box = params?.get("box") === "closed" ? "closed" : "open";
  const [lists, setLists] = useState<Partial<Record<Box, Challenge[]>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    challengesApi.list(db, box)
      .then((items) => { if (live) { setLists((current) => ({ ...current, [box]: items })); setError(null); } })
      .catch((failure) => { if (live) setError(toSocialError(failure).message); });
    return () => { live = false; };
  }, [db, box]);

  const items = lists[box];
  const badges = box === "closed" ? (items ?? []).flatMap((challenge) => challenge.badges.map((kind) => ({ kind, challenge }))) : [];
  return (
    <div className={styles.page}>
      <Link href="/explore/community" className={`${exploreStyles.linkQuiet} inline-flex items-center gap-1`}><ArrowLeft size={15} aria-hidden="true" />Community</Link>
      <PageHeader
        title="Challenges"
        className="mb-0 sm:mb-0"
        actions={<Segmented label="Show" options={[{ value: "open", label: "Open" }, { value: "closed", label: "Finished" }]} value={box}
          onChange={(next) => router.replace(next === "closed" ? `${pathname}?box=closed` : pathname, { scroll: false })} />}
      />
      {error && <p className={exploreStyles.alert} role="alert">{error}</p>}
      {!items && !error && <div className={exploreStyles.skeleton} style={{ height: 180 }} aria-busy="true" aria-label="Loading challenges" />}
      {badges.length > 0 && (
        <section aria-labelledby="badges-title" className="flex flex-col gap-3">
          <h2 id="badges-title" className={exploreStyles.sectionTitle}>Your badges</h2>
          <ul className={styles.badges}>
            {badges.map(({ kind, challenge }) => (
              <li key={`${challenge.id}-${kind}`} className={styles.badge}>
                <BadgeMark kind={kind} />
                <span className="flex min-w-0 flex-col">
                  <span className={styles.badgeTitle}>{BADGE_TEXT[kind].title}</span>
                  <span className={styles.badgeText}>{challenge.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items && !items.length && (
        <div className={exploreStyles.empty}>
          <span className={exploreStyles.emptyMark}><Trophy size={26} aria-hidden="true" /></span>
          <h2 className={exploreStyles.emptyTitle}>{box === "open" ? "No open challenges" : "Nothing finished yet"}</h2>
          <p className={exploreStyles.emptyText}>
            {box === "open" ? "FITX opens weekly and monthly challenges here." : "Challenges you take part in show here once they end, with any badges you earned."}
          </p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className={styles.grid} aria-label={box === "open" ? "Open challenges" : "Finished challenges"}>
          {items.map((challenge, index) => (
            <li key={challenge.id}><Reveal y={14} delay={Math.min(index, 6) * 0.04} className="h-full"><ChallengeCard challenge={challenge} /></Reveal></li>
          ))}
        </ul>
      )}
    </div>
  );
}
