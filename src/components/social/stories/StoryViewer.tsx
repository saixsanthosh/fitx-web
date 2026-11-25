"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Flag, Heart, Pause, Play, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/Sheet";
import { SOCIAL_BUCKET, relativeTime, socialApi, toSocialError, type SocialAuthor, type SocialStory } from "@/lib/social";
import { forgetPhotoUrls } from "@/lib/social/media-urls";
import { carryOver, noticeMs } from "@/lib/social/notice";
import { STORY_REPLY } from "@/lib/social/slots";
import { firstUnseen, isTextEntry, seenByLabel, stepStory, storyPlayMs, timeLeft, viewerOrder, type StoryCursor } from "@/lib/social/stories";
import { exploreTabTitle, storyTitle } from "@/lib/social/titles";
import { videoLink } from "@/lib/social/video/links";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { ReportSheet } from "../ReportSheet";
import { useNotice } from "../useNotice";
import { usePhotoUrl } from "../usePhotoUrl";
import exploreStyles from "../Explore.module.css";
import { currentTray, takeOpenedInApp, trayChanged, traySeen } from "./trayStore";
import styles from "./Stories.module.css";

type Account = { author: SocialAuthor; stories: SocialStory[] | null };

/**
 * The story viewer (`dialog "Story by <username>"`, wave-2 brief 3.9): one account's live stories, then the next
 * accounts in the tray. Photos show for 5 s and videos for their length; tap or press the right side (or →) for the
 * next, the left side (or ←) for the previous, hold to pause. The owner sees "Seen by <n>", who viewed, time left and
 * Delete; others can like, report and (when social-groups ships it) reply. The viewer is a modal dialog, so what the
 * member just did ("Reply sent", a refused reply, a failed like, "Story deleted", "Report sent") is said inside it, above
 * the reply box: a toast would be drawn under the dialog, unseen and unheard (D6, bug 18). A message it closes on
 * before it could be read is said again by the page, as a toast, once the viewer has gone.
 */
