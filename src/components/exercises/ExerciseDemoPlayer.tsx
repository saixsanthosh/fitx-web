"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Pause, Play } from "lucide-react";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { isOptimizableImageUrl, mediaCreditLines, type ExerciseMedia, type MediaItem } from "@/lib/training/media";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** How long each photo stays up while the user has asked for them to alternate. */
const ALTERNATE_MS = 1600;
const PHOTO_NOTE = "These are photos of the movement, not an animation. Realistic animated or 3D demonstrations need licensed motion-capture data and are not available yet.";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the device asks for reduced motion; assumed true until the browser has said. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => true);
}

/**
 * Shows an exercise's demonstration media: a muted video loop when one exists (none do yet), else its photos.
 * `layout`:
 *  - "single" (default, the live workout): one photo at a time with a user-controlled photo switch. Photos only
 *    alternate on their own after the user presses the button, never when the device asks for reduced motion.
 *  - "sequence" (the exercise page): every photo at once as a numbered sequence, side by side from 640 px and
 *    swiped sideways on phones. The numbers are the source's order; nothing claims which photo is the start.
 * Give it a `key` per exercise.
 */
export function ExerciseDemoPlayer({ media, name, layout = "single" }: { media: ExerciseMedia; name: string; layout?: "single" | "sequence" }) {
  const [failedVideos, setFailedVideos] = useState<string[]>([]);
  const video = media.videos.find((item) => !failedVideos.includes(item.url));
  if (video) {
    return <VideoLoop key={video.url} video={video} poster={media.stills[0] ?? null} name={name}
      onError={() => setFailedVideos((current) => (current.includes(video.url) ? current : [...current, video.url]))} />;
  }
  return layout === "sequence" ? <StillSequence stills={media.stills} name={name} /> : <StillPhotos stills={media.stills} />;
}

