"use client";

import { useState, type FormEvent } from "react";
import { Plus, Scale } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { WeightLine } from "@/components/progress/WeightLine";
import { weightView, type Period } from "@/components/progress/period";
import styles from "@/components/progress/Progress.module.css";
import { getSession, messageFor } from "@/components/tasks/session";
import { Sheet } from "@/components/ui/Sheet";
import { latestMeasurements, measurementSaved, type BodyMetricRow, type MeasurementSaved } from "@/lib/data/progress";
import { localDateKey } from "@/lib/domain/dates";
import { notifyUserContextChanged, syncProfileWeight } from "@/lib/domain/user-context";
import { WEIGHT_RANGE_KG, weightIn, weightText, weightToKg, weightUnitOf } from "@/lib/domain/weight-display";

const MEASUREMENTS = ["waist", "chest", "hips", "arm", "thigh", "neck"];
const dayLabel = (key: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", options);
/** "since 3 Jan", with the year when it is not this year's. */
const sinceLabel = (key: string, today: string) => `since ${dayLabel(key, key.slice(0, 4) === today.slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })}`;
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}`;

const PROFILE_WEIGHT_NOT_SAVED = "Measurement saved. Your profile weight didn't update.";

/**
 * Weight for the chosen period (the weigh-ins in it, drawn by date) and the newest of each measurement, in the
 * member's unit, with the form to log them in a sheet. The rows are read once by the page (newest first).
 */
export function BodySection({ rows, error, onReload, period }: {
  rows: BodyMetricRow[] | null;
  error: string;
  onReload: () => Promise<void> | void;
  period: Period;
}) {
  const unit = weightUnitOf(useOptionalUserContext()?.data?.preferences.weight_unit);
  const [open, setOpen] = useState(false);
  // A weigh-in that saved while the profile copy of the weight did not: the kilograms still to bring across.
  const [unsyncedKg, setUnsyncedKg] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const weight = weightView(rows ?? [], period);
  const everWeighed = weightView(rows ?? [], { ...period, end: period.today }).latest;
  const measures = latestMeasurements(rows ?? []);
  const lastBodyFat = measures.find((line) => line.name === "body_fat")?.latest ?? null;
  const shownLatest = weight.latest ?? everWeighed;

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
    <section aria-labelledby="body-title" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 id="body-title" className={styles.cardTitle}><Scale size={17} aria-hidden="true" />Weight</h2>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={() => setOpen(true)}><Plus size={16} aria-hidden="true" />Log measurement</button>
      </div>

      {unsyncedKg !== null ? (
        <p role="alert" className="fitx-alert fitx-alert-danger">
          {PROFILE_WEIGHT_NOT_SAVED}{" "}
          <button type="button" className="fitx-alert-action" disabled={syncing} onClick={() => void retrySync()}>{syncing ? "Trying…" : "Try again"}</button>
        </p>
      ) : null}
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error} <button type="button" className="fitx-alert-action" onClick={() => void onReload()}>Try again</button></p>
        : rows === null ? <div className={styles.loading} aria-busy="true" aria-label="Loading your body measurements" />
          : !everWeighed && !measures.length ? (
            <div className={styles.empty}>
              <strong>No weigh-ins yet</strong>
              <p>Log your weight to see its line here.</p>
            </div>
          ) : (
            <>
              {shownLatest ? (
                <div className={styles.weightHead}>
                  <p className={styles.weightNow}>{weightText(shownLatest.kg, unit)}<small>{unit}</small></p>
                  <p className={styles.weightMeta}>
                    {weight.changeKg !== null
                      ? <><span className={styles.change}>{signed(weightIn(weight.changeKg, unit))} {unit}</span> {sinceLabel(weight.points[0].date, period.today)}</>
                      : `Logged ${dayLabel(shownLatest.date, { day: "numeric", month: "short", year: "numeric" })}`}
                  </p>
                </div>
              ) : null}
              {weight.points.length >= 2 ? (
                <WeightLine
                  points={weight.points.map((point) => ({ date: point.date, kg: weightIn(point.kg, unit) }))}
                  from={period.from}
                  to={period.to}
                  format={(value) => `${value.toFixed(1)} ${unit}`}
                  label={`Weight from ${dayLabel(weight.points[0].date)} to ${dayLabel(weight.points.at(-1)!.date)}`}
                />
              ) : everWeighed ? <p className={styles.cardNote}>{weight.points.length === 1 ? "One weigh-in in this period. Log another to see the line." : "No weigh-ins in this period."}</p> : null}
              {measures.length ? (
                <div className="grid gap-2">
                  <h3 className={styles.subTitle}>Measurements</h3>
                  <ul className={styles.measures}>
                    {measures.map((line) => (
                      <li key={line.name}>
                        <span>{line.name === "body_fat" ? "Body fat" : line.name.replaceAll("_", " ")}</span>
                        <strong>{line.latest.toFixed(1)} {line.unit}</strong>
                        <small>{line.changeCm !== null && line.since ? `${signed(line.changeCm)} ${sinceLabel(line.since, period.today)}` : dayLabel(line.date)}</small>
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
        lastWeight={everWeighed?.kg ?? null}
        lastBodyFat={lastBodyFat}
        onSaved={async (result) => {
          // Only a new weigh-in settles the profile weight; a waist size alone leaves an earlier notice in place.
          if (result.weighed) setUnsyncedKg(result.unsyncedKg);
          setOpen(false);
          await onReload();
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
        {/* aria-label: inside its label, the select's chosen option would otherwise join its name ("Measurement Waist"). */}
        <label>Measurement<select aria-label="Measurement" className="fitx-field" value={measurementName} onChange={(event) => setMeasurementName(event.target.value)}>{MEASUREMENTS.map((name) => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
        <label>Size (cm)<input className="fitx-field" inputMode="decimal" type="number" min="10" max="300" step="0.1" value={measurement} onChange={(event) => setMeasurement(event.target.value)} placeholder="Optional" /></label>
        {formError && <p role="alert" className={`fitx-alert fitx-alert-danger ${styles.formWide}`}>{formError}</p>}
        <button disabled={saving} className={`fitx-button ${styles.formWide}`}>{saving ? "Saving…" : "Save"}</button>
      </form>
    </Sheet>
  );
}
