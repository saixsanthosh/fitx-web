import Link from "next/link";
import { ChevronRight, Dumbbell } from "lucide-react";
import { formatActivityDate, formatDuration } from "@/lib/activity/format";
import type { StrengthSession } from "@/lib/activity/strength";

const kg = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** A completed strength session in the Activity timeline; opens the session's record. */
export function StrengthRow({ session }: { session: StrengthSession }) {
  return (
    <li>
      <Link href={`/workouts/history/${session.id}`} className="group flex min-h-20 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-card p-3 transition-colors hover:border-fitx-primary/40 sm:gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant sm:h-16 sm:w-16">
          <Dumbbell size={22} aria-hidden="true" className="text-fitx-text-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-fitx-text-secondary"><Dumbbell size={13} aria-hidden="true" />Strength · {formatActivityDate(session.startedAt)}</p>
          <p className="mt-0.5 truncate font-semibold text-fitx-text">{session.name}</p>
          <p className="mt-0.5 text-xs tabular-nums text-fitx-text-secondary">
            {formatDuration(session.trainingSeconds)} training{session.volumeKg !== null ? ` · ${kg.format(session.volumeKg)} kg lifted` : ""}
          </p>
        </div>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fitx-text-disabled group-hover:text-fitx-primary" />
      </Link>
    </li>
  );
}
