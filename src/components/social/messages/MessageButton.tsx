"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { socialApi, type SocialAuthor } from "@/lib/social";
import type { ProfileActionsProps } from "@/lib/social/slots";
import { messagesApi } from "@/lib/social/messages";
import { useReadyExplore } from "../ExploreContext";
import { NewMessageSheet } from "./NewMessageSheet";
import exploreStyles from "../Explore.module.css";

/**
 * The PROFILE_ACTIONS slot: "Message" on another member's profile. It opens the conversation when there is one, or a
 * first message otherwise. Shown to adults only (O1 a); the database decides whether the other member takes messages.
 */
export function MessageButton({ userId, username }: ProfileActionsProps) {
  const { db, userId: self, me } = useReadyExplore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<SocialAuthor | null>(null);
  if (userId === self || me.age_band !== "adult") return null;

  async function open() {
    setBusy(true);
    try {
      const [inbox, requests] = await Promise.all([messagesApi.conversations(db, "inbox"), messagesApi.conversations(db, "requests")]);
      const existing = [...inbox, ...requests].find((conversation) => conversation.other.id === userId);
      if (existing) {
        router.push(`/explore/messages/${existing.id}`);
        return;
      }
    } catch {
      // Fall through to a first message; sending says why if it cannot go.
    } finally {
      setBusy(false);
    }
    const page = await socialApi.profile(db, username).catch(() => null);
    setPerson(page?.profile ?? { id: userId, username, display_name: username, avatar_path: null, is_private: false });
  }

  return (
    <>
      <button type="button" className={`${exploreStyles.smallButton} ${exploreStyles.smallButtonQuiet}`} disabled={busy} onClick={() => void open()}>
        <MessageCircle size={16} aria-hidden="true" />Message
      </button>
      <NewMessageSheet db={db} userId={self} open={person !== null} initial={person} onClose={() => setPerson(null)} />
    </>
  );
}
