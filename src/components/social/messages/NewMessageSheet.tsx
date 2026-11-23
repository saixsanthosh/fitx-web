"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { Db, SocialAuthor } from "@/lib/social";
import { GROUP_LIMITS } from "@/lib/social/group-limits";
import { draftState, messageErrorText, messagesApi } from "@/lib/social/messages";
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
};

/** Starts a conversation: choose a person, write the first message, send. A stranger's first message lands in Requests. */
export function NewMessageSheet({ db, userId, open, onClose, initial = null }: Props) {
  const router = useRouter();
  const [to, setTo] = useState<SocialAuthor | null>(initial);
  const [shownInitial, setShownInitial] = useState(initial);
  if (shownInitial !== initial) {
    setShownInitial(initial);
    setTo(initial);
  }
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(messageErrorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New message">
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
              <button type="submit" className={styles.send} aria-label="Send" disabled={!draft.ok || busy}>
                <SendHorizontal size={18} aria-hidden="true" />
              </button>
            </div>
            {draft.over > 0 && <p className={styles.over}>{draft.over.toLocaleString("en-GB")} characters over the limit.</p>}
            {error && <p className="text-sm text-fitx-danger" role="alert">{error}</p>}
            <p className={styles.time}>If @{to.username} does not follow you, this goes to their requests.</p>
          </form>
        )}
      </div>
    </Sheet>
  );
}
