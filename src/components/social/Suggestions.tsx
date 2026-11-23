"use client";

import Link from "next/link";
import { socialApi, topicLabel, type Suggestion } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { useAsync } from "./useAsync";
import styles from "./Explore.module.css";

/** Why an account is suggested, from real data only. */
export function suggestionReason(item: Suggestion): string {
  if (item.reason === "followed_by" && item.mutual_username) {
    return item.mutual_count > 1 ? `Followed by @${item.mutual_username} and ${item.mutual_count - 1} more` : `Followed by @${item.mutual_username}`;
  }
  if (item.reason === "topic" && item.topic) return `Posts about ${topicLabel(item.topic).toLowerCase()}`;
  if (item.reason === "popular") return "Liked by members this month";
  return item.posts === 1 ? "1 post" : `${item.posts} posts`;
}

/** Accounts to follow: a list in the feed's side column, or a row of cards on Discover. */
export function Suggestions({ db, layout }: { db: Db; layout: "list" | "row" }) {
  const state = useAsync(() => socialApi.suggestions(db, layout === "row" ? 12 : 6), [db, layout]);
  const items = state.data ?? [];
  if (state.status === "loading") return <div className={styles.skeleton} style={{ height: layout === "row" ? 190 : 260 }} aria-hidden="true" />;
  if (!items.length) return null;
  if (layout === "list") {
    return (
      <section className={styles.panel} aria-labelledby="suggested-title">
        <h2 id="suggested-title" className={styles.panelTitle}>Suggested for you</h2>
        <ul className={styles.rowList}>
          {items.map((item) => (
            <li key={item.user.id} className={styles.rowItem}>
              <Link href={`/explore/u/${item.user.username}`} className={`${styles.who} min-w-0`}>
                <Avatar user={item.user} size={40} />
                <span className={styles.whoText}>
                  <span className={styles.whoName}>{item.user.username}</span>
                  <span className={styles.reason}>{suggestionReason(item)}</span>
                </span>
              </Link>
              <FollowButton db={db} userId={item.user.id} username={item.user.username} state="none" compact />
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section aria-labelledby="suggested-row-title">
      <div className={styles.sectionHead}><h2 id="suggested-row-title" className={styles.sectionTitle}>People to follow</h2></div>
      <ul className={styles.suggestRow}>
        {items.map((item) => (
          <li key={item.user.id} className={styles.suggest}>
            <Link href={`/explore/u/${item.user.username}`} className="flex flex-col items-center gap-2" aria-label={`${item.user.display_name}, @${item.user.username}`}>
              <Avatar user={item.user} size={64} />
              <span className={styles.suggestName}>{item.user.display_name}</span>
            </Link>
            <span className={styles.reason}>{suggestionReason(item)}</span>
            <FollowButton db={db} userId={item.user.id} username={item.user.username} state="none" compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
