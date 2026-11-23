"use client";

import { useState } from "react";
import { toast } from "sonner";
import { socialApi, toSocialError, type FollowState } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import styles from "./Explore.module.css";

/** Follow, Requested (a private account has not answered yet) or Following; a second press undoes it. */
export function FollowButton({ db, userId, username, state, onChange, compact = false }: {
  db: Db; userId: string; username: string; state: FollowState; onChange?: (next: FollowState) => void; compact?: boolean;
}) {
  const [current, setCurrent] = useState<FollowState>(state);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(state);
  if (shown !== state) {
    setShown(state);
    setCurrent(state);
  }
  async function press() {
    setBusy(true);
    try {
      let next: FollowState;
      if (current === "none") next = await socialApi.follow(db, userId);
      else {
        await socialApi.unfollow(db, userId);
        next = "none";
      }
      setCurrent(next);
      onChange?.(next);
      if (next === "pending") toast.success(`Request sent to @${username}`);
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = current === "accepted" ? "Following" : current === "pending" ? "Requested" : "Follow";
  const spoken = current === "accepted" ? `Unfollow @${username}` : current === "pending" ? `Withdraw request to @${username}` : `Follow @${username}`;
  return (
    <button
      type="button"
      className={`${styles.smallButton} ${current === "none" ? "" : styles.smallButtonQuiet} ${compact ? "" : "min-w-[112px]"}`}
      disabled={busy}
      aria-label={spoken}
      onClick={() => void press()}
    >
      {label}
    </button>
  );
}
