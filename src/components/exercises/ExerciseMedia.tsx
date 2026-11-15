"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Dumbbell } from "lucide-react";

const SOURCE_REVISION = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const SOURCE_PREFIX = "free-exercise-db-";

export function exerciseFrameUrl(exerciseId: string, frame: number) {
  const sourceId = exerciseId.startsWith(SOURCE_PREFIX) ? exerciseId.slice(SOURCE_PREFIX.length) : "";
  if (!sourceId || !/^[a-zA-Z0-9_-]+$/.test(sourceId)) return null;
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${SOURCE_REVISION}/exercises/${encodeURIComponent(sourceId)}/${frame}.jpg`;
}

export function ExerciseThumbnail({ exerciseId, name }: { exerciseId: string; name: string }) {
  const [unavailable, setUnavailable] = useState(false);
  const src = exerciseFrameUrl(exerciseId, 0);

  if (!src || unavailable) return <ExerciseMediaFallback label={`${name} visual unavailable`} />;
  return (
    <div className="relative h-full w-full overflow-hidden bg-fitx-surface-variant">
      <Image
        src={src}
        alt={`${name} movement reference`}
        fill
        sizes="(max-width: 640px) 46vw, (max-width: 1280px) 30vw, 24vw"
        className="object-cover transition-transform duration-500 group-hover:scale-[1.025]"
        onError={() => setUnavailable(true)}
      />
      <span className="absolute bottom-2 left-2 rounded-sm bg-black/65 px-2 py-1 text-[9px] font-semibold uppercase tracking-[.12em] text-white">Reference frame</span>
    </div>
  );
}

export function ExerciseMovementFrames({ exerciseId, name }: { exerciseId: string; name: string }) {
  const [frame, setFrame] = useState(0);
  const [failedFrames, setFailedFrames] = useState<number[]>([]);
  const availableFrames = [0, 1].filter((value) => !failedFrames.includes(value));
  const activeFrame = availableFrames[Math.min(frame, availableFrames.length - 1)];
  const src = activeFrame === undefined ? null : exerciseFrameUrl(exerciseId, activeFrame);

  if (activeFrame === undefined || !src) return <ExerciseMediaFallback label="No verified movement frames are available for this exercise." />;

  return (
    <figure className="overflow-hidden rounded-xl border border-fitx-border bg-fitx-surface">
      <div className="relative aspect-[4/3] bg-fitx-surface-variant sm:aspect-[16/10]">
        <Image
          key={src}
          src={src}
          alt={`${name}, reference frame ${activeFrame + 1} of 2`}
          fill
          sizes="(max-width: 768px) 100vw, 760px"
          className="object-contain p-2 sm:p-4"
          onError={() => setFailedFrames((current) => [...new Set([...current, activeFrame])])}
        />
      </div>
      <figcaption className="flex min-h-12 items-center justify-between gap-3 border-t border-fitx-border px-3 py-2.5 text-xs text-fitx-text-secondary sm:px-4">
        <span>Still movement reference · frame {activeFrame + 1} of 2</span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={frame <= 0} onClick={() => setFrame((value) => Math.max(0, value - 1))} className="grid h-9 w-9 place-items-center rounded-md border border-fitx-border disabled:opacity-40" aria-label="Previous movement frame"><ArrowLeft size={15} /></button>
          <button type="button" disabled={frame >= availableFrames.length - 1} onClick={() => setFrame((value) => Math.min(availableFrames.length - 1, value + 1))} className="grid h-9 w-9 place-items-center rounded-md border border-fitx-border disabled:opacity-40" aria-label="Next movement frame"><ArrowRight size={15} /></button>
        </span>
      </figcaption>
    </figure>
  );
}

function ExerciseMediaFallback({ label }: { label: string }) {
  return <div className="grid h-full min-h-36 place-items-center bg-fitx-surface-variant px-4 text-center text-fitx-text-disabled"><div><Dumbbell className="mx-auto mb-2 opacity-65" size={25} /><span className="text-xs">{label}</span></div></div>;
}
