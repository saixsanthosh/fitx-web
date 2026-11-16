import Link from "next/link";
import { CirclePause, Clock, Settings2, Sparkles, Wrench } from "lucide-react";

/** Honest states for when the coach cannot answer. Nothing here pretends to be a reply. */
const COPY = {
  paused: { icon: CirclePause, title: "The coach is paused", text: "The FITX team has paused the AI coach for now. Your conversations are safe and will be here when it's back." },
  not_configured: { icon: Sparkles, title: "The coach isn't switched on yet", text: "The FITX team is connecting the free AI services the coach runs on. Once that's done, it will appear right here. Nothing you've logged is affected." },
  not_available: { icon: Wrench, title: "The coach isn't available yet", text: "FITX needs a quick update before it can keep your coach conversations. Please check back soon." },
  failed: { icon: Clock, title: "The coach couldn't load", text: "Something went wrong while opening the coach. Reload the page to try again." },
} as const;

/** onSettings: the member has coach data, so Coach settings (sharing, "Delete my coach data") stay reachable. */
export function CoachUnavailable({ state, onSettings }: { state: keyof typeof COPY; onSettings?: () => void }) {
  const { icon: Icon, title, text } = COPY[state];
  return (
    <section className="fitx-panel mx-auto max-w-xl px-6 py-10 text-center" aria-labelledby="coach-unavailable-title">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-fitx-surface-variant text-fitx-text-secondary">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h2 id="coach-unavailable-title" className="mt-4 text-lg font-semibold text-fitx-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fitx-text-secondary">{text}</p>
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
