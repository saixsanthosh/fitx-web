import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { formatActivityDate, formatDuration } from "@/lib/activity/format";
import type { StrengthSession } from "@/lib/activity/strength";

const kg = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** A completed strength session in the Activity feed; opens the session's record. */
export function StrengthRow({ session }: { session: StrengthSession }) {
  return (
    <li>
      <Link href={`/workouts/history/${session.id}`} className="group block rounded-2xl border border-fitx-border bg-fitx-card p-4 transition-colors hover:border-fitx-primary/40 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fitx-surface-variant text-fitx-text-secondary" aria-hidden="true"><Dumbbell size={19} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fitx-text-secondary">Strength · {formatActivityDate(session.startedAt)}</p>
            <p className="mt-0.5 truncate font-heading text-[17px] font-bold tracking-[-.02em] text-fitx-text group-hover:text-fitx-primary-text">{session.name}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-[11px] text-fitx-text-secondary">Training</dt>
            <dd className="mt-0.5 font-heading text-lg font-bold tabular-nums text-fitx-text sm:text-xl">{formatDuration(session.trainingSeconds)}</dd>
          </div>
          {session.volumeKg !== null && (
            <div className="col-span-2">
              <dt className="text-[11px] text-fitx-text-secondary">Lifted</dt>
              <dd className="mt-0.5 font-heading text-lg font-bold tabular-nums text-fitx-text sm:text-xl">{kg.format(session.volumeKg)}<span className="font-body text-xs font-medium text-fitx-text-secondary">{"\u00a0kg"}</span></dd>
            </div>
          )}
        </dl>
      </Link>
    </li>
  );
}
