"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ImageOff, Repeat, RotateCcw } from "lucide-react";
import { demoModelsFor, mediaCreditLines, withDemoMedia, type DemoModelKey, type ExerciseMedia, type MediaItem } from "@/lib/training/media";
import { chooseDemoModel, useDemoIndexData, useDemoModel } from "@/lib/training/use-demo-model";
import { DemoLoop } from "./DemoLoop";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

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
 * Shows an exercise's demonstration: a muted video loop when a verified one exists (none do yet), else its two frames
 * played as a looping demonstration (DemoLoop): FITX's AI demonstration for the member's model when the demonstration
 * index has one (pass `exerciseId`), else the real photos, each clearly labelled, with no verified video. A
 * demonstration frame that fails to load gives way to the real photos (the whole pair, so one loop never mixes people).
 * `layout`:
 *  - "single" (default: the live workout and sheets): the compact player.
 *  - "sequence" (the exercise page): the full player with its caption.
 * `model` is the member's model when the page already knows it; otherwise the page's one setup read decides.
 * Give it a `key` per exercise.
 */
export function ExerciseDemoPlayer({ media: given, name, layout = "single", exerciseId, model: preferred }: {
  media: ExerciseMedia;
  name: string;
  layout?: "single" | "sequence";
  /** The exercise's id, so its demonstrations (public/media/demos/index.json) can be shown. */
  exerciseId?: string;
  model?: DemoModelKey | null;
}) {
  const [failedVideos, setFailedVideos] = useState<string[]>([]);
  // A choice that could not be saved still applies on this page; the member is told it will not last.
  const [unsaved, setUnsaved] = useState(false);
  const choice = useRef(0);
  const demoIndex = useDemoIndexData();
  const model = useDemoModel(preferred);
  // Once an AI demonstration frame fails to load, the exercise's own photos (dropped while the demonstration shows) return.
  const [demoFailed, setDemoFailed] = useState(false);
  const index = demoFailed ? null : demoIndex;
  const media = exerciseId ? withDemoMedia(given, { exerciseId, name, index, model }) : given;
  const models = exerciseId ? demoModelsFor(index, exerciseId) : [];
  const shownModel = media.stills.find((still) => still.aiDemo)?.model ?? null;
  const video = media.videos.find((item) => !failedVideos.includes(item.url));
  const changeModel = (next: DemoModelKey) => {
    const mine = ++choice.current;
    setUnsaved(false);
    void chooseDemoModel(next).then(({ stored }) => { if (mine === choice.current) setUnsaved(!stored); });
  };
  // One wrapper, so a parent's space-y spacing applies (the figures inside reset their own margins).
  return (
    <div className="min-w-0">
      {video ? (
        <VideoLoop key={video.url} video={video} poster={media.stills[0] ?? null} name={name}
          onError={() => setFailedVideos((current) => (current.includes(video.url) ? current : [...current, video.url]))} />
      ) : !media.stills.length ? (
        <MediaUnavailable failed={demoFailed} demonstration={layout === "sequence"} />
      ) : (
        // Not keyed by model: switching person keeps the same DemoLoop (and the focused radio), only the frames change.
        <DemoLoop stills={media.stills} name={name} size={layout === "single" ? "compact" : "full"}
          models={models} model={shownModel} onModelChange={changeModel}
          onStillError={(still) => { if (still.aiDemo) setDemoFailed(true); }}
          whenEmpty={<MediaUnavailable failed demonstration={layout === "sequence"} />} />
      )}
      {models.length > 1 && (
        <p role="status" className={unsaved ? "m-0 mt-2 text-xs leading-5 text-fitx-text-secondary" : "sr-only"}>
          {unsaved ? "Your choice could not be saved, so it applies on this page only." : ""}
        </p>
      )}
    </div>
  );
}

function VideoLoop({ video, poster, name, onError }: { video: MediaItem; poster: MediaItem | null; name: string; onError: () => void }) {
  const reducedMotion = usePrefersReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const [loop, setLoop] = useState(true);

  // A muted loop starts on its own unless the device asks for reduced motion; the controls can always pause it.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reducedMotion) element.pause();
    else void element.play().catch(() => undefined);
  }, [reducedMotion]);

  const replay = () => {
    const element = ref.current;
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  };
  const credits = mediaCreditLines(poster ? [video, poster] : [video]);
  return (
    <figure className="m-0">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[1.25rem] border border-fitx-border bg-fitx-surface-variant sm:aspect-[16/10]">
        <video ref={ref} src={video.url} poster={poster?.url} muted loop={loop} playsInline controls preload="metadata"
          aria-label={video.alt || `${name}, demonstration video`} onError={onError} className="h-full w-full object-contain" />
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button type="button" onClick={replay} aria-label="Replay demonstration" className="grid h-11 w-11 place-items-center rounded-full border border-fitx-border bg-fitx-surface text-fitx-text hover:bg-fitx-hover">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-pressed={loop} aria-label="Loop" onClick={() => setLoop((value) => !value)}
          className={`grid h-11 w-11 place-items-center rounded-full border ${loop ? "border-fitx-primary text-fitx-primary-text" : "border-fitx-border text-fitx-text"} bg-fitx-surface hover:bg-fitx-hover`}>
          <Repeat size={16} aria-hidden="true" />
        </button>
      </div>
      <figcaption className="mt-2 text-xs leading-5 text-fitx-text-secondary">
        {video.caption && <span className="block">{video.caption}</span>}
        <span className="block">Demonstration video, muted{reducedMotion ? ". Press play to watch it." : "."}</span>
        {credits.map((line) => <span key={line} className="block text-[11px] text-fitx-text-disabled">{line}</span>)}
      </figcaption>
    </figure>
  );
}

function MediaUnavailable({ failed, demonstration = false }: { failed: boolean; demonstration?: boolean }) {
  const title = failed ? "The photos could not be loaded" : "No photo or video yet";
  const detail = failed ? "Check your connection and reload the page." : "There is no verified photo or video of this exact movement yet, so follow the written steps.";
  return (
    <figure className={`m-0 grid place-items-center rounded-[1.25rem] border border-dashed border-fitx-border bg-fitx-surface-variant px-5 text-center ${demonstration ? "min-h-44 py-8" : "min-h-36 py-6"}`}>
      <div className="max-w-sm">
        <ImageOff size={24} aria-hidden="true" className="mx-auto mb-2 text-fitx-text-disabled" />
        <p className="m-0 text-sm font-medium text-fitx-text">{title}</p>
        <p className="m-0 mt-1 text-xs leading-5 text-fitx-text-secondary">{detail}</p>
      </div>
    </figure>
  );
}

/** A placeholder with the player's shape while its media loads. */
export function ExerciseDemoSkeleton() {
  return (
    <div role="status" className="aspect-[4/3] animate-pulse rounded-[1.25rem] border border-fitx-border bg-fitx-surface-variant motion-reduce:animate-none sm:aspect-[16/10]">
      <span className="sr-only">Loading exercise photos</span>
    </div>
  );
}