/** The photos as a numbered sequence: a swipeable row on phones, side by side from 640 px. */
function StillSequence({ stills, name }: { stills: MediaItem[]; name: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const shown = stills.filter((still) => !failed.includes(still.url));
  if (!shown.length) return <MediaUnavailable failed={stills.length > 0} demonstration />;
  const count = stills.length;
  const several = count > 1;
  const credits = mediaCreditLines(shown);
  return (
    <figure className="m-0">
      <div
        role="region"
        aria-label={several ? `${name}: demonstration photos 1 to ${count}` : `${name}: demonstration photo`}
        tabIndex={several ? 0 : undefined}
        className={several ? "-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden" : ""}
      >
        <ol className={`m-0 flex list-none gap-2.5 p-0 ${several ? "sm:grid sm:grid-cols-2 sm:gap-3" : ""}`}>
          {stills.map((still, index) => (
            <li key={still.url} className={several ? "w-[82%] shrink-0 snap-start sm:w-auto" : "w-full"}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-fitx-border bg-fitx-surface-variant">
                {failed.includes(still.url) ? (
                  <p className="m-0 grid h-full place-items-center px-4 text-center text-xs text-fitx-text-secondary">Photo {index + 1} could not be loaded.</p>
                ) : (
                  <Image
                    src={still.url}
                    alt={still.alt}
                    fill
                    sizes="(max-width: 640px) 82vw, (max-width: 1024px) 46vw, 420px"
                    unoptimized={!isOptimizableImageUrl(still.url, SUPABASE_URL)}
                    className="object-contain p-2"
                    onError={() => setFailed((current) => (current.includes(still.url) ? current : [...current, still.url]))}
                  />
                )}
                {several && (
                  <span aria-hidden="true" className="absolute left-2 top-2 grid h-7 min-w-7 place-items-center rounded-full border border-fitx-border bg-fitx-card px-2 text-xs font-bold tabular-nums text-fitx-text">
                    {index + 1}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-2 text-xs leading-5 text-fitx-text-secondary">
        <span className="block">{several ? `Photos 1 ${count === 2 ? "and" : "to"} ${count}, in the source’s order. Photos, not an animation.` : "A photo of the movement, not an animation."}</span>
        {credits.map((line) => <span key={line} className="block text-[11px] text-fitx-text-disabled">{line}</span>)}
      </figcaption>
    </figure>
  );
}

function StillPhotos({ stills }: { stills: MediaItem[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const [failed, setFailed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [alternating, setAlternating] = useState(false);
  const shown = stills.filter((still) => !failed.includes(still.url));
  const count = shown.length;
  const active = count ? Math.min(index, count - 1) : 0;
  const playing = alternating && !reducedMotion && count > 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), ALTERNATE_MS);
    return () => window.clearInterval(timer);
  }, [playing, count]);

  if (!count) return <MediaUnavailable failed={stills.length > 0} />;

  const step = (delta: number) => {
    setAlternating(false);
    setIndex((active + delta + count) % count);
  };
  const credits = mediaCreditLines(shown);
  return (
    <figure className="overflow-hidden rounded-xl border border-fitx-border bg-fitx-surface">
      <div className="relative aspect-[4/3] bg-fitx-surface-variant sm:aspect-[16/10]">
        {shown.map((still, position) => (
          <Image
            key={still.url}
            src={still.url}
            alt={position === active ? still.alt : ""}
            aria-hidden={position === active ? undefined : true}
            fill
            sizes="(max-width: 768px) 100vw, 760px"
            unoptimized={!isOptimizableImageUrl(still.url, SUPABASE_URL)}
            className={`object-contain p-2 transition-opacity duration-500 ease-out motion-reduce:transition-none sm:p-4 ${position === active ? "opacity-100" : "opacity-0"}`}
            onError={() => setFailed((current) => (current.includes(still.url) ? current : [...current, still.url]))}
          />
        ))}
      </div>
      <figcaption className="border-t border-fitx-border px-3 py-2.5 sm:px-4">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-fitx-text-secondary" aria-live={playing ? "off" : "polite"}>
            {count > 1 ? `Photo ${active + 1} of ${count}` : "Photo"}{playing ? " · alternating" : ""}
          </p>
          {count > 1 && (
            <div className="flex items-center gap-2">
              {!reducedMotion && (
                <button type="button" onClick={() => setAlternating((value) => !value)}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-fitx-text transition-colors hover:bg-fitx-hover ${playing ? "border-fitx-primary" : "border-fitx-border hover:border-fitx-primary/45"}`}>
                  {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  {playing ? "Stop alternating" : "Alternate photos"}
                </button>
              )}
              <button type="button" onClick={() => step(-1)} aria-label="Previous photo"
                className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border text-fitx-text transition-colors hover:border-fitx-primary/45 hover:bg-fitx-hover">
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => step(1)} aria-label="Next photo"
                className="grid h-10 w-10 place-items-center rounded-md border border-fitx-border text-fitx-text transition-colors hover:border-fitx-primary/45 hover:bg-fitx-hover">
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-fitx-text-secondary">{PHOTO_NOTE}</p>
        {credits.map((line) => <p key={line} className="mt-1 text-[11px] leading-5 text-fitx-text-disabled">{line}</p>)}
      </figcaption>
    </figure>
  );
}

function VideoLoop({ video, poster, name, onError }: { video: MediaItem; poster: MediaItem | null; name: string; onError: () => void }) {
  const reducedMotion = usePrefersReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);

  // A muted loop starts on its own unless the device asks for reduced motion; the controls can always
  // pause it (and start it when it is held).
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reducedMotion) element.pause();
    else void element.play().catch(() => undefined);
  }, [reducedMotion]);

  const credits = mediaCreditLines(poster ? [video, poster] : [video]);
  return (
    <figure className="overflow-hidden rounded-xl border border-fitx-border bg-fitx-surface">
      <div className="relative aspect-[4/3] bg-fitx-surface-variant sm:aspect-[16/10]">
        <video ref={ref} src={video.url} poster={poster?.url} muted loop playsInline controls preload="metadata"
          aria-label={video.alt || `${name}, demonstration video`} onError={onError} className="h-full w-full object-contain" />
      </div>
      <figcaption className="border-t border-fitx-border px-3 py-2.5 text-xs leading-5 text-fitx-text-secondary sm:px-4">
        <p className="font-medium">Demonstration video, muted and looped{reducedMotion ? ". Press play to watch it: it does not start on its own while your device asks for reduced motion." : "."}</p>
        {credits.map((line) => <p key={line} className="mt-1 text-[11px] text-fitx-text-disabled">{line}</p>)}
      </figcaption>
    </figure>
  );
}

function MediaUnavailable({ failed, demonstration = false }: { failed: boolean; demonstration?: boolean }) {
  const title = failed ? "The photos could not be loaded" : demonstration ? "No demonstration yet" : "No photos for this exercise yet";
  const detail = failed
    ? "Check your connection and reload the page."
    : demonstration
      ? "There are no photos of this exact movement yet, so follow the written steps."
      : "Follow the written steps. Realistic animated or 3D demonstrations need licensed motion-capture data and are not available yet.";
  return (
    <figure className={`grid place-items-center rounded-xl border border-dashed border-fitx-border bg-fitx-surface-variant px-5 text-center ${demonstration ? "min-h-36 py-6" : "min-h-48 py-8"}`}>
      <div className="max-w-sm">
        <ImageOff size={24} aria-hidden="true" className="mx-auto mb-2 text-fitx-text-disabled" />
        <p className="text-sm font-medium text-fitx-text">{title}</p>
        <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">{detail}</p>
      </div>
    </figure>
  );
}

/** A placeholder with the player's shape while its media loads. */
export function ExerciseDemoSkeleton() {
  return (
    <div role="status" className="aspect-[4/3] animate-pulse rounded-xl border border-fitx-border bg-fitx-surface-variant sm:aspect-[16/10]">
      <span className="sr-only">Loading exercise photos</span>
    </div>
  );
}
