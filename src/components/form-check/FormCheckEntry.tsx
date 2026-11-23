import Image from "next/image";
import Link from "next/link";
import { useId } from "react";
import { ArrowUpRight, ScanLine } from "lucide-react";
import { HOMEWORKOUT1_MEDIA } from "@/data/home-workout-1-media";
import { formCheckHref } from "@/lib/home-workout/route";
import { cn } from "@/lib/utils";
import styles from "./FormCheckEntry.module.css";

export interface FormCheckEntryProps {
  /** "card": one compact card (the Home mode of Workouts); "inline": a small chip (a supported exercise's row). */
  variant: "card" | "inline";
  /** A camera rule id or an exercise_library id. The entry renders nothing when the camera can't analyse it. */
  exerciseId?: string;
  className?: string;
}

/**
 * The way into AI Form Check from other pages. Always named "AI Form Check" for assistive technology;
 * it links to /workouts/form-check, opened on the exercise when one is given.
 */
export function FormCheckEntry({ variant, exerciseId, className }: FormCheckEntryProps) {
  const lineId = useId();
  const href = formCheckHref(exerciseId);
  if (!href) return null;

  if (variant === "inline") {
    return (
      <Link
        href={href}
        prefetch={false}
        aria-label="AI Form Check"
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-fitx-border bg-fitx-surface px-3.5 text-sm font-medium text-fitx-text transition-colors hover:border-fitx-primary hover:text-fitx-primary-text",
          className,
        )}
      >
        <ScanLine size={15} className="text-fitx-primary" aria-hidden="true" />
        AI Form Check
      </Link>
    );
  }

  const poster = HOMEWORKOUT1_MEDIA.squat;
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label="AI Form Check"
      aria-describedby={lineId}
      className={cn(styles.card, "fitx-inverse group flex min-h-[88px] items-stretch overflow-hidden rounded-2xl border border-fitx-border bg-fitx-bg text-fitx-text", className)}
    >
      <span className="relative w-[84px] shrink-0 overflow-hidden sm:w-[104px]" aria-hidden="true">
        <Image src={poster.src} alt="" fill sizes="104px" placeholder="blur" blurDataURL={poster.blurDataURL} className={cn(styles.photo, "object-cover object-top")} />
        <span className={styles.scan} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-heading text-base font-bold tracking-tight">
            <ScanLine size={16} className="shrink-0 text-fitx-primary" aria-hidden="true" />
            AI Form Check
          </span>
          <span id={lineId} className="mt-0.5 block truncate text-xs text-fitx-text-secondary">Your camera counts reps and checks form</span>
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-fitx-border transition-colors group-hover:border-fitx-primary group-hover:text-fitx-primary" aria-hidden="true">
          <ArrowUpRight size={17} />
        </span>
      </span>
    </Link>
  );
}
