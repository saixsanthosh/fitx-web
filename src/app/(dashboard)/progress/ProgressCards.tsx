"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { getSession, messageFor } from "@/components/tasks/session";
import { BODY_REGIONS, type RegionKey } from "@/lib/training/anatomy";
import type { MuscleSummary } from "@/lib/training/muscle-history";
import styles from "./Progress.module.css";

const SHOWN = 6;
const kg = (value: number) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** The muscle map, as one link: this week's map in miniature and the muscles worked most. */
export function MuscleMapLink({ summary }: { summary: MuscleSummary | null }) {
  const levels = summary ? (Object.fromEntries(BODY_REGIONS.map((region) => [region, summary.regions[region].level])) as Record<RegionKey, number>) : undefined;
  const top = summary?.ranked.slice(0, 3).map((region) => region.label) ?? [];
  return (
    <Link href="/progress/muscles?period=week" className={styles.mapLink}>
      <span className={styles.mapThumb} aria-hidden="true">
        <BodyMap title="Muscle map" levels={levels} size="sm" />
      </span>
      <span className={styles.mapText}>
        <strong>Muscle map</strong>
        <span>{summary === null ? "Loading this week…" : top.length ? `This week: ${top.join(", ")}` : "No sets logged this week"}</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" className={styles.mapArrow} />
    </Link>
  );
}

type RecordRow = { id: string; exercise_name: string; best_weight_kg: number | null; best_reps: number | null; estimated_one_rep_max: number | null; achieved_at: string };

/** Best sets from completed workouts. The one-rep max is worked out from them, so it is labelled as an estimate. */
export function RecordsSection() {
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    try {
      const { db, userId } = await getSession();
      const result = await db.from("personal_records").select("id,exercise_name,best_weight_kg,best_reps,estimated_one_rep_max,achieved_at")
        .eq("user_id", userId).order("estimated_one_rep_max", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      setRecords((result.data ?? []) as RecordRow[]);
      setError("");
    } catch (failure) {
      setError(messageFor(failure, "Your personal records could not be loaded."));
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const shown = records ? (all ? records : records.slice(0, SHOWN)) : [];

  return (
    <section aria-labelledby="records-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="records-title" className={styles.panelTitle}><Trophy size={17} aria-hidden="true" />Personal records</h2>
        {records?.length ? <span className={styles.panelNote}>1RM ≈ estimate from your best set</span> : null}
      </div>
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error} <button type="button" className="fitx-alert-action" onClick={() => void load()}>Try again</button></p>
        : records === null ? <div className={styles.loading} aria-busy="true" aria-label="Loading your personal records" />
          : records.length ? (
            <>
              <ol className={styles.records}>
                {shown.map((record, index) => {
                  const weight = record.best_weight_kg === null ? null : Number(record.best_weight_kg);
                  const reps = record.best_reps === null ? null : Number(record.best_reps);
                  const oneRep = record.estimated_one_rep_max === null ? null : Number(record.estimated_one_rep_max);
                  return (
                    <li key={record.id}>
                      <span className={styles.rank}>{index + 1}</span>
                      <span className={styles.recordName}>
                        <strong>{record.exercise_name}</strong>
                        <span>{new Date(record.achieved_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                      </span>
                      <span className={styles.recordBest}>
                        <strong>{weight !== null && weight > 0 ? `${kg(weight)} kg` : "Bodyweight"}{reps !== null ? ` × ${reps}` : ""}</strong>
                        {oneRep !== null && oneRep > 0 ? <span>1RM ≈ {kg(oneRep)} kg <span className="sr-only">(estimate)</span></span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {records.length > SHOWN ? (
                <button type="button" className={styles.moreButton} aria-expanded={all} onClick={() => setAll((value) => !value)}>
                  {all ? "Show fewer" : `Show all ${records.length}`}
                </button>
              ) : null}
            </>
          ) : (
            <div className={styles.empty}>
              <strong>No records yet</strong>
              <p>Finish a workout with weights and reps.</p>
            </div>
          )}
    </section>
  );
}
