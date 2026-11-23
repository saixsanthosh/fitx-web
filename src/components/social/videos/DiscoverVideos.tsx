"use client";

import Link from "next/link";
import { useState } from "react";
import { Play } from "lucide-react";
import { socialApi, type SocialPost } from "@/lib/social";
import type { DiscoverVideosProps } from "@/lib/social/slots";
import { createVideoPager } from "@/lib/social/video/feed";
import { clock } from "@/lib/social/video/plan";
import { useReadyExplore } from "../ExploreContext";
import { useAsync } from "../useAsync";
import { usePhotoUrl } from "../usePhotoUrl";
import exploreStyles from "../Explore.module.css";
import styles from "./Videos.module.css";

/**
 * DISCOVER_VIDEOS (P14.3, "Fitness videos"): videos members engaged with this week first (trending, from real likes,
 * comments and saves), then the newest from public accounts, as posters that open the Videos tab. Nothing shows while
 * FITX has videos paused or when there are none yet.
 */
export function DiscoverVideos({ limit }: DiscoverVideosProps) {
  const { db, me } = useReadyExplore();
  const videosOn = me.videos === true;
  const videos = useAsync<SocialPost[]>(async () => {
    if (!videosOn) return [];
    const trending = (await socialApi.trending(db, null, 7, 30)).filter((post) => post.kind === "video");
    const picked = trending.slice(0, limit);
    if (picked.length < limit) {
      const pager = createVideoPager([(cursor, size) => socialApi.browse(db, {}, cursor, size)], { readsPerCall: 2 });
      for (const post of picked) pager.skip(post.id);
      picked.push(...(await pager.next(limit - picked.length)).items);
    }
    return picked;
  }, [db, limit, videosOn]);

  if (!videosOn || !videos.data?.length) return null;
  return (
    <section aria-labelledby="fitness-videos-title">
      <div className={exploreStyles.sectionHead}>
        <h2 id="fitness-videos-title" className={exploreStyles.sectionTitle}>Fitness videos</h2>
        <Link href="/explore/videos" className={exploreStyles.linkQuiet}>See all</Link>
      </div>
      <ul className={styles.shelf} aria-label="Fitness videos">
        {videos.data.map((post) => <li key={post.id}><VideoTile post={post} /></li>)}
      </ul>
    </section>
  );
}

function VideoTile({ post }: { post: SocialPost }) {
  const item = post.media[0];
  const url = usePhotoUrl(item?.poster_path ?? null);
  const [loaded, setLoaded] = useState(false);
  const length = item?.duration_ms ? clock(item.duration_ms) : null;
  const caption = post.caption.trim().split("\n")[0].slice(0, 80);
  return (
    <Link href={`/explore/videos?v=${post.id}`} className={styles.tile} aria-label={`Video by @${post.author.username}${length ? `, ${length}` : ""}${caption ? `: ${caption}` : ""}`}>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private poster
        <img src={url} alt="" className={`${styles.tileImg} ${loaded ? styles.tileImgReady : ""}`} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
      )}
      <span className={styles.tilePlay} aria-hidden="true"><Play size={14} fill="currentColor" /></span>
      <span className={styles.tileMeta} aria-hidden="true">
        <span className={styles.tileName}>@{post.author.username}</span>
        {length && <span className={styles.tileLength}>{length}</span>}
      </span>
    </Link>
  );
}
