"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, MessageCircle, Settings2, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { Tabs } from "@/components/ui/Tabs";
import { fullDate, relativeTime, socialApi, type DmPolicy, type SocialAuthor } from "@/lib/social";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import { DM_POLICY_OPTIONS, messageErrorText, messagesApi, previewText, type ConversationSummary, type InboxBox } from "@/lib/social/messages";
import { unreadLabel, useInboxRefresh, useUnreadCounts } from "@/lib/social/realtime";
import { AgeNotice } from "../AgeNotice";
import { Avatar } from "../Avatar";
import { useReadyExplore } from "../ExploreContext";
import { NewMessageSheet } from "./NewMessageSheet";
import { SendTo } from "./SendTo";
import styles from "./Messages.module.css";
import exploreStyles from "../Explore.module.css";

/**
 * /explore/messages: the inbox and the Requests tab, "New message", and who may message the member.
 * `?box=requests` opens Requests; `?to=<username>` starts a message to that member; `?share=<post id>` sends a post.
 */
export function MessagesView() {
  const { db, userId, me, setMe } = useReadyExplore();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/explore/messages";
  const box: InboxBox = params?.get("box") === "requests" ? "requests" : "inbox";
  const counts = useUnreadCounts();
  const [composing, setComposing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [initial, setInitial] = useState<SocialAuthor | null>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  useInboxRefresh(me.age_band === "adult" ? userId : null, bump, GROUP_LIMITS.unreadPollMs);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [bump]);

  const to = params?.get("to") ?? null;
  const share = params?.get("share") ?? null;
  // ?share=<post id> opens "Send post"; closing it takes the parameter away.
  const sharing = share && /^[0-9a-f-]{36}$/.test(share) ? share : null;
  useEffect(() => {
    let live = true;
    if (to) {
      void socialApi.profile(db, to).then((page) => {
        if (!live || !page || page.relation.is_self) return;
        setInitial(page.profile);
        setComposing(true);
      }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [db, to]);

  const clearParams = () => {
    if (to || share) router.replace(box === "requests" ? `${pathname}?box=requests` : pathname, { scroll: false });
  };

  if (me.age_band !== undefined && me.age_band !== "adult") {
    return (
      <div className={styles.page}>
        <PageHeader title="Messages" />
        <div className={exploreStyles.empty}>
          <span className={exploreStyles.emptyMark}><MessageCircle size={26} aria-hidden="true" /></span>
          <h2 className={exploreStyles.emptyTitle}>Messages are for adults</h2>
          <AgeNotice band={me.age_band} feature="Messaging" />
        </div>
      </div>
    );
  }

  const requests = counts.requests ?? 0;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Messages"
        className="mb-0 sm:mb-0"
        actions={
          <div className={styles.headTools}>
            <button type="button" className={styles.toolButton} onClick={() => setSettings(true)} aria-label="Message settings">
              <Settings2 size={17} aria-hidden="true" /><span className={styles.toolLabel}>Settings</span>
            </button>
            <button type="button" className={`${styles.toolButton} ${styles.toolPrimary}`} onClick={() => { setInitial(null); setComposing(true); }}>
              <SquarePen size={17} aria-hidden="true" /><span className={styles.toolLabel}>New message</span>
            </button>
          </div>
        }
      />
      <Tabs
        label="Messages"
        value={box}
        onChange={(next) => router.replace(next === "requests" ? `${pathname}?box=requests` : pathname, { scroll: false })}
        panelClassName="pt-3"
        tabs={[
          {
            id: "inbox", label: "Inbox",
            badge: counts.messages ? <span className={styles.count} aria-label={unreadLabel(counts.messages)}>{counts.messages > 99 ? "99+" : counts.messages}</span> : null,
            content: <ConversationList box="inbox" version={version} onCompose={() => { setInitial(null); setComposing(true); }} />,
          },
          {
            id: "requests", label: "Requests",
            badge: requests ? <span className={`${styles.count} ${styles.countQuiet}`} aria-label={`${requests} waiting`}>{requests > 99 ? "99+" : requests}</span> : null,
            content: <ConversationList box="requests" version={version} />,
          },
        ]}
      />
      <p className={styles.privacy}>Messages are private between you and the other member, but they are not end-to-end encrypted.</p>

      <NewMessageSheet db={db} userId={userId} open={composing} initial={initial} onClose={() => { setComposing(false); clearParams(); }} />
      <Sheet open={sharing !== null} onClose={clearParams} title="Share post">
        {sharing && <SendTo postId={sharing} onDone={clearParams} />}
      </Sheet>
      <PolicySheet
        open={settings}
        value={me.profile?.dm_policy ?? "followers"}
        onClose={() => setSettings(false)}
        onSave={async (policy) => {
          const saved = await messagesApi.setDmPolicy(db, policy);
          if (me.profile) setMe({ ...me, profile: { ...me.profile, dm_policy: saved } });
        }}
      />
    </div>
  );
}

function ConversationList({ box, version, onCompose }: { box: InboxBox; version: number; onCompose?: () => void }) {
  const { db } = useReadyExplore();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState<"idle" | "busy" | "done">("idle");

  useEffect(() => {
    let live = true;
    messagesApi.conversations(db, box).then((list) => {
      if (!live) return;
      setItems((current) => {
        // Keep older pages already loaded below the fresh first page.
        if (!current || current.length <= list.length) return list;
        const ids = new Set(list.map((item) => item.id));
        return [...list, ...current.filter((item) => !ids.has(item.id) && item.last_message_at < (list[list.length - 1]?.last_message_at ?? ""))];
      });
      setError(null);
      if (list.length < GROUP_LIMITS.conversationsPage) setMore("done");
    }).catch((failure) => { if (live) setError(messageErrorText(failure)); });
    return () => { live = false; };
  }, [db, box, version]);

  async function loadMore() {
    if (!items?.length || more !== "idle") return;
    setMore("busy");
    try {
      const page = await messagesApi.conversations(db, box, items[items.length - 1].last_message_at);
      setItems([...items, ...page.filter((item) => !items.some((old) => old.id === item.id))]);
      setMore(page.length < GROUP_LIMITS.conversationsPage ? "done" : "idle");
    } catch (failure) {
      toast.error(messageErrorText(failure));
      setMore("idle");
    }
  }

  if (error && !items) return <p className={exploreStyles.alert} role="alert">{error}</p>;
  if (!items) return <div className={exploreStyles.skeleton} style={{ height: 260 }} aria-busy="true" aria-label="Loading conversations" />;
  if (!items.length) {
    return box === "inbox" ? (
      <div className={exploreStyles.empty}>
        <span className={exploreStyles.emptyMark}><MessageCircle size={26} aria-hidden="true" /></span>
        <h2 className={exploreStyles.emptyTitle}>No messages yet</h2>
        <p className={exploreStyles.emptyText}>Start a conversation with someone you train with.</p>
        {onCompose && <button type="button" className="fitx-button" onClick={onCompose}><SquarePen size={17} aria-hidden="true" />New message</button>}
      </div>
    ) : (
      <div className={exploreStyles.empty}>
        <span className={exploreStyles.emptyMark}><Inbox size={26} aria-hidden="true" /></span>
        <h2 className={exploreStyles.emptyTitle}>No requests</h2>
        <p className={exploreStyles.emptyText}>Messages from people you do not follow wait here until you accept them.</p>
      </div>
    );
  }
  return (
    <>
      <ul className={styles.list} aria-label={box === "inbox" ? "Conversations" : "Message requests"}>
        {items.map((item) => {
          const unread = item.unread > 0;
          return (
            <li key={item.id}>
              <Link href={`/explore/messages/${item.id}`} className={`${styles.row} ${unread ? styles.rowUnread : ""}`}
                aria-label={`${item.other.display_name}, @${item.other.username}${unread ? `, ${unreadLabel(item.unread)}` : ""}`}>
                <Avatar user={item.other} size={48} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{item.other.display_name}</span>
                  <span className={styles.rowPreview}>{previewText(item.last) || `@${item.other.username}`}</span>
                </span>
                <span className={styles.rowMeta}>
                  <time className={styles.time} dateTime={item.last_message_at} title={fullDate(item.last_message_at)}>{relativeTime(item.last_message_at)}</time>
                  {unread ? <span className={styles.dot} aria-hidden="true" /> : item.status === "request" && item.requested_by_me ? <span className={styles.waiting}>Waiting</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more !== "done" && (
        <div className="flex justify-center">
          <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} onClick={() => void loadMore()} disabled={more === "busy"}>
            {more === "busy" ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading</> : "Show more"}
          </button>
        </div>
      )}
    </>
  );
}

function PolicySheet({ open, value, onClose, onSave }: { open: boolean; value: DmPolicy; onClose: () => void; onSave: (policy: DmPolicy) => Promise<void> }) {
  const [choice, setChoice] = useState<DmPolicy>(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setChoice(value);
  }
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Who can message you"
      description="New conversations only. Blocking someone always stops their messages."
      footer={
        <div className="flex gap-2">
          <button type="button" className="fitx-button fitx-button-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="button" className="fitx-button flex-1" disabled={busy || choice === value} onClick={async () => {
            setBusy(true);
            try {
              await onSave(choice);
              toast.success("Message settings saved");
              onClose();
            } catch (failure) {
              toast.error(messageErrorText(failure));
            } finally {
              setBusy(false);
            }
          }}>Save</button>
        </div>
      }
    >
      <fieldset className={styles.policyList}>
        <legend className="sr-only">Who can message you</legend>
        {DM_POLICY_OPTIONS.map((option) => (
          <label key={option.value} className={styles.policy}>
            <input type="radio" name="dm-policy" value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} />
            <span className={styles.policyText}>
              <span className={styles.policyLabel}>{option.label}</span>
              <span className={styles.policyHint}>{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Sheet>
  );
}
