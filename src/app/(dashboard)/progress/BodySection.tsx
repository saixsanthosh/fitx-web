"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Scale } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { getSession, messageFor } from "@/components/tasks/session";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { latestMeasurements, measurementSaved, weightSummary, type BodyMetricRow, type MeasurementSaved } from "@/lib/data/progress";
import { localDateKey } from "@/lib/domain/dates";
import { addDays } from "@/lib/domain/day-keys";
import { notifyUserContextChanged, syncProfileWeight } from "@/lib/domain/user-context";
import { WEIGHT_RANGE_KG, weightIn, weightText, weightToKg, weightUnitOf } from "@/lib/domain/weight-display";
import styles from "./Progress.module.css";

type Range = "30" | "90" | "365" | "0";
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: "30", label: "30 d" },
  { value: "90", label: "90 d" },
  { value: "365", label: "1 yr" },
  { value: "0", label: "All" },
];
const RANGE_WORDS: Record<Exclude<Range, "0">, string> = { "30": "in 30 days", "90": "in 90 days", "365": "in a year" };
/** Body rows read, newest first. Older rows are not loaded, so a change is named by the date it starts from. */
const BODY_ROWS = 365;
const MEASUREMENTS = ["waist", "chest", "hips", "arm", "thigh", "neck"];
const dayLabel = (key: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, options);
/** "since 3 Jan", with the year when it is not this year's. */
const sinceLabel = (key: string, today: string) => `since ${dayLabel(key, key.slice(0, 4) === today.slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })}`;
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}`;

const PROFILE_WEIGHT_NOT_SAVED = "Measurement saved. Your profile weight didn't update.";

/** Weight trend and the newest of each measurement, in the member's unit, with the form to log them in a sheet. */
export function BodySection() {
  const unit = weightUnitOf(useOptionalUserContext()?.data?.preferences.weight_unit);
  const [metrics, setMetrics] = useState<BodyMetricRow[] | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>("90");
  const [open, setOpen] = useState(false);
  const [today] = useState(() => localDateKey());
  // A weigh-in that saved while the profile copy of the weight did not: the kilograms still to bring across.
  const [unsyncedKg, setUnsyncedKg] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { db, userId } = await getSession();
      const result = await db.from("body_metrics").select("id,date,weight,body_fat,measurements").eq("user_id", userId)
        .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(BODY_ROWS);
      if (result.error) throw result.error;
      setMetrics((result.data ?? []) as BodyMetricRow[]);
      setError("");
    } catch (failure) {
      setError(messageFor(failure, "Your body measurements could not be loaded."));
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const weight = useMemo(() => weightSummary(metrics ?? [], today, Number(range)), [metrics, today, range]);
  const everWeighed = useMemo(() => weightSummary(metrics ?? [], today, 0).latest, [metrics, today]);
  const measures = useMemo(() => latestMeasurements(metrics ?? []), [metrics]);
  const lastWeight = everWeighed?.kg ?? null;
  // "All" starts at the oldest weigh-in loaded, which is the first only when every row was read; a range whose
  // start is older than the oldest row loaded is cut short. Either way the change names the day it starts from.
  const capped = (metrics?.length ?? 0) >= BODY_ROWS;
  const oldestLoaded = metrics?.at(-1)?.date ?? null;
  const cutShort = capped && oldestLoaded !== null && range !== "0" && oldestLoaded > addDays(today, -Number(range));
  const changeWords = range === "0" || cutShort ? (weight.points[0] ? sinceLabel(weight.points[0].date, today) : "") : RANGE_WORDS[range];
  const lastBodyFat = measures.find((line) => line.name === "body_fat")?.latest ?? null;

  const retrySync = async () => {
    if (unsyncedKg === null || syncing) return;
    setSyncing(true);
    try {
      const { db, userId } = await getSession();
      if (!(await syncProfileWeight(db, userId, unsyncedKg)).error) { setUnsyncedKg(null); notifyUserContextChanged(); }
    } catch {
      // Still not saved: the notice stays with its Try again.
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section aria-labelledby="body-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="body-title" className={styles.panelTitle}><Scale size={17} aria-hidden="true" />Body</h2>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={() => setOpen(true)}><Plus size={16} aria-hidden="true" />Log measurement</button>
      </div>

      {unsyncedKg !== null ? (
        <p role="alert" className="fitx-alert fitx-alert-danger">
          {PROFILE_WEIGHT_NOT_SAVED}{" "}
          <button type="button" className="fitx-alert-action" disabled={syncing} onClick={() => void retrySync()}>{syncing ? "Trying…" : "Try again"}</button>
        </p>
      ) : null}
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error} <button type="button" className="fitx-alert-action" onClick={() => void load()}>Try again</button></p>
        : metrics === null ? <div className={`${styles.loading} ${styles.loadingTall}`} aria-busy="true" aria-label="Loading your body measurements" />
          : !everWeighed && !measures.length ? (
            <div className={styles.empty}>
              <strong>No weigh-ins yet</strong>
              <p>Log your weight to see its trend.</p>
            </div>
          ) : (
            <>
              {everWeighed ? (
                <div className="grid gap-3">
                  <div className={styles.weightHead}>
                    <div>
                      <p className={styles.chartLabel}>Weight</p>
                      <p className={styles.weightNow}>{weightText(everWeighed.kg, unit)}<small>{unit}</small></p>
                      <p className={styles.weightMeta}>
                        {weight.changeKg !== null
                          ? <><span className={styles.change}>{signed(weightIn(weight.changeKg, unit))} {unit}</span> {changeWords}</>
                          : `Logged ${dayLabel(everWeighed.date, { day: "numeric", month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    <Segmented options={RANGES} value={range} onChange={setRange} label="Time range" />
                  </div>
                  {weight.points.length ? (
                    <Sparkline
                      values={weight.points.map((point) => weightIn(point.kg, unit))}
                      label={`Weight from ${dayLabel(weight.points[0].date)} to ${dayLabel(weight.points.at(-1)!.date)}`}
                      format={(value) => `${value.toFixed(1)} ${unit}`}
                      startLabel={dayLabel(weight.points[0].date)}
                      endLabel={dayLabel(weight.points.at(-1)!.date)}
                      showRange
                      height={112}
                    />
                  ) : <p className={styles.panelNote}>No weigh-ins in this range.</p>}
                </div>
              ) : <p className={styles.panelNote}>No weigh-ins yet.</p>}
              {measures.length ? (
                <div className="grid gap-2">
                  <h3 className={styles.chartLabel}>Measurements</h3>
                  <ul className={styles.measures}>
                    {measures.map((line) => (
                      <li key={line.name}>
                        <span>{line.name === "body_fat" ? "Body fat" : line.name.replaceAll("_", " ")}</span>
                        <strong>{line.latest.toFixed(1)} {line.unit}</strong>
                        <small>{line.changeCm !== null && line.since ? `${signed(line.changeCm)} ${sinceLabel(line.since, today)}` : dayLabel(line.date)}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

      <MeasurementSheet
        open={open}
        onClose={() => setOpen(false)}
        unit={unit}
        lastWeight={lastWeight}
        lastBodyFat={lastBodyFat}
        onSaved={async (result) => {
          // Only a new weigh-in settles the profile weight; a waist size alone leaves an earlier notice in place.
          if (result.weighed) setUnsyncedKg(result.unsyncedKg);
          setOpen(false);
          await load();
        }}
      />
    </section>
  );
}

function MeasurementSheet({ open, onClose, unit, lastWeight, lastBodyFat, onSaved }: {
  open: boolean;
  onClose: () => void;
  unit: "kg" | "lb";
  lastWeight: number | null;
  lastBodyFat: number | null;
  onSaved: (result: MeasurementSaved) => Promise<void>;
}) {
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [measurementName, setMeasurementName] = useState("waist");
  const [measurement, setMeasurement] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    const typedWeight = weight.trim() ? Number(weight) : null;
    const parsedWeight = typedWeight === null ? null : Number.isFinite(typedWeight) ? weightToKg(typedWeight, unit) : Number.NaN;
    const parsedFat = bodyFat.trim() ? Number(bodyFat) : null;
    const parsedMeasurement = measurement.trim() ? Number(measurement) : null;
    if ((parsedWeight !== null && (!(parsedWeight >= WEIGHT_RANGE_KG.min) || parsedWeight > WEIGHT_RANGE_KG.max)) || (parsedFat !== null && (!(parsedFat >= 2) || parsedFat > 80)) || (parsedMeasurement !== null && (!(parsedMeasurement >= 10) || parsedMeasurement > 300))) {
      setFormError("Check your values and try again.");
      return;
    }
    if (parsedWeight === null && parsedFat === null && parsedMeasurement === null) { setFormError("Enter at least one value."); return; }
    setSaving(true);
    setFormError("");
    try {
      const { db, userId } = await getSession();
      const values: Record<string, number> = {};
      if (parsedMeasurement !== null) values[measurementName] = parsedMeasurement;
      const result = await db.from("body_metrics").insert({ user_id: userId, date: localDateKey(), weight: parsedWeight, body_fat: parsedFat, measurements: values });
      if (result.error) throw result.error;
      // A new weigh-in is the current weight everywhere: the profile copy, targets and the header. The row is saved
      // either way, so the sheet closes; a profile copy that did not save is said on the page, with a retry.
      const synced = parsedWeight === null ? null : await syncProfileWeight(db, userId, parsedWeight).catch((failure: unknown) => ({ error: failure }));
      if (parsedWeight !== null) notifyUserContextChanged();
      setWeight(""); setBodyFat(""); setMeasurement("");
      await onSaved(measurementSaved(parsedWeight, synced));
    } catch (failure) {
      setFormError(messageFor(failure, "Your measurement could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log measurement">
      <form onSubmit={(event) => void save(event)} className={styles.form} aria-label="Log measurement">
        <label>Weight ({unit})<input className="fitx-field" inputMode="decimal" type="number" min={unit === "lb" ? 67 : WEIGHT_RANGE_KG.min} max={unit === "lb" ? 1102 : WEIGHT_RANGE_KG.max} step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder={lastWeight === null ? "Optional" : `Last: ${weightText(lastWeight, unit)}`} /></label>
        <label>Body fat (%)<input className="fitx-field" inputMode="decimal" type="number" min="2" max="80" step="0.1" value={bodyFat} onChange={(event) => setBodyFat(event.target.value)} placeholder={lastBodyFat === null ? "Optional" : `Last: ${lastBodyFat.toFixed(1)}`} /></label>
        <label>Measurement<select aria-label="Measurement" className="fitx-field" value={measurementName} onChange={(event) => setMeasurementName(event.target.value)}>{MEASUREMENTS.map((name) => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
        <label>Size (cm)<input className="fitx-field" inputMode="decimal" type="number" min="10" max="300" step="0.1" value={measurement} onChange={(event) => setMeasurement(event.target.value)} placeholder="Optional" /></label>
        {formError && <p role="alert" className={`fitx-alert fitx-alert-danger ${styles.formWide}`}>{formError}</p>}
        <button disabled={saving} className={`fitx-button ${styles.formWide}`}>{saving ? "Saving…" : "Save"}</button>
      </form>
    </Sheet>
  );
}
