"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Medal, Trophy } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { SPORT_INFO } from "@/lib/activity/config";
import { effortName, effortRank, effortTable, topEfforts, type BestEffort, type RankedEffort } from "@/lib/activity/best-efforts";
import { formatActivityDate, formatDuration, paceValue, speedValue } from "@/lib/activity/format";
import type { StoredEfforts } from "@/lib/activity/repository";
import { SPORTS, type Sport } from "@/lib/activity/types";
import { cn } from "@/lib/utils";
import type { EffortsState } from "./useActivityV2";

const RANK_TEXT = { 1: "PR", 2: "2nd", 3: "3rd" } as const;
const TABLE_LABEL: Record<string, string> = { run: "Running", walk: "Walking and hiking" };
const tableLabel = (table: string) => TABLE_LABEL[table] ?? SPORT_INFO[table as Sport]?.plural ?? table;

/** "4:12 /km" or "28.4 km/h": the effort's average, in the way its sport reads. */
function effortAverage(effort: BestEffort, sport: Sport) {
  return SPORT_INFO[sport].pace ? `${paceValue(effort.s / (effort.d / 1000))} /km` : `${speedValue(effort.d / effort.s)} km/h`;
}

function RankBadge({ rank }: { rank: 1 | 2 | 3 }) {
  return (
    <span className={cn("inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-[11px] font-bold tabular-nums", rank === 1 ? "bg-fitx-primary text-fitx-on-primary" : "bg-fitx-surface-variant text-fitx-text")}>
      {rank === 1 ? <Trophy size={11} aria-hidden="true" /> : <Medal size={11} aria-hidden="true" />}
      {RANK_TEXT[rank]}
    </span>
  );
}

/**
 * This activity's best efforts (from its replayed points), each with its rank among the member's stored efforts.
 * The ranking counts this activity too even before its efforts are stored.
 */
export function ActivityEffortsPanel({ activityId, sport, startedAt, efforts, stored }: { activityId: string | null; sport: Sport; startedAt: number; efforts: readonly BestEffort[]; stored: EffortsState }) {
  const top = useMemo(() => {
    if (stored.status !== "ready" || !activityId) return null;
    const rows = [...stored.rows.filter((row) => row.id !== activityId), { id: activityId, sport, startedAt, efforts: [...efforts] }];
    return topEfforts(rows, effortTable(sport));
  }, [stored, activityId, sport, startedAt, efforts]);
  if (!efforts.length) return null;
  return (
    <section aria-labelledby="efforts-title" className="rounded-2xl border border-fitx-border bg-fitx-card p-4 sm:p-5">
      <h2 id="efforts-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><Trophy size={16} aria-hidden="true" className="text-fitx-primary" />Best efforts</h2>
      <ul className="mt-3 divide-y divide-fitx-divider">
        {efforts.map((effort) => {
          const rank = top && activityId ? effortRank(top, activityId, effort.d) : null;
          return (
            <li key={effort.d} className="flex min-h-12 items-center justify-between gap-3 py-2">
              <span className="text-sm font-medium text-fitx-text">{effortName(effort.d)}</span>
              <span className="flex items-center gap-3">
                {rank && <RankBadge rank={rank} />}
                <span className="text-xs tabular-nums text-fitx-text-secondary">{effortAverage(effort, sport)}</span>
                <span className="min-w-16 text-right font-heading text-base font-bold tabular-nums text-fitx-text">{formatDuration(effort.s)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">The fastest stretch of each distance in this activity, timed like a race clock: pauses inside it count.</p>
    </section>
  );
}

/** The member's best efforts across activities: the record and runners-up per distance, one table per sport kind. */
export function BestEffortsOverview({ state, only }: { state: EffortsState; only?: Sport }) {
  const tables = useMemo(() => {
    if (state.status !== "ready") return [];
    const rows: StoredEfforts[] = only ? state.rows.filter((row) => effortTable(row.sport) === effortTable(only)) : state.rows;
    const names = [...new Set(SPORTS.filter((sport) => rows.some((row) => row.sport === sport)).map(effortTable))];
    return names.map((name) => ({ name, top: topEfforts(rows, name) })).filter((table) => table.top.size > 0);
  }, [state, only]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!tables.length) return null;
  const current = tables.find((table) => table.name === picked) ?? tables[0];

  return (
    <section aria-labelledby="best-efforts-title" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="best-efforts-title" className="flex items-center gap-2 font-heading text-lg font-bold tracking-[-.02em] text-fitx-text"><Trophy size={18} aria-hidden="true" className="text-fitx-primary" />Best efforts</h2>
        {tables.length > 1 && (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Segmented options={tables.map((table) => ({ value: table.name, label: tableLabel(table.name) }))} value={current.name} onChange={setPicked} label="Best efforts for" />
          </div>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {[...current.top].map(([distance, ranked]) => <EffortRow key={distance} distance={distance} ranked={ranked} />)}
      </ul>
      <p className="text-xs leading-5 text-fitx-text-secondary">From activities recorded or imported since best efforts arrived, and older ones once you open them. Elapsed time, like a race clock.</p>
    </section>
  );
}

function EffortRow({ distance, ranked }: { distance: number; ranked: RankedEffort[] }) {
  const [best, ...rest] = ranked;
  return (
    <li className="rounded-2xl border border-fitx-border bg-fitx-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fitx-text">{effortName(distance)}</span>
        <span className="font-heading text-2xl font-bold tabular-nums tracking-[-.03em] text-fitx-text">{formatDuration(best.s)}</span>
      </div>
      <Link href={`/activity/${best.activityId}`} className="mt-1 flex min-h-11 items-center justify-between gap-2 text-xs text-fitx-text-secondary hover:text-fitx-text">
        <span className="truncate">{formatActivityDate(best.startedAt)}</span>
        <span className="tabular-nums">{effortAverage(best, best.sport)}</span>
      </Link>
      {rest.length > 0 && (
        <ol className="mt-1 space-y-1 border-t border-fitx-divider pt-2 text-xs text-fitx-text-secondary" aria-label={`Next best ${effortName(distance)}`}>
          {rest.map((effort, index) => (
            <li key={effort.activityId}>
              <Link href={`/activity/${effort.activityId}`} className="flex min-h-11 items-center justify-between gap-2 hover:text-fitx-text">
                <span>{index === 0 ? "2nd" : "3rd"} · {formatActivityDate(effort.startedAt)}</span>
                <span className="tabular-nums">{formatDuration(effort.s)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
