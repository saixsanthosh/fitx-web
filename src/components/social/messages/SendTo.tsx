"use client";

import { useState } from "react";
import { Check, Loader2, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { ShareTargetsProps } from "@/lib/social/slots";
import { messageErrorText, messagesApi } from "@/lib/social/messages";
import { refreshUnreadCounts } from "@/lib/social/realtime";
import { useReadyExplore } from "../ExploreContext";
import { PeoplePicker } from "./PeoplePicker";
import styles from "./Messages.module.css";
import exploreStyles from "../Explore.module.css";

/**
 * The SHARE_TARGETS slot (PostCard's share menu): "Send to…" opens a list of people; each tap sends the post as a
 * message (the database checks again that the reader may see it). Adults only, like all messages (O1 a).
 */
export function SendTo({ postId, onDone }: ShareTargetsProps) {
  const { db, userId, me } = useReadyExplore();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  if (me.age_band !== undefined && me.age_band !== "adult") return null;

  async function send(personId: string, username: string) {
    if (sent.has(personId) || busy) return;
    setBusy(personId);
    try {
      await messagesApi.send(db, personId, "", { postId });
      setSent((current) => new Set([...current, personId]));
      refreshUnreadCounts();
      toast.success(`Sent to @${username}`);
    } catch (failure) {
      toast.error(messageErrorText(failure));
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className={exploreStyles.menuItem} aria-expanded={false} onClick={() => setOpen(true)}>
        <SendHorizontal size={18} aria-hidden="true" />Send to…
      </button>
    );
  }
  return (
    <section aria-label="Send to…" className="flex flex-col gap-3 pb-2">
      <PeoplePicker
        db={db}
        userId={userId}
        label="Search people to send to"
        picked={sent}
        onPick={(person) => void send(person.id, person.username)}
        trailing={(person) => busy === person.id
          ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-label="Sending" />
          : sent.has(person.id) ? <span className={styles.sentTick}><Check size={18} aria-hidden="true" /><span className="sr-only">Sent</span></span> : null}
      />
      <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet} self-end`} onClick={onDone}>Done</button>
    </section>
  );
}
