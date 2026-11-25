"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import { checkBarcode, barcodeProblem } from "@/lib/food/barcode";
import { customFoodWarning, savedFoodSource, type CustomFoodInput, type CustomFoodRow } from "@/lib/food/client-data";
import { customFoodProblem, numbersChanged, readCustomFoodNumbers, unknownMacrosNote } from "@/lib/food/custom-food-form";
import type { CustomFoodOrigin, ValueBasis } from "@/lib/food/types";
import styles from "./FoodUi.module.css";

/** What a new food can start from: a scanned barcode, or a package found on Open Food Facts. */
export interface CustomFoodPrefill {
  name?: string;
  brand?: string | null;
  barcode?: string | null;
  servingLabel?: string;
  servingGrams?: number;
  /** Per 100 g, from a package label. */
  per100g?: { calories: number; protein: number | null; carbs: number | null; fat: number | null };
  imageUrl?: string | null;
  imageAttribution?: string | null;
  origin?: CustomFoodOrigin;
  sourceRef?: string | null;
  /** Protein, carbs or fat the source does not list: left blank in the form, and saved as unknown unless the member enters it. */
  missing?: Array<"protein" | "carbs" | "fat">;
  /** When copying a food from the catalogue: how its values were obtained, kept while the values are not changed. */
  valueBasis?: ValueBasis;
}

interface CustomFoodFormProps {
  editing: CustomFoodRow | null;
  prefill: CustomFoodPrefill | null;
  /** A signed link to the food's current photo, when it has one. */
  photoUrl?: string | null;
  /** The nutrition v2 columns (barcode, origin, value basis, image) exist. */
  v2: boolean;
  busy: boolean;
  onCancel: () => void;
  /** `removePhoto`: take the food's current photo off (only when editing and no new photo was chosen). */
  onSave: (input: CustomFoodInput, photo: File | null, removePhoto: boolean) => void;
}

/** A per-100 g value as the amount in one serving; blank when it is not known. */
const perServing = (per100: number | null | undefined, grams: number) => (per100 === null || per100 === undefined || !Number.isFinite(Number(per100)) ? "" : formatAmount(Math.round(Number(per100) * grams) / 100));

/**
 * Create or edit one of your own foods. Values are for one serving, as printed on most labels. An edit that leaves
 * the serving and values alone keeps where the values came from (a typical recipe the AI coach saved stays one);
 * changing them makes them your entry, or a package label when that box is ticked.
 */
