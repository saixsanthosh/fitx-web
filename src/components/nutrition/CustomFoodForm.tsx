"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { formatAmount } from "@/lib/domain/food-query";
import { checkBarcode, barcodeProblem } from "@/lib/food/barcode";
import { customFoodWarning, savedFoodSource, type CustomFoodInput, type CustomFoodRow } from "@/lib/food/client-data";
import type { CustomFoodOrigin } from "@/lib/food/types";
import styles from "./FoodUi.module.css";

/** What a new food can start from: a scanned barcode, or a package found on Open Food Facts. */
export interface CustomFoodPrefill {
  name?: string;
  brand?: string | null;
  barcode?: string | null;
  servingLabel?: string;
  servingGrams?: number;
  /** Per 100 g, from a package label. */
  per100g?: { calories: number; protein: number; carbs: number; fat: number };
  imageUrl?: string | null;
  imageAttribution?: string | null;
  origin?: CustomFoodOrigin;
  sourceRef?: string | null;
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

const perServing = (per100: number, grams: number) => formatAmount(Math.round(per100 * grams) / 100);

/**
 * Create or edit one of your own foods. Values are for one serving, as printed on most labels. An edit that leaves
 * the serving and values alone keeps where the values came from (a typical recipe the AI coach saved stays one);
 * changing them makes them your entry, or a package label when that box is ticked.
 */
export function CustomFoodForm({ editing, prefill, photoUrl = null, v2, busy, onCancel, onSave }: CustomFoodFormProps) {
  const [form, setForm] = useState(() => {
    const grams = editing ? Number(editing.serving_grams) || 100 : prefill?.servingGrams ?? 100;
    const per100 = editing
      ? { calories: Number(editing.calories_per_100g), protein: Number(editing.protein_per_100g), carbs: Number(editing.carbs_per_100g), fat: Number(editing.fat_per_100g) }
      : prefill?.per100g ?? null;
    const label = editing?.serving_size && !/^\d+(\.\d+)?\s*g$/i.test(editing.serving_size) ? editing.serving_size : prefill?.servingLabel ?? "";
    return {
      name: editing?.name ?? prefill?.name ?? "",
      brand: editing?.brand ?? prefill?.brand ?? "",
      servingLabel: label,
      grams: String(grams),
      calories: per100 ? perServing(per100.calories, grams) : "",
      protein: per100 ? perServing(per100.protein, grams) : "",
      carbs: per100 ? perServing(per100.carbs, grams) : "",
      fat: per100 ? perServing(per100.fat, grams) : "",
      barcode: editing?.barcode ?? prefill?.barcode ?? "",
      fromLabel: editing ? editing.value_basis === "label" : Boolean(prefill?.per100g || prefill?.barcode),
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
  const numbers = [form.grams, form.calories, form.protein, form.carbs, form.fat].map((value) => (value.trim() === "" ? 0 : Number(value)));
  const warning = numbers.every(Number.isFinite) ? customFoodWarning(numbers[1], numbers[2], numbers[3], numbers[4]) : null;
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
    const [grams, calories, protein, carbs, fat] = numbers;
    if (!form.name.trim()) return setProblem("Give the food a name.");
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) return setProblem("The serving size must be between 1 and 5,000 grams.");
    if ([calories, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)) return setProblem("Enter calories, protein, carbs and fat as numbers (0 if none).");
    if (form.calories.trim() === "") return setProblem("Enter the calories in one serving.");
    if ((protein + carbs + fat) > grams * 1.01) return setProblem("Protein, carbs and fat can't weigh more than the serving itself.");
    if (calories * 100 / grams > 950) return setProblem("That is more than 950 kcal per 100 g, which no food has. Check whether the label gives kJ (divide by 4.184).");
    let barcode: string | null = null;
    if (v2 && form.barcode.trim()) {
      const checked = checkBarcode(form.barcode);
      if (!checked.ok) return setProblem(barcodeProblem(checked.reason));
      barcode = checked.code;
    }
    const asNumber = (value: string) => (value.trim() === "" ? 0 : Number(value));
    const valueKeys = ["grams", "calories", "protein", "carbs", "fat"] as const;
    const changed = valueKeys.some((key) => asNumber(form[key]) !== asNumber(start[key])) || form.fromLabel !== start.fromLabel;
    const { origin, valueBasis } = savedFoodSource(editing, changed, form.fromLabel, prefill?.origin ?? (barcode ? "barcode" : "user"));
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