export function StoryViewer({ username }: { username: string }) {
  const { db, userId } = useReadyExplore();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [fromApp] = useState(() => takeOpenedInApp());
  const order = useMemo(() => viewerOrder(currentTray(), username), [username]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [at, setAt] = useState<StoryCursor | null>(null);
  const [holding, setHolding] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<"viewers" | "delete" | "report" | null>(null);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  /** The story whose reply box has focus or a draft: that story holds still until the reply is sent or left. */
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const viewed = useRef(new Set<string>());
  const { notice, show, clear, latest } = useNotice();
  const deleteNotice = useNotice();
  const [deleting, setDeleting] = useState(false);

  // Each message stays a few seconds (errors a little longer), then the story is clear again.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clear, noticeMs(notice));
    return () => window.clearTimeout(timer);
  }, [notice, clear]);
  // Closing on a message that had no time to be read: the page says it once the viewer has gone. A passive cleanup
  // runs after the layout cleanup that closes the dialog, so the toast is neither under the dialog nor inert.
  useEffect(() => () => {
    const pending = carryOver(latest.current, Date.now());
    if (!pending) return;
    if (pending.tone === "error") toast.error(pending.text);
    else if (pending.tone === "success") toast.success(pending.text);
    else toast.message(pending.text);
  }, [latest]);

  const close = useCallback(() => {
    if (fromApp) router.back();
    else router.replace("/explore");
  }, [fromApp, router]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      // Focus the viewer itself (not its first button), so arrow keys work at once and no control looks pressed.
      element.focus();
    }
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const cancel = (event: Event) => { event.preventDefault(); close(); };
    element.addEventListener("cancel", cancel);
    return () => element.removeEventListener("cancel", cancel);
  }, [close]);

  // Load the accounts in order: the first at once, the rest as the viewer reaches them.
  const loadAccount = useCallback(async (name: string): Promise<Account | null> => {
    const known = currentTray()?.find((entry) => entry.user.username === name)?.user;
    const author = known ?? (await socialApi.profile(db, name))?.profile ?? null;
    if (!author) return null;
    const stories = await socialApi.stories(db, author.id);
    return { author: { ...author, is_private: author.is_private ?? false }, stories };
  }, [db]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const first = await loadAccount(order[0]);
        if (!live) return;
        if (!first) { setFailed("not_found"); return; }
        const rest: Account[] = order.slice(1).map((name) => {
          const entry = currentTray()?.find((item) => item.user.username === name);
          return { author: entry?.user ?? { id: "", username: name, display_name: name, avatar_path: null, is_private: false }, stories: null };
        });
        setAccounts([first, ...rest]);
        setAt(first.stories?.length ? { user: 0, story: firstUnseen(first.stories) } : null);
      } catch (error) {
        if (live) setFailed(toSocialError(error).message);
      }
    })();
    return () => { live = false; };
  }, [loadAccount, order]);

  const counts = accounts.map((account) => (account.stories === null ? 1 : account.stories.length));
  const account = at ? accounts[at.user] : accounts[0];
  const story = at && account?.stories ? account.stories[at.story] ?? null : null;

  // Reaching an account not loaded yet: load it, then start at its first unseen story (or skip it when it has none).
  useEffect(() => {
    if (!at || !account || account.stories !== null) return;
    let live = true;
    void loadAccount(account.author.username).then((loaded) => {
      if (!live) return;
      const stories = loaded?.stories ?? [];
      setAccounts((list) => list.map((item, index) => (index === at.user ? { author: loaded?.author ?? item.author, stories } : item)));
      if (!stories.length) {
        const next = stepStory(accounts.map((item, index) => (index === at.user ? 0 : item.stories === null ? 1 : item.stories.length)), { user: at.user, story: 0 }, 1);
        if (next) setAt(next); else close();
      } else {
        setAt({ user: at.user, story: firstUnseen(stories) });
      }
    }).catch(() => { if (live) close(); });
    return () => { live = false; };
  }, [account, accounts, at, close, loadAccount]);

  const go = useCallback((dir: 1 | -1) => {
    if (!at) return;
    const next = stepStory(counts, at, dir);
    // Back from the very first story stays on it: nothing changes, so the story keeps playing (its media stays ready).
    if (next && next.user === at.user && next.story === at.story) return;
    setReady(false);
    if (account && account.author.id && (next === null || next.user !== at.user) && dir === 1) traySeen(account.author.id);
    if (!next) { close(); return; }
    setAt(next);
  }, [account, at, close, counts]);

  // Record the view once, for someone else's story.
  useEffect(() => {
    if (!story || story.mine || story.seen || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    socialApi.viewStory(db, story.id).catch((error) => {
      if (toSocialError(error).key === "social_story_expired") show("info", "That story has ended.");
    });
  }, [db, show, story]);

  const replying = story !== null && replyingTo === story.id;
  const stopped = paused || holding || sheet !== null || !ready || replying;
  const Reply = STORY_REPLY;

  const replaceStory = (next: SocialStory) => setAccounts((list) => list.map((item, index) => (
    at && index === at.user && item.stories ? { ...item, stories: item.stories.map((old) => (old.id === next.id ? next : old)) } : item)));

  async function toggleLike() {
    if (!story) return;
    const before = story;
    replaceStory({ ...story, liked: !story.liked });
    try {
      const result = await socialApi.setStoryLike(db, story.id, !before.liked);
      replaceStory({ ...before, liked: result.liked });
    } catch (error) {
      // The heart goes back, and the viewer says why (it used to turn off without a word).
      replaceStory(before);
      show("error", toSocialError(error).message);
    }
  }

  async function remove() {
    if (!story || !at || deleting) return;
    setDeleting(true);
    deleteNotice.clear();
    try {
      const paths = await socialApi.deleteStory(db, story.id);
      const storage = createClient()?.storage;
      if (storage && paths.length) await storage.from(SOCIAL_BUCKET).remove(paths);
      forgetPhotoUrls(paths);
      trayChanged(db);
      setSheet(null);
      show("success", "Story deleted");
      const left = (account?.stories ?? []).filter((item) => item.id !== story.id);
      setAccounts((list) => list.map((item, index) => (index === at.user ? { ...item, stories: left } : item)));
      if (!left.length) close();
      else setAt({ user: at.user, story: Math.min(at.story, left.length - 1) });
    } catch (error) {
      // Said inside the open "Delete this story?" sheet.
      deleteNotice.show("error", toSocialError(error).message);
    } finally {
      setDeleting(false);
    }
  }
  const closeSheet = () => { setSheet(null); deleteNotice.clear(); };

  const name = account?.author.username ?? username;
  // Moving on to another account is not a navigation, so the address and the page's title would both keep naming the
  // account the viewer opened on: they follow the account on screen instead (also when an account with nothing left
  // is skipped). The next page's own title replaces this one as usual (React updates or replaces that element).
  const shownName = useRef(username);
  useEffect(() => {
    if (shownName.current === name) return;
    shownName.current = name;
    window.history.replaceState(window.history.state, "", `/explore/stories/${encodeURIComponent(name)}`);
    document.title = exploreTabTitle(storyTitle(name));
  }, [name]);
  return (
    <dialog ref={dialog} className={styles.viewer} aria-label={`Story by ${name}`} tabIndex={-1} onKeyDown={(event) => {
      // The arrows move the caret in the reply box (and any other field), never the story.
      if (sheet || isTextEntry(event.target)) return;
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    }}>
      <div className={styles.viewerInner}>
        <div className={styles.frame}>
          {story ? (
            <StoryMedia key={story.id} story={story} viewerId={userId} muted={muted} stopped={stopped} onReady={() => setReady(true)} onEnd={() => go(1)} onMissing={() => setReady(true)} />
          ) : null}
          {story && <span className={styles.mediaShade} aria-hidden="true" />}

          {story && account?.stories && (
            <div className={styles.bars} aria-hidden="true">
              {account.stories.map((item, index) => (
                <span key={item.id} className={styles.bar}>
                  <span className={`${styles.barFill} ${index < (at?.story ?? 0) ? styles.barDone : ""}`} data-bar={index === at?.story ? "current" : undefined} />
                </span>
              ))}
            </div>
          )}

          <div className={styles.head}>
            {account && (
              <Link href={`/explore/u/${account.author.username}`} className={styles.headWho}>
                <Avatar user={{ display_name: account.author.display_name, avatar_path: account.author.avatar_path }} size={36} />
                <span className={styles.headText}>
                  <span className={styles.headName}>{account.author.username}</span>
                  {story && (
                    <span className={styles.headMeta}>
                      <time dateTime={story.created_at}>{relativeTime(story.created_at)}</time>
                      {story.mine && <> · {timeLeft(story.expires_at)}</>}
                    </span>
                  )}
                </span>
              </Link>
            )}
            {story?.kind === "video" && (
              <button type="button" className={styles.stageButton} aria-label="Sound" aria-pressed={!muted} onClick={() => setMuted((value) => !value)}>
                {muted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
              </button>
            )}
            {story && (
              <button type="button" className={styles.stageButton} aria-label={paused ? "Play story" : "Pause story"} onClick={() => setPaused((value) => !value)}>
                {paused ? <Play size={20} aria-hidden="true" /> : <Pause size={20} aria-hidden="true" />}
              </button>
            )}
            <button type="button" className={`${styles.stageButton} ${styles.closeInFrame}`} aria-label="Close story" onClick={close}><X size={22} aria-hidden="true" /></button>
          </div>

          {story && story.moderation && (
            <p className={styles.modNote} role="note">
              {story.moderation === "hidden" ? "Hidden by FITX. Only you can see this story." : "Limited by FITX. Only your followers can see this story."}
            </p>
          )}

          {story ? (
            <Zones onPrev={() => go(-1)} onNext={() => go(1)} onHold={setHolding} />
          ) : (
            <div className={styles.centerNote}>
              {failed || (accounts.length && !accounts[0].stories?.length) ? (
                <>
                  <h2 className={styles.centerTitle}>{failed === "not_found" ? "Story not available" : failed ? "Stories did not load" : "No stories right now"}</h2>
                  <p className={styles.centerText}>{failed && failed !== "not_found" ? failed : "Stories last 24 hours. This one has ended or is not shared with you."}</p>
                  <button type="button" className={styles.lightButton} onClick={close}>Close</button>
                </>
              ) : (
                <p className="sr-only" role="status">Loading the story</p>
              )}
            </div>
          )}

          {story?.caption && <p className={styles.caption}>{story.caption}</p>}

          {/* What the member just did, inside the viewer (D6): confirmations politely, each failure as a new alert. */}
          <div className={styles.notices}>
            <p role="status" className={notice && notice.tone !== "error" ? styles.notice : "sr-only"}>{notice && notice.tone !== "error" ? notice.text : null}</p>
            {notice?.tone === "error" && <p key={notice.id} role="alert" className={`${styles.notice} ${styles.noticeError}`}>{notice.text}</p>}
          </div>

          {story && (
            <div className={styles.foot}>
              {story.mine ? (
                <>
                  {seenByLabel(story.view_count) && (
                    <button type="button" className={styles.pill} onClick={() => setSheet("viewers")}>
                      <Eye size={17} aria-hidden="true" />{seenByLabel(story.view_count)}
                    </button>
                  )}
                  <span className={styles.footGap} />
                  <button type="button" className={styles.stageButton} aria-label="Delete story" onClick={() => setSheet("delete")}><Trash2 size={20} aria-hidden="true" /></button>
                </>
              ) : (
                <>
                  <span className={styles.footGap}>
                    {/* Keyed by story: a draft never carries over to another story or another account's owner. */}
                    {Reply && account && (
                      <Reply key={story.id} storyId={story.id} ownerId={account.author.id} ownerName={account.author.username}
                        onActiveChange={(active) => setReplyingTo((current) => (active ? story.id : current === story.id ? null : current))}
                        onFailed={(text) => show("error", text)}
                        onSent={() => {
                          show("success", "Reply sent");
                          // Back to the viewer: the story plays on and the arrow keys move it again.
                          setReplyingTo(null);
                          dialog.current?.focus();
                        }} />
                    )}
                  </span>
                  <button type="button" className={styles.stageButton} aria-label="Like story" aria-pressed={story.liked} onClick={() => void toggleLike()}>
                    <Heart size={22} aria-hidden="true" fill={story.liked ? "currentColor" : "none"} />
                  </button>
                  <button type="button" className={styles.stageButton} aria-label="Report story" onClick={() => setSheet("report")}><Flag size={19} aria-hidden="true" /></button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Mouse affordances beside the frame on wide screens; the frame's own tap zones are the named controls. */}
        <span className={`${styles.side} ${styles.sidePrev}`} aria-hidden="true">
          <button type="button" className={`${styles.stageButton} ${styles.sideButton}`} tabIndex={-1} onClick={() => go(-1)}><ChevronLeft size={22} aria-hidden="true" /></button>
        </span>
        <span className={`${styles.side} ${styles.sideNext}`} aria-hidden="true">
          <button type="button" className={`${styles.stageButton} ${styles.sideButton}`} tabIndex={-1} onClick={() => go(1)}><ChevronRight size={22} aria-hidden="true" /></button>
        </span>
        <button type="button" className={`${styles.stageButton} ${styles.closeCorner}`} aria-label="Close story" tabIndex={-1} onClick={close}><X size={24} aria-hidden="true" /></button>
      </div>

      {story?.mine && (
        <Viewers open={sheet === "viewers"} storyId={story.id} label={seenByLabel(story.view_count) ?? "Seen by"} onClose={() => setSheet(null)} />
      )}
      <Sheet
        open={sheet === "delete"}
        onClose={closeSheet}
        side="center"
        title="Delete this story?"
        description="It is removed for everyone now. This cannot be undone."
        notice={deleteNotice.notice}
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={closeSheet}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger flex-1 aria-disabled:opacity-60" aria-disabled={deleting || undefined} onClick={() => void remove()}>Delete</button>
          </div>
        }
      >
        <span />
      </Sheet>
      {/* The thanks is said by the viewer: the report sheet closes, the viewer stays open over the page. */}
      <ReportSheet db={db} target={sheet === "report" && story ? { type: "story", id: story.id } : null} onClose={() => setSheet(null)} onSent={(text) => show("success", text)} />
    </dialog>
  );
}

/** The left third goes back, the rest forward; holding anywhere pauses (and the release then does not move on). */
function Zones({ onPrev, onNext, onHold }: { onPrev: () => void; onNext: () => void; onHold: (on: boolean) => void }) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const down = () => {
    held.current = false;
    timer.current = window.setTimeout(() => { held.current = true; onHold(true); }, 220);
  };
  const up = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (held.current) onHold(false);
  };
  const click = (action: () => void) => () => {
    if (held.current) { held.current = false; return; }
    action();
  };
  return (
    <div className={styles.zones} onPointerDown={down} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}>
      <button type="button" className={`${styles.zone} ${styles.zonePrev}`} aria-label="Previous story" onClick={click(onPrev)} />
      <button type="button" className={`${styles.zone} ${styles.zoneNext}`} aria-label="Next story" onClick={click(onNext)} />
    </div>
  );
}

/**
 * One story's photo or video, and its progress bar: it starts counting only once the media is on screen, stops while
 * `stopped`, and calls `onEnd` when its time is up. The bar is moved directly (no re-render per frame).
 */
function StoryMedia({ story, viewerId, muted, stopped, onReady, onEnd, onMissing }: {
  story: SocialStory; viewerId: string; muted: boolean; stopped: boolean; onReady: () => void; onEnd: () => void; onMissing: () => void;
}) {
  const photo = usePhotoUrl(story.kind === "image" ? story.path : story.poster_path);
  const [video, setVideo] = useState<string | null | undefined>(story.kind === "video" ? undefined : null);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const elapsed = useRef(0);
  const total = storyPlayMs(story);
  const end = useRef(onEnd);
  useEffect(() => { end.current = onEnd; });

  useEffect(() => {
    if (story.kind !== "video") return;
    let live = true;
    videoLink(story.path, { ownerId: story.user_id, viewerId, db: createClient() })
      .then((url) => { if (live) setVideo(url); })
      .catch((error) => { if (live) { setVideo(null); setProblem(toSocialError(error).message); } });
    return () => { live = false; };
  }, [story.kind, story.path, story.user_id, viewerId]);

  const missing = story.kind === "image" ? photo === null : video === null;
  useEffect(() => { if (missing) onMissing(); }, [missing, onMissing]);

  // The bar and the clock for photos (and for a video whose file cannot play: its poster for the same time).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-bar=current]");
    if (!shown && !missing) { if (bar) bar.style.transform = "scaleX(0)"; return; }
    if (stopped && !missing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const element = videoRef.current;
      if (story.kind === "video" && element && video) {
        const length = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : total / 1000;
        if (bar) bar.style.transform = `scaleX(${Math.min(1, element.currentTime / length)})`;
      } else {
        if (!stopped) elapsed.current += now - last;
        if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed.current / total)})`;
        if (elapsed.current >= total) { end.current(); return; }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [missing, shown, stopped, story.kind, total, video]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video) return;
    if (stopped) element.pause();
    else void element.play().catch(() => undefined);
  }, [stopped, video, shown]);

  const markShown = () => { setShown(true); onReady(); };
  const alt = story.caption ? `Story: ${story.caption}` : "Story";
  const fill = story.height >= story.width * 1.5 ? styles.mediaFill : "";
  return (
    <div className={`${styles.media} ${styles.enter}`}>
      {story.kind === "image" && photo && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private photo
        <img src={photo} alt={alt} className={`${styles.mediaImg} ${fill} ${shown ? styles.mediaReady : ""}`} onLoad={markShown} onError={onMissing} decoding="async" />
      )}
      {story.kind === "video" && video && (
        <video
          ref={videoRef}
          src={video}
          poster={photo ?? undefined}
          className={`${styles.mediaVideo} ${fill} ${shown ? styles.mediaReady : ""}`}
          playsInline
          muted={muted}
          preload="auto"
          aria-label={alt}
          onLoadedData={markShown}
          onEnded={() => end.current()}
          onError={() => { setVideo(null); }}
        />
      )}
      {story.kind === "video" && video === null && photo && (
        // eslint-disable-next-line @next/next/no-img-element -- the video's poster when the video cannot play
        <img src={photo} alt={alt} className={`${styles.mediaImg} ${styles.mediaReady}`} decoding="async" />
      )}
      {missing && (
        <p className={`${styles.centerText} absolute inset-x-6 bottom-28 text-center`} role="status">{problem ?? "This story is not available."}</p>
      )}
    </div>
  );
}

function Viewers({ open, storyId, label, onClose }: { open: boolean; storyId: string; label: string; onClose: () => void }) {
  const { db } = useReadyExplore();
  const [list, setList] = useState<{ user: SocialAuthor; viewed_at: string; liked: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    socialApi.storyViewers(db, storyId).then((rows) => { if (live) setList(rows); }).catch((failure) => { if (live) setError(toSocialError(failure).message); });
    return () => { live = false; };
  }, [db, open, storyId]);
  return (
    <Sheet open={open} onClose={onClose} title={label}>
      {error && <p className={exploreStyles.alert} role="alert">{error}</p>}
      {!error && list === null && <p className={exploreStyles.note} role="status">Loading</p>}
      {list && !list.length && <p className={exploreStyles.note}>Nobody has seen it yet.</p>}
      {list && list.length > 0 && (
        <ul className={styles.viewerList} aria-label="Viewers">
          {list.map((row) => (
            <li key={row.user.id}>
              <Link href={`/explore/u/${row.user.username}`} className={exploreStyles.rowItem}>
                <Avatar user={row.user} size={40} />
                <span className={exploreStyles.whoText}>
                  <span className={exploreStyles.whoName}>{row.user.username}</span>
                  <span className={exploreStyles.reason}>{relativeTime(row.viewed_at)}{row.liked ? " · Liked it" : ""}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
