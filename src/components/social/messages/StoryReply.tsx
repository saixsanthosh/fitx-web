"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { StoryReplyProps } from "@/lib/social/slots";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import { messageErrorText, messagesApi } from "@/lib/social/messages";
import { useReadyExplore } from "../ExploreContext";
import styles from "./Messages.module.css";

/**
 * The STORY_REPLY slot (social-stories' viewer, on the dark stage): a reply to another member's story, sent as a
 * message with the story attached. Adults only (O1 a); nothing shows on the member's own story. While the box has
 * focus or holds a draft it tells the viewer (`onActiveChange`), which holds the story still; the viewer keys it by
 * story, so a draft is never sent to another story's owner.
 */
export function StoryReply({ storyId, ownerId, ownerName, onSent, onFailed, onActiveChange }: StoryReplyProps) {
  const { db, userId, me } = useReadyExplore();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = focused || body !== "";
  const report = useRef(onActiveChange);
  useEffect(() => { report.current = onActiveChange; });
  const reported = useRef(false);
  useEffect(() => {
    if (active === reported.current) return;
    reported.current = active;
    report.current?.(active);
  }, [active]);
  // Leaving this story (another story, or the viewer closing) ends the reply.
  useEffect(() => () => { if (reported.current) report.current?.(false); }, []);
  if (ownerId === userId || me.age_band !== "adult") return null;
  const text = body.trim();

  async function send() {
    if (!text || busy) return;
    setBusy(true);
    try {
      await messagesApi.send(db, ownerId, text, { storyId });
      setBody("");
      // The viewer says "Reply sent" (once, inside itself) and moves focus back to the story.
      onSent();
    } catch (failure) {
      // The draft stays in the box; the viewer says why beside it (a toast would be under the viewer, bug 18).
      const reason = messageErrorText(failure, { username: ownerName });
      if (onFailed) onFailed(reason);
      else toast.error(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.replyBar} onSubmit={(event) => { event.preventDefault(); void send(); }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <input
        className={styles.replyInput}
        aria-label="Reply to story"
        placeholder="Reply"
        maxLength={GROUP_LIMITS.messageChars}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" className={styles.send} aria-label="Send" disabled={!text} aria-disabled={busy || undefined}>
        <SendHorizontal size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
