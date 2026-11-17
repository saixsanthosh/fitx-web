"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Dumbbell } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { getSession } from "@/components/tasks/session";
import { Tabs } from "@/components/ui/Tabs";
import { shareLabel } from "@/components/widgets/MusclesWidget";
import { useOptionalResource, useResource, useToday } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { BODY_REGIONS, REGIONS, listRegions, regionInView, type RegionKey } from "@/lib/training/anatomy";
import {
  MUSCLE_PERIODS, MUSCLE_PERIOD_LABELS, loadMuscleHistory, musclePeriodRange, summariseMuscles,
  type LoggedSession, type MusclePeriod, type MuscleSummary, type RegionHistory,
} from "@/lib/training/muscle-history";
import styles from "./Muscles.module.css";

type View = "both" | "front" | "back";
type History = { sessions: LoggedSession[]; truncated: boolean };

const VIEWS: ReadonlyArray<[View, string]> = [["front", "Front"], ["back", "Back"], ["both", "Both"]];
const EMPTY_PERIOD: Record<MusclePeriod, string> = { today: "today", week: "this week", four_weeks: "in the last 4 weeks", all: "yet" };
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const dayLabel = (key: string) => keyToLocalDate(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

async function loadHistory(since: Date | null): Promise<History> {
  const { db, userId } = await getSession();
  const result = await loadMuscleHistory(db, userId, since ? { since, maxSessions: 300 } : { maxSessions: 1000 });
  if (result.error) throw result.error;
  return { sessions: result.sessions, truncated: result.truncated };
}

/**
 * Muscle analytics (reference 11, in FITX's own design): the body map coloured by each muscle's share of the
 * period's logged work, the share list with direct and assisting sets, and for a chosen muscle the exercises
 * and workouts behind it. Counting follows contract C3 (src/lib/training/muscle-history.ts).
 */
export function MuscleAnalytics({ initialPeriod, initialMuscle }: { initialPeriod: MusclePeriod; initialMuscle: RegionKey | null }) {
  const today = useToday();
  const [period, setPeriod] = useState<MusclePeriod>(initialPeriod);
  const [muscle, setMuscle] = useState<RegionKey | null>(initialMuscle);
  const [view, setView] = useState<View>("both");
  const [wantAll, setWantAll] = useState(initialPeriod === "all");

  // Today, this week and the last 4 weeks come from one request; all time is read when first opened.
  const recentSince = useMemo(() => (today ? musclePeriodRange("four_weeks", keyToLocalDate(today)).start : null), [today]);
  const loadRecent = useCallback(() => (recentSince ? loadHistory(recentSince) : new Promise<History>(() => undefined)), [recentSince]);
  const loadAll = useCallback(() => loadHistory(null), []);
  const recent = useResource(loadRecent, "Your workouts could not be loaded.");
  const all = useOptionalResource(loadAll, wantAll, "Your workouts could not be loaded.");

  useEffect(() => {
    const query = new URLSearchParams({ period });
    if (muscle) query.set("muscle", muscle);
    window.history.replaceState(window.history.state, "", `/progress/muscles?${query.toString()}`);
  }, [period, muscle]);

  const summaries = useMemo(() => {
    if (!today) return null;
    const now = keyToLocalDate(today);
    const result: Partial<Record<MusclePeriod, MuscleSummary>> = {};
    if (recent.data) for (const key of ["today", "week", "four_weeks"] as const) result[key] = summariseMuscles(recent.data.sessions, musclePeriodRange(key, now));
    if (all.data) result.all = summariseMuscles(all.data.sessions, musclePeriodRange("all", now));
    return result;
  }, [today, recent.data, all.data]);

  function choosePeriod(next: string) {
    const value = MUSCLE_PERIODS.find((item) => item === next);
    if (!value) return;
    if (value === "all") setWantAll(true);
    setPeriod(value);
  }

  const toggle = (region: RegionKey) => setMuscle((current) => (current === region ? null : region));

  const panel = (key: MusclePeriod) => {
    const source = key === "all" ? all : recent;
    const summary = summaries?.[key];
    if (!summary) {
      return source.status === "error" && !source.data
        ? <WidgetError message={source.error} onRetry={source.reload} />
        : <div className={styles.loading} aria-busy="true" aria-label="Loading your muscles" />;
    }
    return <PeriodView period={key} summary={summary} truncated={key === "all" && Boolean(all.data?.truncated)} muscle={muscle} onSelect={toggle} view={view} onView={setView} />;
  };

  return (
    <div className={styles.page}>
      <Link href="/progress" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Progress</Link>
      <PageHeading title="Muscles" description="Which muscles your logged sets worked, from each exercise's listed primary and secondary muscles." />
      <Tabs
        label="Period"
        value={period}
        onChange={choosePeriod}
        tabs={MUSCLE_PERIODS.map((key) => ({ id: key, label: MUSCLE_PERIOD_LABELS[key], content: panel(key) }))}
      />
      <details className={styles.howCounted}>
        <summary>How this is counted</summary>
        <ul>
          <li>Only sets you ticked as done, with reps or seconds, in workouts you finished. Abandoned workouts, unticked sets, plans and exercise pages you only looked at never count.</li>
          <li>Each exercise&apos;s main muscle gets a direct set; the muscles it also lists get an assisting set. In the share, a direct set counts 1 and an assisting set counts half.</li>
          <li>The share is each muscle&apos;s part of the period&apos;s work, adding up to 100%. The colour on the map follows the same numbers, compared with your busiest muscle.</li>
          <li>Muscles come from the FITX exercise library. An exercise without listed muscles, or one no longer in the library, is named here rather than guessed.</li>
        </ul>
      </details>
    </div>
  );
}

export function PeriodView({ period, summary, truncated, muscle, onSelect, view, onView }: {
  period: MusclePeriod;
  summary: MuscleSummary;
  truncated: boolean;
  muscle: RegionKey | null;
  onSelect: (region: RegionKey) => void;
  view: View;
  onView: (view: View) => void;
}) {
  if (!summary.sets) {
    return (
      <EmptyState
        title={`No sets logged ${EMPTY_PERIOD[period]}`}
        description="Finish a workout with ticked sets and the muscles it worked show up here."
        action={<Link href="/workouts" className="fitx-button"><Dumbbell size={16} aria-hidden="true" />Go to workouts</Link>}
      />
    );
  }
  return <PeriodBody period={period} summary={summary} truncated={truncated} muscle={muscle} onSelect={onSelect} view={view} onView={onView} />;
}

function PeriodBody({ period, summary, truncated, muscle, onSelect, view, onView }: Parameters<typeof PeriodView>[0]) {
  const detail = useRef<HTMLDivElement | null>(null);
  const fromList = useRef(false);
  const levels = Object.fromEntries(BODY_REGIONS.map((region) => [region, summary.regions[region].level])) as Record<RegionKey, number>;
  const untrained = BODY_REGIONS.filter((region) => summary.regions[region].load === 0);
  const selected = muscle ? summary.regions[muscle] : null;
  const hiddenSelection = muscle && view !== "both" && !regionInView(muscle, view);

  // A muscle chosen in the list shows its detail, which can be out of view on a phone: bring it in, gently.
  useEffect(() => {
    if (!fromList.current || !muscle) return;
    fromList.current = false;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    detail.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [muscle]);

  return (
    <div className={styles.period}>
      <p className={styles.totals}>
        <strong>{plural(summary.sets, "set")}</strong> in {plural(summary.sessions, "workout")} · {plural(summary.ranked.length, "muscle")} worked
        {truncated ? " · your latest 1,000 workouts" : ""}
      </p>
      {summary.unmapped.exercises.length > 0 && (
        <p className={styles.unmapped}>
          {summary.unmapped.exercises.length === 1 ? "1 exercise isn't" : `${summary.unmapped.exercises.length} exercises aren't`} mapped to a muscle, so {plural(summary.unmapped.sets, "set")} {summary.unmapped.sets === 1 ? "is" : "are"} left out: {summary.unmapped.exercises.map((item) => item.name).join(", ")}.
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <div className={styles.viewToggle} role="group" aria-label="Body view">
            {VIEWS.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => onView(value)}>{label}</button>)}
          </div>
          <BodyMap title="Choose a muscle" view={view} levels={levels} selected={muscle} onSelect={onSelect} size="lg" legend />
          {hiddenSelection ? <p className={styles.mapNote}>{REGIONS[muscle].label} is on the {view === "front" ? "back" : "front"} of the body.</p> : null}
        </div>
        <div className={styles.listColumn}>
          <h2 className={styles.listTitle}>Share of the work</h2>
          <ol className={styles.shares}>
            {summary.ranked.map((region) => (
              <li key={region.region}>
                <button type="button" className={styles.share} aria-pressed={muscle === region.region} onClick={() => { fromList.current = true; onSelect(region.region); }}>
                  <span className={styles.shareTop}>
                    <span className={styles.shareName}>{region.label}</span>
                    <strong className={styles.shareValue}>{shareLabel(region.share)}</strong>
                  </span>
                  <span className={styles.shareTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round(region.level * 100))}%` }} /></span>
                  <span className={styles.shareSets}>{plural(region.primarySets, "direct set")} · {region.secondarySets} assisting</span>
                </button>
              </li>
            ))}
          </ol>
          {untrained.length > 0 && <p className={styles.untrained}>Not worked {EMPTY_PERIOD[period]}: {listRegions(untrained)}.</p>}
        </div>
        {/* After the map on phones (where a tap on the map lands), under it on wide screens. */}
        <div ref={detail} className={styles.detailSlot}>
          {muscle && selected ? <MuscleDetail region={selected} /> : <p className={styles.pickHint}>Choose a muscle on the map or in the list to see the exercises and workouts behind it.</p>}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{selected ? `${selected.label}: ${plural(selected.primarySets, "direct set")}, ${selected.secondarySets} assisting, ${shareLabel(selected.share)} of the work.` : ""}</p>
    </div>
  );
}

function MuscleDetail({ region }: { region: RegionHistory }) {
  const label = region.label;
  const titleId = useId();
  return (
    <section className={styles.detail} aria-labelledby={titleId}>
      <div className={styles.detailHead}>
        <h2 id={titleId} className={styles.detailTitle}>{label}</h2>
        <Link href={`/exercises?muscle=${region.region}`} className={styles.textLink}>Find {label.toLowerCase()} exercises<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      {region.load === 0 ? (
        <p className={styles.detailNote}>No sets worked your {label.toLowerCase()} in this period.</p>
      ) : (
        <>
          <dl className={styles.detailNumbers}>
            <div><dt>Direct sets</dt><dd>{region.primarySets}</dd></div>
            <div><dt>Assisting sets</dt><dd>{region.secondarySets}</dd></div>
            <div><dt>Workouts</dt><dd>{region.sessions}</dd></div>
            <div><dt>Last trained</dt><dd>{region.lastTrainedOn ? dayLabel(region.lastTrainedOn) : "—"}</dd></div>
          </dl>
          <div className={styles.detailLists}>
            <div>
              <h3 className={styles.detailSubtitle}>Exercises behind it</h3>
              <ul className={styles.rows}>
                {region.exercises.map((exercise) => (
                  <li key={`${exercise.id}-${exercise.role}`}>
                    <Link href={`/exercises/${encodeURIComponent(exercise.id)}`} className={styles.row}>
                      <span className={styles.rowText}><strong>{exercise.name}</strong><span>{plural(exercise.sets, "set")} · {exercise.role === "primary" ? "main muscle" : "assisting"}</span></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className={styles.detailSubtitle}>Workouts</h3>
              <ul className={styles.rows}>
                {region.sessionList.map((session) => (
                  <li key={session.id}>
                    <Link href={`/workouts/history/${session.id}`} className={styles.row}>
                      <span className={styles.rowText}><strong>{session.name}</strong><span>{dateLabel(session.startedAt)} · {session.primarySets} direct · {session.secondarySets} assisting</span></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
