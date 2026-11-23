/**
 * Direct messages, typed (supabase/migrations/20261124100010_fitx_social_v2_groups.sql). Every call runs as the signed-in
 * member; the database decides who may message whom, what lands in Requests and what a reader may see.
 */
import { SocialError, toSocialError, socialErrorMessage } from "./errors";
import type { Db } from "./api";
import type { DmPolicy, SocialAuthor, SocialPost } from "./types";
import { GROUP_LIMITS } from "./group-limits";

export type ConversationStatus = "request" | "accepted";
export type InboxBox = "inbox" | "requests";

export type ConversationSummary = {
  id: string;
  status: ConversationStatus;
  requested_by_me: boolean;
  other: SocialAuthor;
  last_message_at: string;
  last: { mine: boolean; kind: "text" | "post" | "story" | "unsent"; body: string; created_at: string } | null;
  unread: number;
};

export type DirectMessage = {
  id: string;
  mine: boolean;
  body: string;
  unsent: boolean;
  created_at: string;
  /** A shared post, only while the reader can see it. */
  post: SocialPost | null;
  /** A shared post the reader can no longer see. */
  post_unavailable: boolean;
  /** A story reply: the story's id while it exists (null once the hourly clean-up has deleted it). */
  story: { id: string | null; available: boolean } | null;
};

export type ConversationPage = {
  conversation: {
    id: string;
    status: ConversationStatus;
    requested_by_me: boolean;
    other: SocialAuthor;
    /** FITX paused this member's messages. */
    dm_paused: boolean;
    can_send: boolean;
  };
  /** Newest first. */
  messages: DirectMessage[];
};

export type SendResult = { conversation_id: string; status: ConversationStatus; message: DirectMessage };
export type UnreadCounts = { messages: number | null; requests: number | null; notifications: number | null };

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toSocialError(error);
  return data as T;
}

export const messagesApi = {
  send: (db: Db, to: string, body: string, extra: { postId?: string | null; storyId?: string | null } = {}) =>
    call<SendResult>(db, "fitx_social_send_message", {
      p_to: to, p_body: body, p_shared_post_id: extra.postId ?? null, p_story_id: extra.storyId ?? null,
    }),
  conversations: (db: Db, box: InboxBox, before: string | null = null) =>
    call<ConversationSummary[]>(db, "fitx_social_conversations", { p_before: before, p_box: box }),
  messages: (db: Db, conversationId: string, before: { at: string; id: string } | null = null) =>
    call<ConversationPage>(db, "fitx_social_messages", { p_conversation: conversationId, p_before_at: before?.at ?? null, p_before_id: before?.id ?? null }),
  answer: (db: Db, conversationId: string, accept: boolean) =>
    call<{ status: ConversationStatus; box: InboxBox | null }>(db, "fitx_social_answer_conversation", { p_conversation: conversationId, p_accept: accept }),
  markRead: (db: Db, conversationId: string) => call<boolean>(db, "fitx_social_mark_conversation_read", { p_conversation: conversationId }),
  unsend: (db: Db, messageId: string) => call<boolean>(db, "fitx_social_unsend_message", { p_message: messageId }),
  setDmPolicy: (db: Db, policy: DmPolicy) => call<DmPolicy>(db, "fitx_social_set_dm_policy", { p_policy: policy }),
  unreadCounts: (db: Db) => call<UnreadCounts>(db, "fitx_social_unread_counts"),
};

export const DM_POLICY_OPTIONS: readonly { value: DmPolicy; label: string; hint: string }[] = [
  { value: "everyone", label: "Everyone", hint: "People you do not follow land in Requests." },
  { value: "followers", label: "Your followers", hint: "People you do not follow land in Requests." },
  { value: "mutuals", label: "People you follow back", hint: "Only accounts that follow each other." },
  { value: "off", label: "No one", hint: "Conversations you already have carry on." },
];

/** What the member reads when a message action fails: the groups' own cases first, then Explore's. */
export function messageErrorText(error: unknown): string {
  const failure = toSocialError(error);
  if (failure.key === "social_suspended" && failure.hint === "dm") return "FITX has paused your messages for now.";
  if (failure.key === "social_dm_not_allowed") {
    if (failure.hint === "pending") return "Your message request is waiting for an answer.";
    if (failure.hint === "blocked") return "You cannot message this account.";
  }
  // A SocialError already carries Explore's own wording for its key; anything else is read as Explore reads it.
  return error instanceof SocialError ? error.message : socialErrorMessage(error);
}

/** One line for a conversation in the inbox. */
export function previewText(last: ConversationSummary["last"]): string {
  if (!last) return "";
  const prefix = last.mine ? "You: " : "";
  switch (last.kind) {
    case "unsent": return last.mine ? "You unsent a message" : "Message unsent";
    case "post": return `${prefix}Shared a post`;
    case "story": return `${prefix}${last.body || "Replied to a story"}`;
    default: return `${prefix}${last.body}`;
  }
}

/** How a draft stands: empty, too long (with how much over) or ready. */
export function draftState(body: string, hasAttachment = false): { ok: boolean; over: number } {
  const length = body.trim().length;
  const over = Math.max(0, length - GROUP_LIMITS.messageChars);
  return { ok: over === 0 && (length > 0 || hasAttachment), over };
}

/** Splits text into plain parts and web links; a request's links stay plain text (the brief's request rule). */
export function linkParts(text: string): { text: string; href: string | null }[] {
  const parts: { text: string; href: string | null }[] = [];
  const pattern = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), href: null });
    parts.push({ text: match[0], href: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null });
  return parts;
}

/** Messages grouped by local day, oldest first, for the conversation view (input newest first, as the database sends). */
export function groupByDay(messages: readonly DirectMessage[], locale = "en-GB"): { day: string; label: string; items: DirectMessage[] }[] {
  const days: { day: string; label: string; items: DirectMessage[] }[] = [];
  for (const message of [...messages].reverse()) {
    const date = new Date(message.created_at);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let group = days[days.length - 1];
    if (!group || group.day !== day) {
      group = { day, label: date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }), items: [] };
      days.push(group);
    }
    group.items.push(message);
  }
  return days;
}

/** Merges a fresh newest page into what is shown (newest first), keeping older pages already loaded. */
export function mergeNewest(shown: readonly DirectMessage[], fresh: readonly DirectMessage[]): DirectMessage[] {
  const byId = new Map(shown.map((message) => [message.id, message]));
  for (const message of fresh) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
}
