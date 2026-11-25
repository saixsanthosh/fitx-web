"use client";

import { useRouter } from "next/navigation";
import { useState, type RefObject } from "react";
import { SendHorizontal, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { Db, FollowState, SocialAuthor } from "@/lib/social";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import { draftState, firstMessageNote, messageErrorText, messagesApi } from "@/lib/social/messages";
import { refreshUnreadCounts } from "@/lib/social/realtime";
import { Avatar } from "../Avatar";
import { PeoplePicker } from "./PeoplePicker";
import styles from "./Messages.module.css";

type Props = {
  db: Db;
  userId: string;
  open: boolean;
  onClose: () => void;
  /** A person already chosen (from a profile's Message button). */
  initial?: SocialAuthor | null;
  /** Whether the member follows `initial` (from its profile), so a refusal can say what they can do; null if not known. */
  following?: FollowState | null;
  /** The button that opened the sheet, for focus to return to on close (Sheet's `returnFocus`). */
  returnFocus?: RefObject<HTMLElement | null>;
};

/**
 * Starts a conversation: choose a person, write the first message, send. Whether it can go, and whether it waits in
 * Requests, is the other member's setting, which the sheet cannot see: it says so before sending and, when the message
 * is not taken, says what the member can do (without the other member's age or settings).
 */
export function NewMessageSheet({ db, userId, open, onClose, initial = null, following = null, returnFocus }: Props) {
  const router = useRouter();
  const [to, setTo] = useState<SocialAuthor | null>(initial);
  const [error, setError] = useState<string | null>(null);
  // The sheet stays mounted between openings (MessageButton, MessagesView) and keeps the draft. A refusal answers one
  // attempt, though: closing the sheet, opening it again or opening it for someone else clears it. Otherwise the sheet
  // would open on the old refusal, announced again where the note about what will happen goes, with advice worked out
  // from that attempt's follow state (from before the member followed, say).
  const [shown, setShown] = useState({ open, initial });
  if (shown.open !== open || shown.initial !== initial) {
    if (shown.initial !== initial) setTo(initial);
    setShown({ open, initial });
    setError(null);
  }
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = draftState(body);

  async function send() {
    if (!to || !draft.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await messagesApi.send(db, to.id, body.trim());
      setBody("");
      refreshUnreadCounts();
      onClose();
      router.push(`/explore/messages/${result.conversation_id}`);
    } catch (failure) {
      // What the sheet knows of the person it was opened for; someone picked from search is not known.
      setError(messageErrorText(failure, { username: to.username, following: initial && to.id === initial.id ? following : null }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New message" returnFocus={returnFocus}>
      <div className="flex flex-col gap-4">
        {to ? (
          <div className={styles.person}>
            <Avatar user={to} size={40} />
            <span className={styles.personText}>
              <span className={styles.personName}>{to.display_name}</span>
              <span className={styles.personSub}>@{to.username}</span>
            </span>
            <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fitx-text-secondary hover:bg-fitx-hover" aria-label={`Choose someone else instead of @${to.username}`} onClick={() => { setTo(null); setError(null); }}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <PeoplePicker db={db} userId={userId} onPick={(person) => { setTo(person); setError(null); }} />
        )}
        {to && (
          <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className="flex items-end gap-2">
              <textarea
                className={styles.input}
                aria-label="Message"
                placeholder={`Message @${to.username}`}
                rows={2}
                maxLength={GROUP_LIMITS.messageChars + 50}
                value={body}
                autoFocus
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
              />
              {/* Busy is aria-disabled, not disabled: a disabled button drops keyboard focus to the page. */}
              <button type="submit" className={styles.send} aria-label="Send" disabled={!draft.ok} aria-disabled={busy || undefined}>
                <SendHorizontal size={18} aria-hidden="true" />
              </button>
            </div>
            {draft.over > 0 && <p className={styles.over}>{draft.over.toLocaleString("en-GB")} characters over the limit.</p>}
            {error ? <p className="text-sm text-fitx-danger" role="alert">{error}</p> : <p className={styles.time}>{firstMessageNote(to.username)}</p>}
          </form>
        )}
      </div>
    </Sheet>
  );
}
