"use client";

import { useActionState, useRef } from "react";
import { IDLE, type FormState } from "@/lib/content/form";
import {
  CATEGORY_LABELS,
  EQUIPMENT,
  EQUIPMENT_KIND_LABELS,
  EXERCISE_CATEGORIES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  humanise,
  type EquipmentKind,
} from "@/lib/content/vocabulary";
import styles from "./content.module.css";
import { ChoiceField, SelectField, TextAreaField, TextField, ToggleField } from "./fields";
import { FormFooter } from "./form-footer";

export type ExerciseInitial = {
  name: string;
  description: string;
  primary_muscle: string;
  secondary_muscles: string[];
  category: string | null;
  mechanic: string | null;
  difficulty: string;
  movement_pattern: string;
  required_equipment: string[];
  locations: string[];
  instructions: string[];
  recommended_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  prescription_type: string | null;
  default_duration_seconds: number | null;
  attribution: string;
};

export const NEW_EXERCISE: ExerciseInitial = {
  name: "", description: "", primary_muscle: "", secondary_muscles: [], category: "strength", mechanic: null, difficulty: "beginner",
  movement_pattern: "push", required_equipment: [], locations: ["gym", "home"], instructions: [], recommended_sets: 3, reps_min: 8,
  reps_max: 12, rest_seconds: 90, prescription_type: "reps", default_duration_seconds: null, attribution: "FITX",
};

const KINDS = Object.keys(EQUIPMENT_KIND_LABELS) as EquipmentKind[];

export function ExerciseForm({ action, initial, creating }: { action: (state: FormState, form: FormData) => Promise<FormState>; initial: ExerciseInitial; creating: boolean }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};
  const patterns = [...new Set([...MOVEMENT_PATTERNS, initial.movement_pattern].filter(Boolean))].map((value) => ({ value, label: humanise(value) }));
  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Basics</legend>
        <TextField name="name" label="Name" defaultValue={initial.name} error={errors.name} maxLength={120} required />
        <TextAreaField name="description" label="Short description" defaultValue={initial.description} error={errors.description} rows={3} maxLength={2000} />
        <div className={styles.grid3}>
          <SelectField name="category" label="Category" defaultValue={initial.category} error={errors.category} options={EXERCISE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))} empty="Not set" />
          <SelectField name="mechanic" label="Mechanic" defaultValue={initial.mechanic} error={errors.mechanic} options={[{ value: "compound", label: "Compound" }, { value: "isolation", label: "Isolation" }]} empty="Does not apply" />
          <SelectField name="movement_pattern" label="Movement" defaultValue={initial.movement_pattern} error={errors.movement_pattern} options={patterns} />
        </div>
        <ChoiceField name="difficulty" label="Level" multiple={false} selected={[initial.difficulty]} error={errors.difficulty} options={[{ value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }]} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Muscles</legend>
        <SelectField name="primary_muscle" label="Main muscle" hint="Sets the muscle group the app filters by." defaultValue={initial.primary_muscle} error={errors.primary_muscle} options={MUSCLES} empty="Choose" />
        <ChoiceField name="secondary_muscles" label="Also works" selected={initial.secondary_muscles} error={errors.secondary_muscles} options={MUSCLES} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Equipment and machines</legend>
        <p className={styles.hint}>Nothing chosen means body weight only. Home or gym follows from what is chosen.</p>
        {KINDS.map((kind) => {
          const items = EQUIPMENT.filter((item) => item.kind === kind);
          return items.length ? (
            <ChoiceField key={kind} id={`f-equipment-${kind}`} name="required_equipment" label={EQUIPMENT_KIND_LABELS[kind]} selected={initial.required_equipment} options={items.map((item) => ({ value: item.key, label: item.label }))} />
          ) : null;
        })}
        {errors.required_equipment && <p className={styles.error} role="alert">{errors.required_equipment}</p>}
        <ToggleField name="outdoor" label="Also suits outdoors" defaultChecked={initial.locations.includes("outdoor")} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Prescription</legend>
        <ChoiceField name="prescription_type" label="Logged as" multiple={false} selected={[initial.prescription_type ?? "reps"]} error={errors.prescription_type} options={[{ value: "reps", label: "Reps" }, { value: "time", label: "Time" }]} />
        <div className={styles.grid4}>
          <TextField name="recommended_sets" label="Sets" inputMode="numeric" defaultValue={initial.recommended_sets} error={errors.recommended_sets} />
          <TextField name="reps_min" label="Reps from" inputMode="numeric" defaultValue={initial.reps_min} error={errors.reps_min} />
          <TextField name="reps_max" label="Reps to" inputMode="numeric" defaultValue={initial.reps_max} error={errors.reps_max} />
          <TextField name="rest_seconds" label="Rest" inputMode="numeric" suffix="s" defaultValue={initial.rest_seconds} error={errors.rest_seconds} />
        </div>
        <TextField name="default_duration_seconds" label="Work time" hint="For holds, stretches and cardio." inputMode="numeric" suffix="s" defaultValue={initial.default_duration_seconds} error={errors.default_duration_seconds} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Steps</legend>
        <TextAreaField name="instructions" label="How to do it" hint="One step per line, at most 20." defaultValue={initial.instructions.join("\n")} error={errors.instructions} rows={7} />
        <TextField name="attribution" label="Credit line" hint="Who wrote this exercise, shown in the app." defaultValue={initial.attribution} error={errors.attribution} maxLength={200} />
        {creating && <ToggleField name="is_active" label="Show in the app now" hint="Leave off to add photos or a video first." />}
      </fieldset>

      <FormFooter state={state} pending={pending} label={creating ? "Add exercise" : "Save changes"} formRef={formRef} />
    </form>
  );
}
