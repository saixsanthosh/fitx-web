"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Ban, Flag, Loader2, Lock, MoreHorizontal, SendHorizontal, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/Sheet";
import { fullDate, postCoverPath, socialApi, toSocialError } from "@/lib/social";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import {
  draftState, groupByDay, linkParts, mergeNewest, messageErrorText, messagesApi, type ConversationPage, type DirectMessage,
} from "@/lib/social/messages";
import { refreshUnreadCounts, useInboxRefresh } from "@/lib/social/realtime";
import { AgeNotice } from "../AgeNotice";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { ReportSheet } from "../ReportSheet";
import { useFocusAfterRender } from "../useFocusAfterRender";
import { SocialPhoto } from "../SocialPhoto";
import styles from "./Messages.module.css";
import exploreStyles from "../Explore.module.css";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const unsentId = (id: string) => `message-${id}-unsent`;

/** /explore/messages/[id]: one conversation, the request banner, the composer, unsend and report. */
export function ConversationView({ id }: { id: string }) {
  const { db, userId, me } = useReadyExplore();
  const router = useRouter();
  const [head, setHead] = useState<ConversationPage["conversation"] | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<"idle" | "busy" | "done">("idle");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<DirectMessage | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const focusAfter = useFocusAfterRender();
  const adult = me.age_band === undefined || me.age_band === "adult";

  const load = useCallback(async () => {
    try {
      const page = await messagesApi.messages(db, id);
      setHead(page.conversation);
      setMessages((current) => mergeNewest(current, page.messages));
      setState("ready");
      if (page.messages.length < GROUP_LIMITS.messagesPage) setOlder((value) => (value === "busy" ? value : "done"));
      const latest = page.messages[0];
      if (latest && !latest.mine) {
        await messagesApi.markRead(db, id).catch(() => undefined);
        refreshUnreadCounts();
      }
    } catch (failure) {
      const key = toSocialError(failure).key;
      if (key === "social_not_found") setState("missing");
      else {
        setError(messageErrorText(failure));
        setState((current) => (current === "ready" ? current : "error"));
      }
    }
  }, [db, id]);

  useEffect(() => {
    if (!adult) return;
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [adult, load]);
  useInboxRefresh(adult ? userId : null, (ping) => { if (!ping || ping.id === id || ping.kind === "notification") void load(); });

  // Keep the newest message in view while the member is at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const last = messages[messages.length - 1];
    if (!last || older !== "idle") return;
    setOlder("busy");
    stick.current = false;
    const element = scroller.current;
    const before = element ? element.scrollHeight - element.scrollTop : 0;
    try {
      const page = await messagesApi.messages(db, id, { at: last.created_at, id: last.id });
      setMessages((current) => mergeNewest(current, page.messages));
      setOlder(page.messages.length < GROUP_LIMITS.messagesPage ? "done" : "idle");
      requestAnimationFrame(() => { if (element) element.scrollTop = element.scrollHeight - before; });
    } catch (failure) {
      toast.error(messageErrorText(failure));
      setOlder("idle");
    }
  }

  async function send() {
    const text = body.trim();
    if (!head || !draftState(text).ok || sending) return;
    setSending(true);
    stick.current = true;
    try {
      const result = await messagesApi.send(db, head.other.id, text);
      setBody("");
      setMessages((current) => mergeNewest(current, [result.message]));
      if (result.status !== head.status) setHead({ ...head, status: result.status });
    } catch (failure) {
      toast.error(messageErrorText(failure));
    } finally {
      setSending(false);
    }
  }

  async function answer(accept: boolean) {
    if (answering) return;
    setAnswering(true);
    try {
      await messagesApi.answer(db, id, accept);
      refreshUnreadCounts();
      if (accept) {
        toast.success("Request accepted");
        await load();
        // The request's buttons go: focus the message box that replaces them.
        focusAfter("conversation-message", () => document.getElementById("conversation-back"));
      } else {
        toast.success("Request deleted");
        router.push("/explore/messages?box=requests");
      }
    } catch (failure) {
      toast.error(messageErrorText(failure));
    } finally {
      setAnswering(false);
    }
  }

  async function block() {
    if (!head) return;
    try {
      await socialApi.setBlock(db, head.other.id, true);
      toast.success(`@${head.other.username} is blocked`);
      refreshUnreadCounts();
      router.push("/explore/messages");
    } catch (failure) {
      toast.error(toSocialError(failure).message);
    }
  }

  async function unsend(message: DirectMessage) {
    setActing(null);
    try {
      await messagesApi.unsend(db, message.id);
      setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, body: "", unsent: true, post: null, story: null, post_unavailable: false } : m)));
      // Its options button goes with the message: focus its "You unsent a message" in its place (the log announces it),
      // never the page body (bug 82).
      focusAfter(unsentId(message.id));
    } catch (failure) {
      toast.error(messageErrorText(failure));
    }
  }

  if (!adult) {
    return (
      <div className={styles.page}>
        <AgeNotice band={me.age_band} feature="Messaging" />
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className={styles.page}>
        <div className={exploreStyles.empty}>
          <h1 className={exploreStyles.emptyTitle}>Conversation not available</h1>
          <p className={exploreStyles.emptyText}>It may have been deleted, or one of you blocked the other.</p>
          <Link href="/explore/messages" className="fitx-button fitx-button-secondary">Back to messages</Link>
        </div>
      </div>
    );
  }
  if (state === "error" || (state === "loading" && !head)) {
    return (
      <div className={styles.page}>
        {state === "error" ? (
          <div className={exploreStyles.empty} role="alert">
            <p className={exploreStyles.emptyText}>{error}</p>
            <button type="button" className="fitx-button fitx-button-secondary" onClick={() => void load()}>Try again</button>
          </div>
        ) : <div className={exploreStyles.skeleton} style={{ height: 480 }} aria-busy="true" aria-label="Loading conversation" />}
      </div>
    );
  }
  if (!head) return null;

  const incomingRequest = head.status === "request" && !head.requested_by_me;
  const waiting = head.status === "request" && head.requested_by_me;
  const draft = draftState(body);
  const days = groupByDay(messages);

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Conversation with {head.other.display_name}</h1>
      <section className={styles.thread} aria-label={`Conversation with @${head.other.username}`}>
        <header className={styles.threadHead}>
          <Link id="conversation-back" href="/explore/messages" className={exploreStyles.iconButton} aria-label="Back to messages"><ArrowLeft size={20} aria-hidden="true" /></Link>
          <Link href={`/explore/u/${head.other.username}`} className={styles.threadWho}>
            <Avatar user={head.other} size={40} />
            <span className="flex min-w-0 flex-col">
              <span className={styles.threadName}>{head.other.display_name}</span>
              <span className={styles.threadUser}>@{head.other.username}</span>
            </span>
          </Link>
          <button type="button" className={exploreStyles.iconButton} aria-label={`Block @${head.other.username}`} onClick={() => setBlocking(true)}>
            <Ban size={19} aria-hidden="true" />
          </button>
        </header>

        <div
          ref={scroller}
          className={styles.scroll}
          role="log"
          aria-label="Messages"
          aria-live="polite"
          onScroll={(event) => {
            const element = event.currentTarget;
            stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
        >
          {/* The button stays (aria-disabled) while it loads, so keyboard focus stays on it instead of falling to the page. */}
          {older !== "done" && messages.length >= GROUP_LIMITS.messagesPage && (
            <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet} self-center`} aria-disabled={older === "busy" || undefined} onClick={() => void loadOlder()}>
              {older === "busy" ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading earlier messages</> : "Show earlier messages"}
            </button>
          )}
          {days.map((day) => (
            <div key={day.day} className="flex flex-col gap-1">
              <p className={styles.dayLabel}>{day.label}</p>
              {day.items.map((message) => (
                <Bubble
                  key={message.id}
                  message={message}
                  plainLinks={incomingRequest}
                  onActions={() => setActing(message)}
                />
              ))}
            </div>
          ))}
        </div>

        {incomingRequest && (
          <div className={styles.banner} role="region" aria-label="Message request">
            <p className={styles.bannerTitle}>Message request</p>
            <p className={styles.bannerText}>
              @{head.other.username} would like to message you. Links stay as plain text until you accept. Delete the request and nothing more comes from them.
            </p>
            <div className={styles.bannerActions}>
              <button type="button" className={exploreStyles.smallButton} aria-disabled={answering || undefined} onClick={() => void answer(true)}>Accept</button>
              <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} aria-disabled={answering || undefined} onClick={() => void answer(false)}>Delete request</button>
            </div>
          </div>
        )}
        {waiting && (
          <div className={styles.banner} role="status">
            <p className={styles.bannerText}>Your message request is waiting. You can write more once @{head.other.username} accepts.</p>
          </div>
        )}
        {head.dm_paused && (
          <div className={styles.banner} role="status"><p className={styles.bannerText}>FITX has paused your messages for now.</p></div>
        )}
        {head.can_send && !incomingRequest && (
          <form className="flex flex-col" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className={styles.composer}>
              <textarea
                id="conversation-message"
                className={styles.input}
                aria-label="Message"
                placeholder="Message"
                rows={1}
                value={body}
                maxLength={GROUP_LIMITS.messageChars + 50}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
              />
              <button type="submit" className={styles.send} aria-label="Send" disabled={!draft.ok || sending}>
                {sending ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <SendHorizontal size={18} aria-hidden="true" />}
              </button>
            </div>
            {draft.over > 0 && <p className={styles.over}>{draft.over.toLocaleString("en-GB")} characters over the limit.</p>}
          </form>
        )}
      </section>
      <p className={styles.privacy}><Lock size={12} aria-hidden="true" className="mr-1 inline" />Private between you two, but not end-to-end encrypted. A message you report is shared with FITX&rsquo;s moderators.</p>

      <Sheet open={acting !== null} onClose={() => setActing(null)} title={acting?.mine ? "Your message" : "Message"}>
        {acting && (
          <div className={exploreStyles.menu}>
            <p className={`${exploreStyles.note} px-3 pb-2`}>Sent {fullDate(acting.created_at)}</p>
            {acting.mine && !acting.unsent && (
              <button type="button" className={`${exploreStyles.menuItem} ${exploreStyles.menuDanger}`} onClick={() => void unsend(acting)}>
                <Undo2 size={18} aria-hidden="true" />Unsend
              </button>
            )}
            {!acting.mine && !acting.unsent && (
              <button type="button" className={exploreStyles.menuItem} onClick={() => { setReporting(acting.id); setActing(null); }}>
                <Flag size={18} aria-hidden="true" />Report message
              </button>
            )}
          </div>
        )}
      </Sheet>
      <Sheet
        open={blocking}
        onClose={() => setBlocking(false)}
        title={`Block @${head.other.username}?`}
        description="They cannot message you, see your posts or find your profile. They are not told."
        footer={
          <div className="flex gap-2">
            <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={() => setBlocking(false)}>Cancel</button>
            <button type="button" className="fitx-button fitx-button-danger flex-1" onClick={() => { setBlocking(false); void block(); }}>Block</button>
          </div>
        }
      >
        <span />
      </Sheet>
      <ReportSheet db={db} target={reporting ? { type: "message", id: reporting } : null} onClose={() => setReporting(null)} />
    </div>
  );
}

function Bubble({ message, plainLinks, onActions }: { message: DirectMessage; plainLinks: boolean; onActions: () => void }) {
  const side = message.mine ? styles.mine : styles.theirs;
  const time = <time className={styles.stamp} dateTime={message.created_at} title={fullDate(message.created_at)}>{timeOf(message.created_at)}</time>;
  if (message.unsent) {
    return (
      <div className={`${styles.message} ${side}`}>
        {/* Focusable from script only: where focus lands after Unsend, in the message's own place. */}
        <p id={unsentId(message.id)} tabIndex={-1} className={`${styles.bubble} ${styles.unsent}`}>{message.mine ? "You unsent a message" : "Message unsent"}</p>
        {time}
      </div>
    );
  }
  return (
    <div className={`${styles.message} ${side}`}>
      {message.story && (
        <span className={styles.storyTag}>{message.mine ? "You replied to their story" : "Replied to your story"}{message.story.available ? "" : " · story ended"}</span>
      )}
      <div className={styles.bubbleRow}>
        <div className={styles.content}>
          {message.post && <SharedPost post={message.post} />}
          {message.post_unavailable && <p className={styles.gone}>This post is no longer available.</p>}
          {message.body && (
            <p className={styles.bubble}>
              {linkParts(message.body).map((part, index) => part.href && !plainLinks
                ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc">{part.text}</a>
                : <span key={index}>{part.text}</span>)}
            </p>
          )}
        </div>
        <button
          type="button"
          className={styles.more}
          onClick={onActions}
          aria-haspopup="dialog"
          aria-label={`Options for ${message.mine ? "your message" : "this message"}${message.body ? `: ${message.body.slice(0, 60)}` : message.post || message.post_unavailable ? ": a shared post" : ""}`}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </div>
      {time}
    </div>
  );
}

function SharedPost({ post }: { post: NonNullable<DirectMessage["post"]> }) {
  const cover = postCoverPath(post);
  return (
    <Link href={`/explore/p/${post.id}`} className={styles.shared} aria-label={`Post by @${post.author.username}${post.caption ? `: ${post.caption.slice(0, 80)}` : ""}`}>
      <span className={styles.sharedHead}><Avatar user={post.author} size={24} />@{post.author.username}</span>
      {cover ? <SocialPhoto path={cover} alt="" ratio={1} /> : <span className={styles.sharedText}>{post.caption}</span>}
      {cover && post.caption && <span className={styles.sharedCaption}>{post.caption}</span>}
    </Link>
  );
}
