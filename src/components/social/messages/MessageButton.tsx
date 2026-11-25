"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { socialApi, type FollowState, type SocialAuthor } from "@/lib/social";
import type { ProfileActionsProps } from "@/lib/social/slots";
import { messagesApi } from "@/lib/social/messages";
import { useReadyExplore } from "../ExploreContext";
import { NewMessageSheet } from "./NewMessageSheet";
import exploreStyles from "../Explore.module.css";

/**
 * The PROFILE_ACTIONS slot: "Message" on another member's profile. It opens the conversation when there is one, or a
 * first message otherwise. Shown to adults only (O1 a); the database decides whether the other member takes messages.
 * It is shown on every adult's view of a profile, a teen's included: the page is never told the other member's age
 * band or message setting (so nothing an adult sees gives a teen away), and a first message a teen cannot take is
 * refused in the same words as one the member's own setting refuses.
 */
export function MessageButton({ userId, username }: ProfileActionsProps) {
  const { db, userId: self, me } = useReadyExplore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<SocialAuthor | null>(null);
  const [following, setFollowing] = useState<FollowState | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  if (userId === self || me.age_band !== "adult") return null;

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      try {
        const [inbox, requests] = await Promise.all([messagesApi.conversations(db, "inbox"), messagesApi.conversations(db, "requests")]);
        const existing = [...inbox, ...requests].find((conversation) => conversation.other.id === userId);
        if (existing) {
          router.push(`/explore/messages/${existing.id}`);
          return;
        }
      } catch {
        // Fall through to a first message; sending says why if it cannot go.
      }
      const page = await socialApi.profile(db, username).catch(() => null);
      setFollowing(page?.relation.following ?? null);
      setPerson(page?.profile ?? { id: userId, username, display_name: username, avatar_path: null, is_private: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* While it looks for a conversation the button is aria-disabled, not disabled: a disabled button loses keyboard
          focus, and the sheet would then record the page, not Message, as the place to return to (bug 83). */}
      <button ref={button} type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} aria-disabled={busy || undefined} onClick={() => void open()}>
        <MessageCircle size={16} aria-hidden="true" />Message
      </button>
      <NewMessageSheet db={db} userId={self} open={person !== null} initial={person} following={following} returnFocus={button} onClose={() => setPerson(null)} />
    </>
  );
}
