"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Scale } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { EmptyState } from "@/components/app/EmptyState";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { getSession, messageFor } from "@/components/tasks/session";
import { localDateKey } from "@/lib/domain/dates";
import { notifyUserContextChanged, syncProfileWeight } from "@/lib/domain/user-context";
import { WEIGHT_RANGE_KG, weightIn, weightText, weightToKg, weightUnitOf } from "@/lib/domain/weight-display";
import styles from "./Progress.module.css";

type Metric = { id: string; date: string; weight: number | null; body_fat: number | null; measurements: Record<string, number> };

const RANGES: ReadonlyArray<[number, string]> = [[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All"]];
const MEASUREMENTS = ["waist", "chest", "hips", "arm", "thigh", "neck"];
const dayLabel = (key: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, options);

/** Weigh-ins, body fat and tape measurements over time, and the form to log them. Weights show in the member's unit. */
export function BodySection() {
  const unit = weightUnitOf(useOptionalUserContext()?.data?.preferences.weight_unit);
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState(90);
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [measurementName, setMeasurementName] = useState("waist");
  const [measurement, setMeasurement] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [today] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const { db, userId } = await getSession();
      const result = await db.from("body_metrics").select("id,date,weight,body_fat,measurements").eq("user_id", userId)
        .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(365);
      if (result.error) throw result.error;
      setMetrics((result.data ?? []) as Metric[]);
      setError("");
    } catch (failure) {
      setError(messageFor(failure, "Your body measurements could not be loaded."));
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  // The newest logged values are shown as hints only, so saving one tape measurement never re-logs an old weight.
  const lastWeight = metrics?.find((row) => row.weight !== null)?.weight ?? null;
  const lastBodyFat = metrics?.find((row) => row.body_fat !== null)?.body_fat ?? null;
  const filtered = useMemo(() => {
    const rows = metrics ?? [];
    const kept = range === 0 ? rows : rows.filter((item) => (today.getTime() - new Date(`${item.date}T12:00:00`).getTime()) / 86_400_000 <= range);
    return kept.slice().reverse();
  }, [metrics, range, today]);
  const weights = filtered.filter((item) => item.weight !== null);
  const visible = filtered.filter((item) => item.weight !== null || item.body_fat !== null || Object.keys(item.measurements || {}).length > 0);

  async function save(event: FormEvent) {
    event.preventDefault();
    const typedWeight = weight.trim() ? Number(weight) : null;
    const parsedWeight = typedWeight === null ? null : Number.isFinite(typedWeight) ? weightToKg(typedWeight, unit) : Number.NaN;
    const parsedFat = bodyFat.trim() ? Number(bodyFat) : null;
    const parsedMeasurement = measurement.trim() ? Number(measurement) : null;
    if ((parsedWeight !== null && (!(parsedWeight >= WEIGHT_RANGE_KG.min) || parsedWeight > WEIGHT_RANGE_KG.max)) || (parsedFat !== null && (!(parsedFat >= 2) || parsedFat > 80)) || (parsedMeasurement !== null && (!(parsedMeasurement >= 10) || parsedMeasurement > 300))) {
      setFormError("Check your measurement values and try again.");
      return;
    }
    if (parsedWeight === null && parsedFat === null && parsedMeasurement === null) { setFormError("Enter at least one measurement to save."); return; }
    setSaving(true);
    setFormError("");
    try {
      const { db, userId } = await getSession();
      const values: Record<string, number> = {};
      if (parsedMeasurement !== null) values[measurementName] = parsedMeasurement;
      const result = await db.from("body_metrics").insert({ user_id: userId, date: localDateKey(), weight: parsedWeight, body_fat: parsedFat, measurements: values });
      if (result.error) throw result.error;
      // A new weigh-in is the current weight everywhere: the profile copy, targets and the header.
      if (parsedWeight !== null) { await syncProfileWeight(db, userId, parsedWeight); notifyUserContextChanged(); }
      setWeight(""); setBodyFat(""); setMeasurement("");
      await load();
    } catch (failure) {
      setFormError(messageFor(failure, "Your measurement could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.bodyLayout}>
      <section className={`fitx-panel ${styles.panel}`} aria-labelledby="body-title">
        <div className={styles.panelHead}>
          <div>
            <h2 id="body-title" className={styles.panelTitle}>Body measurements</h2>
            <p className={styles.panelNote}>Values you have added over time</p>
          </div>
          <div className={styles.rangeChips} role="group" aria-label="Time range">
            {RANGES.map(([value, label]) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}
          </div>
        </div>
        {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>
          : metrics === null ? <div className={styles.loadingBlock} aria-busy="true" aria-label="Loading your body measurements" />
            : (
              <>
                {weights.length >= 1 && (
                  <div className={styles.weightChart}>
                    <div className={styles.weightChartHeading}><span>Weight</span><strong>{weightText(Number(weights[weights.length - 1].weight), unit)} <small>{unit}</small></strong></div>
                    <Sparkline
                      values={weights.map((item) => weightIn(Number(item.weight), unit))}
                      label={`Weight from ${dayLabel(weights[0].date)} to ${dayLabel(weights[weights.length - 1].date)}`}
                      format={(value) => `${value.toFixed(1)} ${unit}`}
                      startLabel={dayLabel(weights[0].date)}
                      endLabel={dayLabel(weights[weights.length - 1].date)}
                      showRange
                      height={88}
                    />
                  </div>
                )}
                {visible.length ? (
                  <ul className={styles.metricList}>
                    {visible.slice().reverse().map((item) => {
                      const values = [
                        item.weight !== null ? `${weightText(Number(item.weight), unit)} ${unit}` : null,
                        item.body_fat !== null ? `${Number(item.body_fat).toFixed(1)}% body fat` : null,
                        ...Object.entries(item.measurements || {}).map(([name, value]) => `${name.replaceAll("_", " ")} ${value} cm`),
                      ].filter(Boolean);
                      return <li key={item.id}><span>{dayLabel(item.date, { day: "numeric", month: "short", year: "numeric" })}</span><strong>{values.join(" · ")}</strong></li>;
                    })}
                  </ul>
                ) : <EmptyState title="No body measurements" description="Your weight, body fat and tape measurements will appear here after you record them." />}
              </>
            )}
      </section>
      <form onSubmit={(event) => void save(event)} className={`fitx-panel ${styles.panel} ${styles.measurementForm}`} aria-labelledby="measure-title">
        <h2 id="measure-title" className={styles.panelTitle}><Scale size={16} aria-hidden="true" />Log a measurement</h2>
        <label>Weight ({unit})<input className="fitx-field" type="number" min={unit === "lb" ? 67 : WEIGHT_RANGE_KG.min} max={unit === "lb" ? 1102 : WEIGHT_RANGE_KG.max} step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder={lastWeight === null ? "Optional" : `Last: ${weightText(Number(lastWeight), unit)}`} /></label>
        <label>Body fat (%)<input className="fitx-field" type="number" min="2" max="80" step="0.1" value={bodyFat} onChange={(event) => setBodyFat(event.target.value)} placeholder={lastBodyFat === null ? "Optional" : `Last: ${Number(lastBodyFat).toFixed(1)}`} /></label>
        <label>Measurement<select className="fitx-field" value={measurementName} onChange={(event) => setMeasurementName(event.target.value)}>{MEASUREMENTS.map((name) => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)} (cm)</option>)}</select></label>
        <label>Size (cm)<input className="fitx-field" type="number" min="10" max="300" step="0.1" value={measurement} onChange={(event) => setMeasurement(event.target.value)} placeholder="Optional" /></label>
        {formError && <p role="alert" className={`fitx-alert fitx-alert-danger ${styles.formWide}`}>{formError}</p>}
        <button disabled={saving} className={`fitx-button ${styles.formWide}`}>{saving ? "Saving…" : "Save measurement"}</button>
      </form>
    </div>
  );
}
