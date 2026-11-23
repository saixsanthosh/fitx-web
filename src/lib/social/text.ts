/**
 * Captions and comments as text runs: plain text, #hashtags and @mentions, matching the database's own parsing
 * (fitx_social_hashtags_in and fitx_social_mentions_in), so a link is drawn exactly where the database records one.
 */
import type { SocialNotification } from "./types";

export type TextRun = { kind: "text"; text: string } | { kind: "tag"; text: string; tag: string } | { kind: "mention"; text: string; username: string };

const TOKEN = /(^|[^a-zA-Z0-9_&])#([a-zA-Z0-9_]{1,50})|(^|[^a-zA-Z0-9_.])@([a-zA-Z0-9._]{3,30})/g;

export function textRuns(input: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous?.kind === "text") previous.text += text;
    else runs.push({ kind: "text", text });
  };
  for (const match of input.matchAll(TOKEN)) {
    const lead = match[1] ?? match[3] ?? "";
    const start = (match.index ?? 0) + lead.length;
    push(input.slice(last, start));
    if (match[2] !== undefined) {
      runs.push({ kind: "tag", text: `#${match[2]}`, tag: match[2].toLowerCase() });
      last = start + 1 + match[2].length;
    } else {
      // A sentence's full stop after a name is not part of it.
      const raw = match[4];
      const name = raw.replace(/\.+$/, "");
      if (name.length < 3) {
        push(`@${raw}`);
      } else {
        runs.push({ kind: "mention", text: `@${name}`, username: name.toLowerCase() });
        push(raw.slice(name.length));
      }
      last = start + 1 + raw.length;
    }
  }
  push(input.slice(last));
  return runs;
}

/** The distinct hashtags of a text, lower case, at most 30, in order. */
export function hashtagsIn(input: string): string[] {
  const tags: string[] = [];
  for (const run of textRuns(input)) if (run.kind === "tag" && !tags.includes(run.tag)) tags.push(run.tag);
  return tags.slice(0, 30);
}

/** The distinct mentioned usernames of a text, lower case, at most 20, in order. */
export function mentionsIn(input: string): string[] {
  const names: string[] = [];
  for (const run of textRuns(input)) if (run.kind === "mention" && !names.includes(run.username)) names.push(run.username);
  return names.slice(0, 20);
}

export type NoteText = Pick<SocialNotification, "type" | "snippet"> & Partial<Pick<SocialNotification, "community" | "challenge">>;

/** What a notification says after the member's name (or on its own, for a notice from FITX that names nobody). */
export function notificationText(note: NoteText): string {
  const community = note.community?.name;
  const challenge = note.challenge?.title;
  switch (note.type) {
    case "follow": return "started following you.";
    case "follow_request": return "asked to follow you.";
    case "follow_accepted": return "accepted your follow request.";
    case "like": return "liked your post.";
    case "comment": return note.snippet ? `commented: ${note.snippet}` : "commented on your post.";
    case "reply": return note.snippet ? `replied: ${note.snippet}` : "replied to your comment.";
    case "mention": return note.snippet ? `mentioned you: ${note.snippet}` : "mentioned you in a post.";
    case "story_like": return "liked your story.";
    case "story_reply": return "replied to your story.";
    case "challenge_invite": return challenge ? `invited you to the challenge ${challenge}.` : "invited you to a challenge.";
    case "challenge_badge": return challenge ? `You earned a badge in ${challenge}.` : "You earned a challenge badge.";
    case "community_request": return community ? `asked to join ${community}.` : "asked to join your community.";
    case "community_invite": return community ? `invited you to join ${community}.` : "invited you to a community.";
    case "community_accepted": return community ? `You are now a member of ${community}.` : "Your request to join was accepted.";
    case "message_request": return "You have a new message request.";
    case "message": return "sent you a message.";
    case "report_reviewed":
      return community ? `The moderators of ${community} removed one of your posts.` : "FITX reviewed your report. Thank you for helping keep Explore safe.";
    default: return "has an update for you.";
  }
}

/** Where a notification leads, or null when it leads nowhere (the text stands alone). */
export function notificationHref(note: SocialNotification, myUsername: string): string | null {
  if (note.post_id) return `/explore/p/${note.post_id}${note.comment_id ? "#comments" : ""}`;
  switch (note.type) {
    case "story_like": return `/explore/stories/${myUsername}`;
    case "story_reply":
    case "message": return note.conversation_id ? `/explore/messages/${note.conversation_id}` : "/explore/messages";
    case "message_request": return "/explore/messages?box=requests";
    case "challenge_invite":
    case "challenge_badge": return note.challenge_id ? `/explore/challenges/${note.challenge_id}` : null;
    case "community_request":
    case "community_invite":
    case "community_accepted": return note.community ? `/explore/c/${note.community.slug}` : null;
    default: return null;
  }
}

