"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CirclePause, Clock, Settings2, Sparkles, Wrench } from "lucide-react";

type Copy = {
  icon: typeof CirclePause;
  title: string;
  text: string;
  /** Said only to a member who has coach data (Coach settings is offered): after "Delete my coach data" it isn't true. */
  kept?: string;
};

/** Honest states for when the coach cannot answer. Nothing here pretends to be a reply. */
const COPY: Record<"paused" | "not_configured" | "not_available" | "failed", Copy> = {
  paused: { icon: CirclePause, title: "The coach is paused", text: "The FITX team has paused the AI coach for now.", kept: "Your conversations are safe and will be here when it's back." },
  not_configured: { icon: Sparkles, title: "The coach isn't switched on yet", text: "The FITX team is connecting the free AI services the coach runs on. Once that's done, it will appear right here. Nothing you've logged is affected." },
  not_available: { icon: Wrench, title: "The coach isn't available yet", text: "FITX needs a quick update before it can keep your coach conversations. Please check back soon." },
  failed: { icon: Clock, title: "The coach couldn't load", text: "Something went wrong while opening the coach. Reload the page to try again." },
};

/**
 * onSettings: the member has coach data, so Coach settings (sharing, "Delete my coach data") stay reachable.
 * focusKey: a new key moves focus to the heading (BRIEF-3 D5): the screen replaced the coach, or its Coach settings
 * button went after "Delete my coach data". 0 (on load) leaves focus alone.
 */
export function CoachUnavailable({ state, onSettings, focusKey = 0 }: { state: keyof typeof COPY; onSettings?: () => void; focusKey?: number }) {
  const { icon: Icon, title, text, kept } = COPY[state];
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusKey) heading.current?.focus();
  }, [focusKey]);

  return (
    <section className="fitx-panel mx-auto max-w-xl px-6 py-10 text-center" aria-labelledby="coach-unavailable-title">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-fitx-surface-variant text-fitx-text-secondary">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h2 ref={heading} tabIndex={-1} id="coach-unavailable-title" className="mt-4 text-lg font-semibold text-fitx-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fitx-text-secondary">{onSettings && kept ? `${text} ${kept}` : text}</p>
      {onSettings && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fitx-text-secondary">
          You can still change what the coach may read, or delete your coach conversations, in Coach settings.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {state === "failed" ? <Link href="/ai-coach" className="fitx-button">Reload</Link> : null}
        {onSettings && (
          <button type="button" onClick={onSettings} className="fitx-button">
            <Settings2 size={17} aria-hidden="true" /> Coach settings
          </button>
        )}
        <Link href="/dashboard" className="fitx-button fitx-button-secondary">Back to Home</Link>
      </div>
    </section>
  );
}
