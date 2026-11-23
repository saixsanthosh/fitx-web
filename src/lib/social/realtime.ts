/**
 * The member's Explore inbox, live. 20261124100000 sends ids only (never content) to the private broadcast topic
 * `social:inbox:<uid>` (fitx_social_ping), and only that member may read it (the social_inbox_read policy). When
 * Realtime is not reachable the app falls back to polling, so nothing depends on it.
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Db } from "./api";
import { GROUP_LIMITS } from "./group-limits";
import { messagesApi, type UnreadCounts } from "./messages";

export type InboxPing = { kind: string; id: string };

type Channel = {
  on: (type: "broadcast", filter: { event: string }, callback: (message: { payload?: unknown }) => void) => Channel;
  subscribe: (callback?: (status: string) => void) => Channel;
};
export type RealtimeLike = {
  channel: (name: string, options: { config: { private: boolean } }) => Channel;
  removeChannel: (channel: Channel) => unknown;
};
type DocumentLike = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
type Env = {
  client?: RealtimeLike | null;
  doc?: DocumentLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called with true once the channel is joined, false when it closes or fails (the caller polls then). */
  onLive?: (live: boolean) => void;
};

export const inboxTopic = (userId: string) => `social:inbox:${userId}`;

/** A ping's payload, or null for anything else (pings carry a kind and an id only). */
export function parsePing(payload: unknown): InboxPing | null {
  if (!payload || typeof payload !== "object") return null;
  const { kind, id } = payload as { kind?: unknown; id?: unknown };
  return typeof kind === "string" && typeof id === "string" && /^[a-z_]{1,30}$/.test(kind) ? { kind, id } : null;
}

/**
 * Listens to the member's inbox topic while the page that calls it is mounted. The channel closes after the tab has
 * been hidden for a minute and opens again when it is shown; a channel that fails to join is dropped (no retry loop),
 * and `onLive(false)` tells the caller to poll. Returns the stop function.
 */
export function subscribeInbox(userId: string, onPing: (ping: InboxPing) => void, env: Env = {}): () => void {
  const client = env.client === undefined ? (createClient() as unknown as RealtimeLike | null) : env.client;
  const doc = env.doc ?? (typeof document === "undefined" ? undefined : document);
  const setTimer = env.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = env.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  if (!client || !userId) {
    env.onLive?.(false);
    return () => undefined;
  }
  let channel: Channel | null = null;
  let idle: unknown = null;
  let failed = false;
  let stopped = false;

  const close = () => {
    if (!channel) return;
    const current = channel;
    channel = null;
    void client.removeChannel(current);
    env.onLive?.(false);
  };
  const open = () => {
    if (channel || failed || stopped) return;
    const current = client.channel(inboxTopic(userId), { config: { private: true } });
    channel = current;
    current
      .on("broadcast", { event: "ping" }, (message) => {
        const ping = parsePing(message?.payload);
        if (ping) onPing(ping);
      })
      .subscribe((status) => {
        if (channel !== current) return;
        if (status === "SUBSCRIBED") env.onLive?.(true);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          failed = true;
          close();
        } else if (status === "CLOSED") close();
      });
  };
  const onVisibility = () => {
    if (!doc) return;
    if (doc.visibilityState === "hidden") {
      if (idle === null) idle = setTimer(() => { idle = null; close(); }, GROUP_LIMITS.channelIdleMs);
    } else {
      if (idle !== null) {
        clearTimer(idle);
        idle = null;
      }
      open();
    }
  };

  open();
  doc?.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    doc?.removeEventListener("visibilitychange", onVisibility);
    if (idle !== null) clearTimer(idle);
    close();
  };
}

/**
 * Reads the unread counts now, whenever the tab is shown again, and every `everyMs` (120 s). `refresh()` reads them at
 * once (after a ping, or after the member read a conversation). A count that cannot be read is null, never 0.
 */
export function createUnreadPoller(read: () => Promise<UnreadCounts>, onCounts: (counts: UnreadCounts) => void, env: {
  doc?: DocumentLike; everyMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown; clearInterval?: (handle: unknown) => void;
} = {}) {
  const doc = env.doc ?? (typeof document === "undefined" ? undefined : document);
  const every = env.everyMs ?? GROUP_LIMITS.unreadPollMs;
  const start = env.setInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const stopTimer = env.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let ticket = 0;
  let stopped = false;
  const refresh = async () => {
    if (stopped || doc?.visibilityState === "hidden") return;
    const mine = ++ticket;
    try {
      const counts = await read();
      if (!stopped && mine === ticket) onCounts(counts);
    } catch {
      if (!stopped && mine === ticket) onCounts({ messages: null, requests: null, notifications: null });
    }
  };
  const onVisibility = () => { if (doc?.visibilityState === "visible") void refresh(); };
  doc?.addEventListener("visibilitychange", onVisibility);
  const handle = start(() => void refresh(), every);
  void refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      doc?.removeEventListener("visibilitychange", onVisibility);
      stopTimer(handle);
    },
  };
}

const UNKNOWN: UnreadCounts = { messages: null, requests: null, notifications: null };
const listeners = new Set<() => void>();

/** Asks every mounted useUnreadCounts to read again (after reading a conversation or answering a request). */
export function refreshUnreadCounts() {
  for (const listener of listeners) listener();
}

/**
 * The member's unread counts, polled on tab visibility and every 120 s. Null while unknown (signed out, not loaded, no
 * Explore profile, under 18 for messages), never 0.
 */
export function useUnreadCounts(): { messages: number | null; notifications: number | null; requests: number | null } {
  const [counts, setCounts] = useState<UnreadCounts>(UNKNOWN);
  useEffect(() => {
    const db = createClient() as unknown as Db | null;
    if (!db) return;
    const poller = createUnreadPoller(() => messagesApi.unreadCounts(db), setCounts);
    const listener = () => void poller.refresh();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      poller.stop();
    };
  }, []);
  return counts;
}

/** The accessible name of the unread messages badge. */
export const unreadLabel = (count: number) => `${count} unread ${count === 1 ? "message" : "messages"}`;

/** The rail's badge for Messages: the unread count, named "<n> unread messages"; nothing when unknown or zero. */
export function MessagesBadge() {
  const { messages } = useUnreadCounts();
  if (!messages) return null;
  return createElement("span", {
    role: "status",
    "aria-label": unreadLabel(messages),
    className: "absolute -right-2 -top-2 z-[2] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-fitx-primary px-[5px] text-[11px] font-bold leading-[18px] text-fitx-on-primary",
  }, messages > 99 ? "99+" : String(messages));
}

/** For a page that shows live data: re-reads on every inbox ping, and polls every `pollMs` while Realtime is down. */
export function useInboxRefresh(userId: string | null, onChange: (ping: InboxPing | null) => void, pollMs: number = GROUP_LIMITS.conversationPollMs) {
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; });
  const [live, setLive] = useState(false);
  const fire = useCallback((ping: InboxPing | null) => callback.current(ping), []);
  useEffect(() => {
    if (!userId) return;
    return subscribeInbox(userId, (ping) => { fire(ping); refreshUnreadCounts(); }, { onLive: setLive });
  }, [userId, fire]);
  useEffect(() => {
    if (live || !userId) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") fire(null); }, pollMs);
    return () => clearInterval(timer);
  }, [live, userId, pollMs, fire]);
  return live;
}
