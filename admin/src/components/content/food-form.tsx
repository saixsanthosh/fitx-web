"use client";

import { useActionState, useRef, useState } from "react";
import { caloriesLookOff, energyFromMacros } from "@/lib/content/food-input";
import { IDLE, type FormState } from "@/lib/content/form";
import { DIET_LABELS, DIET_TYPES, VALUE_BASES, VALUE_BASIS_LABELS } from "@/lib/content/vocabulary";
import styles from "./content.module.css";
import { ChoiceField, SelectField, TextAreaField, TextField, ToggleField } from "./fields";
import { FormFooter } from "./form-footer";
import { keepTyped } from "./keep-typed";

export type FoodInitial = {
  name: string;
  aliases: string[];
  keywords: string[];
  category: string | null;
  cuisine: string | null;
  diet_type: string | null;
  state: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  value_basis: string;
  attribution: string | null;
};

export const NEW_FOOD: FoodInitial = {
  name: "", aliases: [], keywords: [], category: null, cuisine: "indian", diet_type: null, state: "cooked", kcal: null, protein_g: null,
  carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, value_basis: "label", attribution: null,
};

const read = (form: HTMLFormElement | null, name: string) => {
  const value = form?.elements.namedItem(name);
  return value instanceof HTMLInputElement && value.value.trim() !== "" ? Number(value.value.replace(",", ".")) : Number.NaN;
};

export function FoodForm({ action, initial, creating, categories }: { action: (state: FormState, form: FormData) => Promise<FormState>; initial: FoodInitial; creating: boolean; categories: string[] }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const [check, setCheck] = useState<{ off: boolean; expected: number } | null>(null);
  const errors = state.fieldErrors ?? {};

  // A hint, never a block: the stated calories against what the macros suggest.
  const recheck = () => {
    const values = ["kcal", "protein_g", "carbs_g", "fat_g"].map((name) => read(formRef.current, name));
    if (values.some((value) => !Number.isFinite(value))) return setCheck(null);
    const [kcal, protein, carbs, fat] = values;
    setCheck({ off: caloriesLookOff(kcal, protein, carbs, fat), expected: energyFromMacros(protein, carbs, fat) });
  };

  return (
    <form ref={formRef} action={formAction} onSubmit={keepTyped(formAction)} className={styles.form} noValidate onChange={recheck}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Food</legend>
        <TextField name="name" label="Name" defaultValue={initial.name} error={errors.name} maxLength={200} required />
        <TextAreaField name="aliases" label="Names people type" hint="Comma or line separated. Typing one selects this food, so keep them exact." defaultValue={initial.aliases.join(", ")} error={errors.aliases} rows={2} />
        <TextAreaField name="keywords" label="Search words" hint="Help it turn up in search without selecting it." defaultValue={initial.keywords.join(", ")} error={errors.keywords} rows={2} />
        <div className={styles.grid3}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="f-category">Category</label>
            <input className={styles.input} id="f-category" name="category" list="food-categories" defaultValue={initial.category ?? ""} maxLength={120} aria-invalid={errors.category ? true : undefined} />
            <datalist id="food-categories">
              {categories.map((category) => <option key={category} value={category} />)}
            </datalist>
            {errors.category && <p className={styles.error} role="alert">{errors.category}</p>}
          </div>
          <TextField name="cuisine" label="Cuisine" defaultValue={initial.cuisine} error={errors.cuisine} maxLength={40} />
          <SelectField name="diet_type" label="Diet" defaultValue={initial.diet_type} error={errors.diet_type} options={DIET_TYPES.map((value) => ({ value, label: DIET_LABELS[value] }))} empty="Not known" />
        </div>
        <ChoiceField name="state" label="As eaten" multiple={false} selected={initial.state ? [initial.state] : []} error={errors.state} options={[{ value: "cooked", label: "Cooked" }, { value: "raw", label: "Raw" }]} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Per 100 g</legend>
        <div className={styles.grid4}>
          <TextField name="kcal" label="Energy" inputMode="decimal" suffix="kcal" defaultValue={initial.kcal} error={errors.kcal} />
          <TextField name="protein_g" label="Protein" inputMode="decimal" suffix="g" defaultValue={initial.protein_g} error={errors.protein_g} />
          <TextField name="carbs_g" label="Carbs" inputMode="decimal" suffix="g" defaultValue={initial.carbs_g} error={errors.carbs_g} />
          <TextField name="fat_g" label="Fat" inputMode="decimal" suffix="g" defaultValue={initial.fat_g} error={errors.fat_g} />
        </div>
        {check?.off && (
          <p className={styles.hint} role="status">
            The macros suggest about {check.expected.toLocaleString("en-IN")} kcal (estimate). Check the label before saving.
          </p>
        )}
        <div className={styles.grid3}>
          <TextField name="fiber_g" label="Fibre" hint="Leave empty if not known." inputMode="decimal" suffix="g" defaultValue={initial.fiber_g} error={errors.fiber_g} />
          <TextField name="sugar_g" label="Sugar" hint="Leave empty if not known." inputMode="decimal" suffix="g" defaultValue={initial.sugar_g} error={errors.sugar_g} />
          <TextField name="sodium_mg" label="Sodium" hint="Leave empty if not known." inputMode="decimal" suffix="mg" defaultValue={initial.sodium_mg} error={errors.sodium_mg} />
        </div>
        <SelectField name="value_basis" label="Where the values come from" defaultValue={initial.value_basis} error={errors.value_basis} options={VALUE_BASES.map((value) => ({ value, label: VALUE_BASIS_LABELS[value] }))} />
        <TextField name="attribution" label="Source or credit" hint="For example the brand and pack, or the recipe." defaultValue={initial.attribution} error={errors.attribution} maxLength={300} />
        {creating && <ToggleField name="is_active" label="Show in food search now" />}
      </fieldset>

      <FormFooter state={state} pending={pending} label={creating ? "Add food" : "Save changes"} formRef={formRef} />
    </form>
  );
}
