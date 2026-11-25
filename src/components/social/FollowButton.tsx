"use client";

import { useState } from "react";
import { toast } from "sonner";
import { socialApi, toSocialError, type FollowState } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import styles from "./Explore.module.css";

/**
 * Follow, Requested (a private account has not answered yet) or Following; a second press undoes it. Busy is
 * aria-disabled, so the button keeps keyboard focus. Inside a sheet the host passes `onNotice`, and the result is said
 * in the sheet; elsewhere it is a toast (a toast raised under an open sheet is neither seen nor heard, D6).
 */
export function FollowButton({ db, userId, username, state, onChange, compact = false, id, onNotice }: {
  db: Db; userId: string; username: string; state: FollowState; onChange?: (next: FollowState) => void; compact?: boolean;
  id?: string; onNotice?: (tone: "error" | "success", text: string) => void;
}) {
  const [current, setCurrent] = useState<FollowState>(state);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(state);
  if (shown !== state) {
    setShown(state);
    setCurrent(state);
  }
  const say = (tone: "error" | "success", text: string) => {
    if (onNotice) onNotice(tone, text);
    else if (tone === "error") toast.error(text);
    else toast.success(text);
  };
  async function press() {
    if (busy) return;
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
      if (next === "pending") say("success", `Request sent to @${username}`);
    } catch (error) {
      say("error", toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = current === "accepted" ? "Following" : current === "pending" ? "Requested" : "Follow";
  const spoken = current === "accepted" ? `Unfollow @${username}` : current === "pending" ? `Withdraw request to @${username}` : `Follow @${username}`;
  return (
    <button
      type="button"
      id={id}
      className={`${styles.smallButton} ${current === "none" ? "" : styles.smallButtonQuiet} ${compact ? "" : "min-w-[112px]"}`}
      aria-disabled={busy || undefined}
      aria-label={spoken}
      onClick={() => void press()}
    >
      {label}
    </button>
  );
}
