"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Dumbbell } from "lucide-react";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import {
  FREE_EXERCISE_DB_PHOTO_COUNT,
  freeExerciseDbRef,
  isOptimizableImageUrl,
  PHOTO_STAND_INS,
  pinnedPhotoUrl,
  resolveExerciseMedia,
  type ExerciseMedia,
  type ExerciseMediaRow,
} from "@/lib/training/media";
import { ExerciseDemoPlayer, ExerciseDemoSkeleton } from "./ExerciseDemoPlayer";
import { loadExerciseMediaRows } from "./media-loader";

/** The pinned Free Exercise DB photo `frame` (0 or 1) for a `free-exercise-db-` id or a photo stand-in, else null. */
export function exerciseFrameUrl(exerciseId: string, frame: number) {
  const ref = freeExerciseDbRef(exerciseId) ?? PHOTO_STAND_INS[exerciseId]?.ref ?? null;
  return ref && Number.isInteger(frame) && frame >= 0 && frame < FREE_EXERCISE_DB_PHOTO_COUNT ? pinnedPhotoUrl(ref, frame) : null;
}

/**
 * The first photo of an exercise, filling its (relatively positioned) box. `src` is the thumbnail
 * from GET /api/exercises (null: the exercise has none); without it the pinned photo is used.
 */
export function ExerciseThumbnail({ exerciseId, name, src }: { exerciseId: string; name: string; src?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = src === undefined ? exerciseFrameUrl(exerciseId, 0) : src;

  if (!url || failedUrl === url) return <ThumbnailFallback name={name} />;
  return (
    <div className="relative h-full w-full overflow-hidden bg-fitx-surface-variant">
      <Image
        src={url}
        alt={`${name}, photo`}
        fill
        sizes="(max-width: 640px) 92vw, (max-width: 1280px) 46vw, 30vw"
        unoptimized={!isOptimizableImageUrl(url, SUPABASE_URL)}
        className="object-cover transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        onError={() => setFailedUrl(url)}
      />
      <span className="absolute bottom-2 left-2 rounded-sm bg-fitx-scrim/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[.12em] text-fitx-on-inverse">Photo</span>
    </div>
  );
}

/**
 * An exercise's photos (or, once they exist, its demonstration loop), as on the live workout page.
 * Loads the exercise's media rows itself; pass `media` when the caller already has them.
 */
export function ExerciseMovementFrames({ exerciseId, name, media }: { exerciseId: string; name: string; media?: ExerciseMedia }) {
  const loaded = useExerciseMedia(media ? null : exerciseId, name);
  const resolved = media ?? loaded;
  if (!resolved) return <ExerciseDemoSkeleton />;
  return <ExerciseDemoPlayer key={exerciseId} media={resolved} name={name} />;
}

/**
 * Loads and resolves one exercise's media with the browser client. Null while loading; when the
 * media table or the database cannot be read it resolves to the pinned photos (or none).
 */
export function useExerciseMedia(exerciseId: string | null, name: string): ExerciseMedia | null {
  const [loaded, setLoaded] = useState<{ id: string; rows: ExerciseMediaRow[] | null; sourceRef: string | null } | null>(null);

  useEffect(() => {
    if (!exerciseId) return;
    let active = true;
    void loadExerciseMediaRows(createClient(), exerciseId).then((result) => {
      if (active) setLoaded({ id: exerciseId, ...result });
    });
    return () => { active = false; };
  }, [exerciseId]);

  return useMemo(() => (exerciseId && loaded?.id === exerciseId
    ? resolveExerciseMedia({ exerciseId, name, sourceRef: loaded.sourceRef, rows: loaded.rows, supabaseUrl: SUPABASE_URL })
    : null), [exerciseId, loaded, name]);
}

function ThumbnailFallback({ name }: { name: string }) {
  return (
    <div className="grid h-full min-h-36 place-items-center bg-fitx-surface-variant px-4 text-center text-fitx-text-disabled">
      <div>
        <Dumbbell className="mx-auto mb-2 opacity-65" size={25} aria-hidden="true" />
        <span className="text-xs">No photo for {name} yet</span>
      </div>
    </div>
  );
}
