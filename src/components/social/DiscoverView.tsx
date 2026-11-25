"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Hash, Heart, Loader2, Search, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EXPLORE_MEDIA, type ExploreMediaId } from "@/data/explore-media";
import { compactCount, isTopic, matchTopics, nextCursor, socialApi, topicLabel, TOPICS, type Cursor, type SearchResult, type SocialPost } from "@/lib/social";
import { DISCOVER_VIDEOS } from "@/lib/social/slots";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { PostGrid, TileCover, tileLabel } from "./PostGrid";
import { Suggestions } from "./Suggestions";
import { useAsync } from "./useAsync";
import { usePaged, useSentinel } from "./usePaged";
import styles from "./Explore.module.css";

const TOPIC_PHOTO: Record<string, ExploreMediaId | null> = {
  bodybuilding: "bodybuilding", weight_loss: "weight-loss", muscle_gain: "muscle-gain", home_workouts: "home-workouts",
  gym_workouts: "gym-workouts", nutrition: "nutrition", motivation: null,
};

/** Discover: search, the seven topics, trending posts from real engagement, people to follow and the latest posts. */
export function DiscoverView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tag = (params.get("tag") ?? "").replace(/^#/, "").toLowerCase().slice(0, 50) || null;
  const rawTopic = params.get("topic");
  const topic = isTopic(rawTopic) ? rawTopic : null;
  const [query, setQuery] = useState(params.get("q") ?? "");

  const setFilter = (next: { topic?: string | null; tag?: string | null }) => {
    const search = new URLSearchParams();
    if (next.topic) search.set("topic", next.topic);
    if (next.tag) search.set("tag", next.tag);
    router.replace(`${pathname}${search.size ? `?${search}` : ""}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="Discover" />
      <div className="flex flex-col gap-8">
        <SearchBox query={query} onQuery={setQuery} onPickTopic={(key) => { setQuery(""); setFilter({ topic: key }); }} />
        {!query.trim() && (
          <>
            <TopicTiles active={tag ? null : topic} onPick={(key) => setFilter({ topic: key === topic ? null : key })} />
            {!tag && !topic && <FitnessVideos />}
            {tag ? <TagPosts tag={tag} onClear={() => setFilter({})} /> : <Browse topic={topic} />}
          </>
        )}
      </div>
    </>
  );
}

/** "Fitness videos" (P14.3), once short videos ship: social-stories fills DISCOVER_VIDEOS; until then nothing shows. */
function FitnessVideos() {
  const Videos = DISCOVER_VIDEOS;
  return Videos ? <Videos limit={6} /> : null;
}

function SearchBox({ query, onQuery, onPickTopic }: { query: string; onQuery: (value: string) => void; onPickTopic: (key: string) => void }) {
  const { db } = useReadyExplore();
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useAsync<SearchResult | null>(() => (debounced ? socialApi.search(db, debounced) : Promise.resolve(null)), [db, debounced]);
  const topics = useMemo(() => matchTopics(debounced), [debounced]);
  const data = results.data;
  const empty = data && !data.accounts.length && !data.hashtags.length && !topics.length;
  return (
    <div className="flex flex-col gap-3">
      <div className={styles.search}>
        <Search size={18} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          role="searchbox"
          aria-label="Search Explore"
          placeholder="People, #hashtags, topics"
          className={`fitx-field ${styles.searchInput}`}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      {debounced && (
        <section className={styles.panel} aria-label="Search results" aria-busy={results.status === "loading"}>
          {results.status === "loading" && <p className={styles.note}><Loader2 size={14} className="mr-2 inline animate-spin motion-reduce:animate-none" aria-hidden="true" />Searching</p>}
          {results.status === "error" && <p className={styles.alert} role="alert">{results.error}</p>}
          {empty && <p className={styles.note} role="status">Nothing found for “{debounced}”.</p>}
          {data && (
            <ul className={styles.rowList}>
              {topics.map((key) => (
                <li key={key}>
                  <button type="button" className={`${styles.rowItem} w-full text-left`} onClick={() => onPickTopic(key)}>
                    <span className={styles.emptyMark} style={{ width: 40, height: 40, borderRadius: 12 }}><Hash size={18} aria-hidden="true" /></span>
                    <span className={styles.whoText}><span className={styles.whoName}>{topicLabel(key)}</span><span className={styles.reason}>Topic</span></span>
                  </button>
                </li>
              ))}
              {data.accounts.map((account) => (
                <li key={account.id}>
                  <Link href={`/explore/u/${account.username}`} className={styles.rowItem}>
                    <Avatar user={account} size={40} />
                    <span className={styles.whoText}><span className={styles.whoName}>{account.username}</span><span className={styles.reason}>{account.display_name}</span></span>
                  </Link>
                </li>
              ))}
              {data.hashtags.map((item) => (
                <li key={item.tag}>
                  <Link href={`/explore/discover?tag=${encodeURIComponent(item.tag)}`} className={styles.rowItem} onClick={() => onQuery("")}>
                    <span className={styles.emptyMark} style={{ width: 40, height: 40, borderRadius: 12 }}><Hash size={18} aria-hidden="true" /></span>
                    <span className={styles.whoText}><span className={styles.whoName}>#{item.tag}</span><span className={styles.reason}>{item.posts === 1 ? "1 post" : `${compactCount(item.posts)} posts`}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function TopicTiles({ active, onPick }: { active: string | null; onPick: (key: string) => void }) {
  return (
    <section aria-labelledby="topics-title">
      <h2 id="topics-title" className="sr-only">Topics</h2>
      <div className={styles.topics} role="group" aria-label="Topics">
        {TOPICS.map((topic) => {
          const photo = TOPIC_PHOTO[topic.key] ? EXPLORE_MEDIA[TOPIC_PHOTO[topic.key] as ExploreMediaId] : null;
          return (
            <button key={topic.key} type="button" aria-pressed={active === topic.key} className={`${styles.topic} ${active === topic.key ? styles.topicOn : ""}`} onClick={() => onPick(topic.key)}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- local, pre-sized stills
                <img src={photo.src} alt="" className={styles.topicImg} loading="lazy" decoding="async" width={photo.width} height={photo.height} />
              ) : (
                <span className={styles.topicWord} aria-hidden="true">Keep going</span>
              )}
              <span className={styles.topicName}>{topic.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Browse({ topic }: { topic: string | null }) {
  const { db } = useReadyExplore();
  const trending = useAsync(() => socialApi.trending(db, topic, 7, 9), [db, topic]);
  return (
    <>
      <section aria-labelledby="trending-title">
        <div className={styles.sectionHead}>
          <h2 id="trending-title" className={styles.sectionTitle}>{topic ? `Trending in ${topicLabel(topic).toLowerCase()}` : "Trending this week"}</h2>
        </div>
        {trending.status === "loading" && <div className={styles.skeleton} style={{ height: 280 }} aria-hidden="true" />}
        {trending.status === "error" && <p className={styles.alert} role="alert">{trending.error}</p>}
        {trending.status === "ready" && !trending.data?.length && (
          <p className={styles.note}>Nothing is trending yet. Posts that members like, comment on and save this week show here.</p>
        )}
        {!!trending.data?.length && (
          <ul className={styles.trendGrid} aria-label="Trending posts">
            {trending.data.map((post, index) => (
              <li key={post.id} className={index === 0 ? styles.trendFirst : ""}>
                <Link href={`/explore/p/${post.id}`} className={styles.trend} aria-label={tileLabel(post)}>
                  <TileCover post={post} priority={index < 3} />
                  <span className={styles.trendMeta} aria-hidden="true">
                    <Avatar user={post.author} size={22} />
                    <span className="truncate">{post.author.username}</span>
                    <span className={`${styles.trendRank} inline-flex items-center gap-1`}><Heart size={13} fill="currentColor" />{compactCount(post.like_count)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!topic && <Suggestions db={db} layout="row" />}
      <Latest filter={topic ? { topic } : {}} title={topic ? `Latest in ${topicLabel(topic).toLowerCase()}` : "Latest posts"} />
    </>
  );
}

function TagPosts({ tag, onClear }: { tag: string; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={styles.emptyMark}><Hash size={24} aria-hidden="true" /></span>
        <h2 className={styles.sectionTitle}>#{tag}</h2>
        <button type="button" className={styles.iconButton} aria-label="Clear hashtag" onClick={onClear}><X size={18} aria-hidden="true" /></button>
      </div>
      <Latest filter={{ tag }} title={`Posts with #${tag}`} hideTitle />
    </div>
  );
}

const LATEST_PAGE = 18;

function Latest({ filter, title, hideTitle = false }: { filter: { topic?: string; tag?: string }; title: string; hideTitle?: boolean }) {
  const { db } = useReadyExplore();
  const key = `latest:${filter.topic ?? ""}:${filter.tag ?? ""}`;
  const latest = usePaged<SocialPost, NonNullable<Cursor>>(key, async (cursor) => {
    const items = await socialApi.browse(db, filter, cursor, LATEST_PAGE);
    return { items, next: nextCursor(items, LATEST_PAGE) };
  });
  const sentinel = useSentinel(latest.more, !latest.done && latest.status === "ready");
  return (
    <section aria-label={title}>
      {!hideTitle && <div className={styles.sectionHead}><h2 className={styles.sectionTitle}>{title}</h2></div>}
      {latest.status === "loading" && <div className={styles.skeleton} style={{ height: 240 }} aria-hidden="true" />}
      {latest.status === "error" && !latest.items.length && <p className={styles.alert} role="alert">{latest.error}</p>}
      {latest.status !== "loading" && !latest.items.length && latest.status !== "error" && <p className={styles.note}>No posts here yet.</p>}
      {latest.items.length > 0 && <PostGrid posts={latest.items} label={title} />}
      {latest.items.length > 0 && !latest.done && (
        <div className="mt-4 flex justify-center">
          <button type="button" className={`${styles.smallButton} ${styles.smallButtonQuiet}`} onClick={latest.more} aria-disabled={latest.status === "more" || undefined}>Show more</button>
        </div>
      )}
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
    </section>
  );
}
