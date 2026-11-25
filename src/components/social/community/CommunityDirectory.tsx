"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Lock, Search, Trophy, UsersRound } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { toSocialError } from "@/lib/social";
import { challengesApi, communityChallengesNote, type Challenge } from "@/lib/social/challenges";
import { communitiesApi, memberCountText, type Community } from "@/lib/social/communities";
import { AgeNotice } from "../AgeNotice";
import { useReadyExplore } from "../ExploreContext";
import { SocialPhoto } from "../SocialPhoto";
import { ChallengeCard } from "../challenges/ChallengeCard";
import styles from "./Community.module.css";
import exploreStyles from "../Explore.module.css";

/** /explore/community: this week's challenges, then the communities FITX runs, with search. */
export function CommunityDirectory() {
  const { db, me } = useReadyExplore();
  const adult = me.age_band === undefined || me.age_band === "adult";
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Community[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[] | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    challengesApi.list(db, "open").then((items) => { if (live) setChallenges(items); }).catch(() => { if (live) setChallenges("failed"); });
    return () => { live = false; };
  }, [db]);

  useEffect(() => {
    if (!adult) return;
    let live = true;
    const timer = window.setTimeout(() => {
      communitiesApi.list(db, query.trim() || null)
        .then((items) => { if (live) { setList(items); setError(null); } })
        .catch((failure) => { if (live) setError(toSocialError(failure).message); });
    }, query ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [adult, db, query]);

  const shown = Array.isArray(challenges) ? challenges.slice(0, 3) : [];
  const note = communityChallengesNote(challenges);
  return (
    <div className={styles.page}>
      <PageHeader title="Community" />

      {/* Always here, so Challenges (and the finished ones, with their results) can be reached with none open. */}
      <section className={styles.section} aria-labelledby="community-challenges">
        <div className={exploreStyles.sectionHead}>
          <h2 id="community-challenges" className={styles.sectionTitle}>Challenges</h2>
          <Link href="/explore/challenges" className={`${exploreStyles.linkQuiet} inline-flex items-center gap-1`}>All challenges<ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        {challenges === null ? (
          <div className={exploreStyles.skeleton} style={{ height: 150 }} aria-busy="true" aria-label="Loading challenges" />
        ) : shown.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((challenge, index) => (
              <Reveal key={challenge.id} y={12} delay={index * 0.05}><ChallengeCard challenge={challenge} /></Reveal>
            ))}
          </div>
        ) : note && (
          <div className={styles.challengesNote}>
            <p className={exploreStyles.note}>{note.text}</p>
            {note.finishedLink && (
              <Link href="/explore/challenges?box=closed" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet} self-start`}>
                <Trophy size={16} aria-hidden="true" />Finished challenges and results
              </Link>
            )}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="community-list">
        <h2 id="community-list" className={styles.sectionTitle}>Communities</h2>
        {!adult ? (
          <AgeNotice band={me.age_band} feature="Joining communities" />
        ) : (
          <>
            <div className={styles.search}>
              <Search size={18} className={styles.searchIcon} aria-hidden="true" />
              <input type="search" className={styles.searchInput} aria-label="Search communities" placeholder="Running, strength, yoga…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            {error && <p className={exploreStyles.alert} role="alert">{error}</p>}
            {list === null && !error && <div className={exploreStyles.skeleton} style={{ height: 196 }} aria-busy="true" aria-label="Loading communities" />}
            {list && !list.length && (
              <div className={exploreStyles.empty}>
                <span className={exploreStyles.emptyMark}><UsersRound size={26} aria-hidden="true" /></span>
                <h3 className={exploreStyles.emptyTitle}>{query.trim() ? "No community matches that" : "No communities yet"}</h3>
                <p className={exploreStyles.emptyText}>{query.trim() ? "Try a shorter word." : "FITX opens communities here. Check back soon."}</p>
              </div>
            )}
            {list && list.length > 0 && (
              <ul className={styles.grid} aria-label="Communities">
                {list.map((community, index) => (
                  <li key={community.id}>
                    <Reveal y={14} delay={Math.min(index, 6) * 0.04}><CommunityCard community={community} /></Reveal>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CommunityCard({ community }: { community: Community }) {
  return (
    <Link href={`/explore/c/${community.slug}`} className={styles.card}>
      {community.cover_path ? (
        <span className={styles.cardCover} aria-hidden="true"><SocialPhoto path={community.cover_path} alt="" ratio={16 / 9} /></span>
      ) : (
        <>
          <span className={styles.glow} aria-hidden="true" />
          <span className={styles.monogram} aria-hidden="true">{community.name.trim().charAt(0).toUpperCase()}</span>
        </>
      )}
      <span className={styles.cardShade} aria-hidden="true" />
      <span className={styles.cardBody}>
        <span className={styles.cardMeta}>
          {community.visibility === "private" && <span className={styles.pill}><Lock size={11} aria-hidden="true" />Private</span>}
          {community.my_status === "accepted" && <span className={`${styles.pill} ${styles.pillOn}`}>Joined</span>}
          {community.my_status === "pending" && <span className={styles.pill}>Requested</span>}
          <span>{memberCountText(community.member_count)}</span>
        </span>
        <span className={styles.cardName}>{community.name}</span>
        {community.description && <span className={styles.cardText}>{community.description}</span>}
      </span>
    </Link>
  );
}