export function CustomFoodForm({ editing, prefill, photoUrl = null, v2, busy, onCancel, onSave }: CustomFoodFormProps) {
  const [form, setForm] = useState(() => {
    const grams = editing ? Number(editing.serving_grams) || 100 : prefill?.servingGrams ?? 100;
    // An unknown protein, carbs or fat (NULL in the database) opens blank, as it was left.
    const known = (value: number | null) => (value === null || value === undefined ? null : Number(value));
    const per100 = editing
      ? { calories: Number(editing.calories_per_100g), protein: known(editing.protein_per_100g), carbs: known(editing.carbs_per_100g), fat: known(editing.fat_per_100g) }
      : prefill?.per100g ?? null;
    const label = editing?.serving_size && !/^\d+(\.\d+)?\s*g$/i.test(editing.serving_size) ? editing.serving_size : prefill?.servingLabel ?? "";
    return {
      name: editing?.name ?? prefill?.name ?? "",
      brand: editing?.brand ?? prefill?.brand ?? "",
      servingLabel: label,
      grams: String(grams),
      calories: per100 ? perServing(per100.calories, grams) : "",
      protein: per100 && !prefill?.missing?.includes("protein") ? perServing(per100.protein, grams) : "",
      carbs: per100 && !prefill?.missing?.includes("carbs") ? perServing(per100.carbs, grams) : "",
      fat: per100 && !prefill?.missing?.includes("fat") ? perServing(per100.fat, grams) : "",
      barcode: editing?.barcode ?? prefill?.barcode ?? "",
      fromLabel: editing ? editing.value_basis === "label" : prefill?.valueBasis ? prefill.valueBasis === "label" : Boolean(prefill?.per100g || prefill?.barcode),
    };
  });
  /** The form as it opened, to tell whether an edit changed the values. */
  const [start] = useState(form);
  const [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const set = (key: keyof typeof form, value: string | boolean) => { setForm((old) => ({ ...old, [key]: value })); setProblem(""); };
  // A blank protein, carbs or fat is unknown (null), never 0.
  const numbers = readCustomFoodNumbers(form);
  const warning = customFoodWarning(numbers.calories, numbers.protein, numbers.carbs, numbers.fat);
  const unknownNote = unknownMacrosNote(numbers);
  const image = editing?.image_url ?? prefill?.imageUrl ?? null;
  const imageCredit = editing?.image_attribution ?? prefill?.imageAttribution ?? null;
  const shownPhoto = preview ?? (removePhoto ? null : photoUrl ?? image);
  const shownCredit = preview || photoUrl ? "Your photo" : imageCredit;
  const canRemovePhoto = v2 && Boolean(editing) && !preview && Boolean(photoUrl || editing?.image_url);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choosePhoto(file: File | null) {
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : null);
    if (file) setRemovePhoto(false);
    setProblem("");
  }

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const { grams, calories, protein, carbs, fat } = numbers;
    const typed = customFoodProblem(form.name, numbers);
    if (typed) return setProblem(typed);
    let barcode: string | null = null;
    if (v2 && form.barcode.trim()) {
      const checked = checkBarcode(form.barcode);
      if (!checked.ok) return setProblem(barcodeProblem(checked.reason));
      barcode = checked.code;
    }
    // Blank and 0 are different answers: filling in an unknown value (or clearing one) is a change.
    const changed = numbersChanged(numbers, readCustomFoodNumbers(start)) || form.fromLabel !== start.fromLabel;
    const typedSource = savedFoodSource(editing, changed, form.fromLabel, prefill?.origin ?? (barcode ? "barcode" : "user"));
    // A catalogue food copied as it is keeps where its values came from (USDA lab analysis, a typical recipe...).
    const keepsBasis = !editing && !changed && prefill?.valueBasis !== undefined;
    const origin = typedSource.origin;
    const valueBasis = keepsBasis ? (prefill?.valueBasis as ValueBasis) : typedSource.valueBasis;
    onSave({
      name: form.name,
      brand: form.brand,
      servingLabel: form.servingLabel,
      servingGrams: grams,
      calories,
      protein,
      carbs,
      fat,
      barcode,
      valueBasis,
      origin,
      ...(image && !removePhoto ? { imageUrl: image, imageAttribution: imageCredit } : {}),
      ...(prefill?.sourceRef !== undefined && !editing ? { sourceRef: prefill.sourceRef } : {}),
    }, photo, removePhoto && !photo);
  }

  const field = (key: "grams" | "calories" | "protein" | "carbs" | "fat", label: string, min = "0") => (
    <label>{label}<input className="fitx-field" type="number" inputMode="decimal" min={min} step="any" required={key === "grams" || key === "calories"} value={form[key]} onChange={(event) => set(key, event.target.value)}/></label>
  );

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="custom-food-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="custom-food-title">{editing ? "Edit your food" : "Add your own food"}</h2>
            <p className={styles.muted}>Saving adds it to My foods. It is not logged until you add it to a meal.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className={styles.iconButton}><X size={16}/></button>
        </div>
        {shownPhoto && <div className={styles.photo}>
          <Image src={shownPhoto} alt="" width={72} height={72} unoptimized/>
          <p className={styles.credit}>{shownCredit}</p>
          {canRemovePhoto && <button type="button" className={styles.textButton} onClick={() => setRemovePhoto(true)}>Remove photo</button>}
        </div>}
        {removePhoto && !preview && <p className={styles.hint}>The photo is removed when you save. <button type="button" className={styles.textButton} onClick={() => setRemovePhoto(false)}>Keep it</button></p>}
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className={styles.wide}>Name<input ref={first} className="fitx-field" required maxLength={160} value={form.name} onChange={(event) => set("name", event.target.value)}/></label>
          <label className={styles.wide}>Brand (optional)<input className="fitx-field" maxLength={160} value={form.brand} onChange={(event) => set("brand", event.target.value)}/></label>
          <label>Serving (optional)<input className="fitx-field" maxLength={60} placeholder="e.g. 1 bowl, 2 biscuits" value={form.servingLabel} onChange={(event) => set("servingLabel", event.target.value)}/></label>
          {field("grams", "Serving weight (g)", "1")}
          {field("calories", "Calories per serving")}
          {field("protein", "Protein (g)")}
          {field("carbs", "Carbs (g)")}
          {field("fat", "Fat (g)")}
          {v2 && <label className={styles.wide}>Barcode (optional)<input className="fitx-field" inputMode="numeric" maxLength={14} placeholder="8, 12 or 13 digits" value={form.barcode} onChange={(event) => set("barcode", event.target.value)}/></label>}
          {v2 && <label className={styles.wide}>Photo (optional)<input className="fitx-field" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)}/>
            <span className={styles.hint}>Private to you. FITX shrinks it on this device before uploading.</span></label>}
          {v2 && <label className={`${styles.wide} ${styles.check}`}>
            <input type="checkbox" checked={form.fromLabel} onChange={(event) => set("fromLabel", event.target.checked)}/>
            <span>These values are copied from the package label</span>
          </label>}
          {!editing && prefill?.missing?.length ? <p className={`${styles.hint} ${styles.wide}`}>The source doesn&apos;t list {prefill.missing.join(", ")}. Enter {prefill.missing.length > 1 ? "them" : "it"} if you know, or 0 if there is none; FITX won&apos;t guess.</p> : null}
          {unknownNote && <p className={`${styles.hint} ${styles.wide}`}>{unknownNote}</p>}
          {warning && <p className={`${styles.warning} ${styles.wide}`}>{warning}</p>}
          {!v2 && <p className={`${styles.hint} ${styles.wide}`}>Barcodes and labels for your foods arrive with the next database update.</p>}
          {problem && <p role="alert" className={`${styles.warning} ${styles.wide}`}>{problem}</p>}
          <div className={`${styles.dialogActions} ${styles.wide}`}>
            <button type="button" onClick={onCancel} className="fitx-button fitx-button-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="fitx-button">{busy ? "Saving…" : editing ? "Save changes" : "Save food"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
