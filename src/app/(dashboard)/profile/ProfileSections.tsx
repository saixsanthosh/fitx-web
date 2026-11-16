"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dumbbell, Ruler, Salad } from "lucide-react";
import { ChipGroup, ChoiceGroup, HeightField, TagInput, TextField, WeightField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import {
  ACTIVITY_OPTIONS,
  AGE_RANGE,
  ALLERGY_OPTIONS,
  BUDGET_LEVEL_OPTIONS,
  CUISINE_OPTIONS,
  DAYS_PER_WEEK,
  DIET_OPTIONS,
  EQUIPMENT_OPTIONS,
  EXPERIENCE_OPTIONS,
  FOOD_RULE_OPTIONS,
  GOAL_OPTIONS,
  GOALS_BEFORE_PROFILE_V2,
  HEIGHT_RANGE_CM,
  LIMITATION_OPTIONS,
  LOCATION_OPTIONS,
  MAX_FOOD_DISLIKES,
  MEALS_PER_DAY,
  MONTHLY_BUDGET_RANGE,
  SESSION_LENGTHS,
  SEX_OPTIONS,
  SPLIT_OPTIONS,
  WATER_RANGE_ML,
  WEIGHT_RANGE_KG,
  formatHeight,
  formatRupees,
  formatWeight,
  inRange,
  joinKnown,
  legacyDietaryPreferences,
  optionLabel,
  parseRupees,
  splitAllergies,
  splitLimitations,
  type ActivityLevel,
  type AllergyKey,
  type BudgetLevel,
  type Cuisine,
  type DietType,
  type EquipmentKey,
  type Experience,
  type FoodRule,
  type Goal,
  type HeightUnit,
  type LimitationKey,
  type Sex,
  type TrainingLocation,
  type WeightUnit,
  type WorkoutSplit,
} from "@/lib/domain/profile-options";
import { changedFields, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import { ChipList, Detail, DetailList, EditActions, NotSet, SectionCard } from "./ProfileParts";

type SectionProps = {
  data: UserContextData;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Reloads the shared context after a save; resolves once the new values are on screen. */
  onSaved: (message: string) => Promise<void>;
};

const WRITE_FAILED = "Your changes couldn't be saved. Check your connection and try again.";
const NO_CHANGES = "Nothing changed, so there was nothing to save.";

const labelsFor = <V extends string>(options: readonly { value: V; label: string }[], values: readonly string[]) =>
  values.map((value) => optionLabel(options, value) ?? value);

const sameWeight = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.05);

// ─── Body and goal ───────────────────────────────────────────────────────────────────────────────

type BodyDraft = {
  age: string;
  gender: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  goal: Goal;
  activity: ActivityLevel;
};

export function BodySection({ data, editing, onEdit, onClose, onSaved }: SectionProps) {
  const { profile, preferences: prefs } = data;
  const original: BodyDraft = {
    age: profile?.age == null ? "" : String(profile.age),
    gender: profile?.gender ?? null,
    heightCm: profile?.height ?? null,
    weightKg: data.currentWeightKg,
    targetWeightKg: profile?.target_weight ?? null,
    heightUnit: prefs.height_unit,
    weightUnit: prefs.weight_unit,
    goal: prefs.primary_goal,
    activity: prefs.activity_level,
  };
  const [draft, setDraft] = useState(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof BodyDraft>(key: K, value: BodyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => withoutKey(current, key));
    setError("");
  };
  const v2 = data.schema.preferencesV2;

  const start = () => {
    setDraft(original);
    setErrors({});
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const age = Number(draft.age);
    if (!draft.age.trim() || !Number.isInteger(age) || !inRange(age, AGE_RANGE)) found.age = `Enter a whole number from ${AGE_RANGE.min} to ${AGE_RANGE.max}.`;
    if (!inRange(draft.heightCm, HEIGHT_RANGE_CM)) found.heightCm = "Enter a height between 90 and 250 cm (2 ft 11 in to 8 ft 2 in).";
    if (!inRange(draft.weightKg, WEIGHT_RANGE_KG)) found.weightKg = "Enter a weight between 30 and 500 kg (66 to 1,102 lb).";
    if (draft.targetWeightKg !== null && !inRange(draft.targetWeightKg, WEIGHT_RANGE_KG)) found.targetWeightKg = "Enter a target between 30 and 500 kg, or leave it empty.";
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstInvalid(formRef.current);
      return setError("Check the highlighted answers.");
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);

    const profilePatch = changedFields(
      { age: profile?.age ?? null, gender: profile?.gender ?? null, height: profile?.height ?? null, target_weight: profile?.target_weight ?? null },
      { age, gender: draft.gender, height: draft.heightCm, target_weight: draft.targetWeightKg },
    );
    const prefsPatch = changedFields(
      { primary_goal: prefs.primary_goal, activity_level: prefs.activity_level, height_unit: prefs.height_unit, weight_unit: prefs.weight_unit },
      { primary_goal: draft.goal, activity_level: draft.activity, height_unit: draft.heightUnit, weight_unit: draft.weightUnit },
    );
    const weightChanged = !sameWeight(draft.weightKg, data.currentWeightKg);
    if (!Object.keys(profilePatch).length && !Object.keys(prefsPatch).length && !weightChanged) {
      onClose();
      return void onSaved(NO_CHANGES);
    }

    setSaving(true);
    setError("");
    if (Object.keys(profilePatch).length) {
      const saved = await updateProfileRow(supabase, data.userId, profilePatch);
      if (saved.error) return failed(setSaving, setError);
    }
    if (Object.keys(prefsPatch).length) {
      const saved = await savePreferences(supabase, data.userId, prefsPatch, { v2 });
      if (saved.error) return failed(setSaving, setError, saved.error.code === "23514" ? "That goal isn't available yet. Choose another for now." : undefined);
    }
    if (weightChanged && draft.weightKg !== null) {
      // A changed weight is a new weigh-in for today (on Progress too), and keeps profiles.weight in step.
      const logged = await logWeighIn(supabase, data.userId, draft.weightKg, "Profile update");
      if (logged.error) return failed(setSaving, setError, "Your details were saved, but the new weight couldn't be added to your progress. Try saving again.");
    }
    await onSaved("Body and goal saved. Your daily targets are updated.");
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="body" title="Body and goal" description="Used for your calorie and protein targets." icon={<Ruler size={18} />} editing={editing} onEdit={start} canEdit>
      {!editing ? (
        <DetailList>
          <Detail label="Age">{profile?.age != null ? `${profile.age} years` : <NotSet />}</Detail>
          <Detail label="Sex for the calorie formula">{optionLabel(SEX_OPTIONS, profile?.gender) ?? <NotSet />}</Detail>
          <Detail label="Height">{formatHeight(profile?.height, prefs.height_unit) ?? <NotSet />}</Detail>
          <Detail label="Current weight">
            {formatWeight(data.currentWeightKg, prefs.weight_unit) ?? <NotSet />}
            {data.latestWeighIn && <span className="ml-1.5 font-normal text-fitx-text-secondary">· logged {new Date(`${data.latestWeighIn.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
          </Detail>
          <Detail label="Target weight">{formatWeight(profile?.target_weight, prefs.weight_unit) ?? <NotSet />}</Detail>
          <Detail label="Main goal">{optionLabel(GOAL_OPTIONS, prefs.primary_goal)}</Detail>
          <Detail label="Daily activity" wide>{optionLabel(ACTIVITY_OPTIONS, prefs.activity_level)}<span className="block text-xs font-normal text-fitx-text-secondary">{ACTIVITY_OPTIONS.find((option) => option.value === prefs.activity_level)?.hint}</span></Detail>
        </DetailList>
      ) : (
        <form ref={formRef} noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Age" value={draft.age} onChange={(value) => set("age", value.replace(/[^\d]/g, ""))} error={errors.age} inputMode="numeric" suffix="years" maxLength={3} required />
            </div>
            <ChoiceGroup legend="Sex for the calorie formula" options={SEX_OPTIONS} value={draft.gender} onChange={(value) => set("gender", value)} columns="grid-cols-1 sm:grid-cols-3" showHints={false} />
            <div className="grid gap-5 lg:grid-cols-2">
              <HeightField cm={draft.heightCm} unit={draft.heightUnit} onChange={(cm) => set("heightCm", cm)} onUnitChange={(unit) => set("heightUnit", unit)} error={errors.heightCm} required />
              <WeightField label="Current weight" hint="A change is logged as today's weigh-in." kg={draft.weightKg} unit={draft.weightUnit} onChange={(kg) => set("weightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.weightKg} required />
              <WeightField label="Target weight" kg={draft.targetWeightKg} unit={draft.weightUnit} onChange={(kg) => set("targetWeightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.targetWeightKg} />
            </div>
            <ChoiceGroup
              legend="Main goal"
              options={GOAL_OPTIONS}
              value={draft.goal}
              onChange={(value) => set("goal", value)}
              disabledValues={v2 ? [] : GOAL_OPTIONS.map((option) => option.value).filter((goal) => !GOALS_BEFORE_PROFILE_V2.includes(goal))}
              hint={v2 ? undefined : "Weight gain and weight loss arrive with the next FITX update."}
            />
            <ChoiceGroup legend="Daily activity, outside workouts too" options={ACTIVITY_OPTIONS} value={draft.activity} onChange={(value) => set("activity", value)} columns="grid-cols-1 sm:grid-cols-2" />
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

// ─── Diet ────────────────────────────────────────────────────────────────────────────────────────

type DietDraft = {
  diet: DietType | null;
  allergies: AllergyKey[];
  customAllergies: string[];
  meals: number;
  water: string;
  foodRules: FoodRule[];
  cuisines: Cuisine[];
  dislikes: string[];
  budgetLevel: BudgetLevel | null;
  monthlyBudget: string;
};

export function DietSection({ data, editing, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const allergies = splitAllergies(prefs.allergies);
  const original: DietDraft = {
    diet: prefs.diet_type,
    allergies: allergies.keys,
    customAllergies: allergies.custom,
    meals: prefs.meals_per_day,
    water: String(prefs.daily_water_goal_ml),
    foodRules: prefs.food_rules,
    cuisines: prefs.cuisines,
    dislikes: prefs.food_dislikes,
    budgetLevel: prefs.food_budget_level,
    monthlyBudget: prefs.monthly_food_budget_inr == null ? "" : String(prefs.monthly_food_budget_inr),
  };
  const [draft, setDraft] = useState(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof DietDraft>(key: K, value: DietDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => withoutKey(current, key));
    setError("");
  };
  const mealOptions = [...new Set([...MEALS_PER_DAY, prefs.meals_per_day])].sort((a, b) => a - b).map((value) => ({ value, label: String(value) }));

  const start = () => {
    setDraft(original);
    setErrors({});
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const water = Number(draft.water);
    if (!draft.water.trim() || !Number.isFinite(water) || !inRange(water, WATER_RANGE_ML)) found.water = `Enter ${WATER_RANGE_ML.min.toLocaleString("en-IN")} to ${WATER_RANGE_ML.max.toLocaleString("en-IN")} ml.`;
    const budget = parseRupees(draft.monthlyBudget);
    if (budget !== null && (Number.isNaN(budget) || !inRange(budget, MONTHLY_BUDGET_RANGE))) found.monthlyBudget = `Enter ${formatRupees(MONTHLY_BUDGET_RANGE.min)} to ${formatRupees(MONTHLY_BUDGET_RANGE.max)}, or leave it empty.`;
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstInvalid(formRef.current);
      return setError("Check the highlighted answers.");
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);

    const before = {
      diet_type: prefs.diet_type, allergies: prefs.allergies, meals_per_day: prefs.meals_per_day, daily_water_goal_ml: prefs.daily_water_goal_ml,
      food_rules: prefs.food_rules, cuisines: prefs.cuisines, food_dislikes: prefs.food_dislikes, food_budget_level: prefs.food_budget_level, monthly_food_budget_inr: prefs.monthly_food_budget_inr,
    };
    const after = {
      diet_type: draft.diet, allergies: joinKnown(draft.allergies, draft.customAllergies), meals_per_day: draft.meals, daily_water_goal_ml: Math.round(water),
      food_rules: draft.foodRules, cuisines: draft.cuisines, food_dislikes: draft.dislikes, food_budget_level: draft.budgetLevel, monthly_food_budget_inr: budget,
    };
    const patch: Record<string, unknown> = changedFields(before, after);
    if ("diet_type" in patch) patch.dietary_preferences = legacyDietaryPreferences(draft.diet, data.legacy.dietaryPreferences);
    if (!Object.keys(patch).length) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    setSaving(true);
    setError("");
    const saved = await savePreferences(supabase, data.userId, patch, { v2 });
    if (saved.error) return failed(setSaving, setError);
    await onSaved(saved.skipped.length ? "Diet saved. Budget, cuisines and food rules will save once FITX's next update is live." : "Diet saved.");
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="diet" title="Diet" description="For food suggestions and meal plans that fit how you eat." icon={<Salad size={18} />} editing={editing} onEdit={start} canEdit>
      {!editing ? (
        <DetailList>
          <Detail label="Diet">{optionLabel(DIET_OPTIONS, prefs.diet_type) ?? <NotSet />}</Detail>
          <Detail label="Meals a day">{prefs.meals_per_day}</Detail>
          <Detail label="Allergies and intolerances" wide><ChipList items={labelsFor(ALLERGY_OPTIONS, prefs.allergies)} /></Detail>
          <Detail label="Daily water target">{(prefs.daily_water_goal_ml / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} litres</Detail>
          {v2 && <>
            <Detail label="Food budget">
              {prefs.food_budget_level || prefs.monthly_food_budget_inr != null
                ? [optionLabel(BUDGET_LEVEL_OPTIONS, prefs.food_budget_level), prefs.monthly_food_budget_inr != null ? `${formatRupees(prefs.monthly_food_budget_inr)} a month` : null].filter(Boolean).join(" · ")
                : <NotSet />}
            </Detail>
            <Detail label="Food rules" wide><ChipList items={labelsFor(FOOD_RULE_OPTIONS, prefs.food_rules)} /></Detail>
            <Detail label="Cuisines you enjoy" wide><ChipList items={labelsFor(CUISINE_OPTIONS, prefs.cuisines)} empty="No preference" /></Detail>
            <Detail label="Foods you don't eat" wide><ChipList items={prefs.food_dislikes} /></Detail>
          </>}
        </DetailList>
      ) : (
        <form ref={formRef} noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Which describes you best?" options={DIET_OPTIONS} value={draft.diet} onChange={(value) => set("diet", value)} />
            <ChipGroup legend="Food allergies or intolerances" hint="Leave these empty if you have none." options={ALLERGY_OPTIONS} values={draft.allergies} onChange={(values) => set("allergies", values)} />
            <TagInput legend="Other allergies" values={draft.customAllergies} onChange={(values) => set("customAllergies", values)} addLabel="Add allergy" placeholder="For example kiwi" />
            <div className="grid gap-6 sm:grid-cols-2">
              <ChoiceGroup legend="Meals a day" options={mealOptions} value={draft.meals} onChange={(value) => set("meals", value)} columns="grid-cols-6 sm:grid-cols-3" showHints={false} compact />
              <TextField label="Daily water target" value={draft.water} onChange={(value) => set("water", value.replace(/[^\d]/g, ""))} error={errors.water} inputMode="numeric" suffix="ml" maxLength={5} required />
            </div>
            {v2 ? <>
              <ChoiceGroup legend="How tight is your food budget?" options={BUDGET_LEVEL_OPTIONS} value={draft.budgetLevel} onChange={(value) => set("budgetLevel", value)} columns="grid-cols-1 sm:grid-cols-3" />
              <TextField label="Monthly food budget" hint="Roughly what you spend on food a month, in rupees." value={draft.monthlyBudget} onChange={(value) => set("monthlyBudget", value)} error={errors.monthlyBudget} inputMode="numeric" placeholder="For example 6,000" suffix="₹ / month" />
              <ChipGroup legend="Food rules you follow" options={FOOD_RULE_OPTIONS} values={draft.foodRules} onChange={(values) => set("foodRules", values)} />
              <ChipGroup legend="Cuisines you enjoy" options={CUISINE_OPTIONS} values={draft.cuisines} onChange={(values) => set("cuisines", values)} />
              <TagInput legend="Foods you don't eat" hint="Dislikes count too." values={draft.dislikes} onChange={(values) => set("dislikes", values)} addLabel="Add food" placeholder="For example bitter gourd" max={MAX_FOOD_DISLIKES} />
            </> : <p className="text-xs leading-5 text-fitx-text-secondary">Food budget, cuisines and food rules arrive with the next FITX update.</p>}
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

// ─── Training ────────────────────────────────────────────────────────────────────────────────────

type TrainingDraft = {
  location: TrainingLocation;
  experience: Experience;
  equipment: EquipmentKey[];
  days: number;
  minutes: number;
  split: WorkoutSplit;
  limitations: LimitationKey[];
  customLimitations: string[];
};

const TRAINING_EQUIPMENT = EQUIPMENT_OPTIONS.filter((option) => option.value !== "bodyweight");

export function TrainingSection({ data, editing, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const limitations = splitLimitations(prefs.limitations);
  const original: TrainingDraft = {
    location: prefs.workout_location,
    experience: prefs.fitness_level,
    equipment: prefs.equipment,
    days: prefs.workouts_per_week,
    minutes: prefs.session_duration_minutes,
    split: prefs.workout_split,
    limitations: limitations.keys,
    customLimitations: limitations.custom,
  };
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof TrainingDraft>(key: K, value: TrainingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const sessionOptions = [...new Set([...SESSION_LENGTHS, prefs.session_duration_minutes])].sort((a, b) => a - b).map((value) => ({ value, label: `${value} min` }));
  const dayOptions = DAYS_PER_WEEK.map((value) => ({ value, label: String(value) }));
  const unknown = data.legacy.unknownEquipment;

  const start = () => {
    setDraft(original);
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);
    const before = {
      workout_location: prefs.workout_location, fitness_level: prefs.fitness_level, equipment: prefs.equipment, workouts_per_week: prefs.workouts_per_week,
      session_duration_minutes: prefs.session_duration_minutes, workout_split: prefs.workout_split, limitations: prefs.limitations,
    };
    const after = {
      workout_location: draft.location, fitness_level: draft.experience, equipment: ["bodyweight", ...draft.equipment.filter((key) => key !== "bodyweight")], workouts_per_week: draft.days,
      session_duration_minutes: draft.minutes, workout_split: draft.split, limitations: joinKnown(draft.limitations, draft.customLimitations),
    };
    const patch: Record<string, unknown> = changedFields(before, after);
    // Saving equipment also replaces any old typed entries the workout generator couldn't match.
    if (unknown.length && !("equipment" in patch)) patch.equipment = after.equipment;
    if (!Object.keys(patch).length) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    setSaving(true);
    setError("");
    const saved = await savePreferences(supabase, data.userId, patch, { v2 });
    if (saved.error) return failed(setSaving, setError);
    await onSaved(saved.skipped.length ? "Training saved. Injury details will save once FITX's next update is live." : "Training saved. New workouts use these settings.");
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="training" title="Training" description="Workouts are built from these." icon={<Dumbbell size={18} />} editing={editing} onEdit={start} canEdit>
      {!editing ? (
        <DetailList>
          <Detail label="Where you train">{optionLabel(LOCATION_OPTIONS, prefs.workout_location)}</Detail>
          <Detail label="Experience">{optionLabel(EXPERIENCE_OPTIONS, prefs.fitness_level)}</Detail>
          <Detail label="Training days">{prefs.workouts_per_week} a week</Detail>
          <Detail label="Session length">{prefs.session_duration_minutes} min</Detail>
          <Detail label="Split">{optionLabel(SPLIT_OPTIONS, prefs.workout_split)}</Detail>
          <Detail label="Equipment" wide>
            <ChipList items={labelsFor(EQUIPMENT_OPTIONS, prefs.equipment)} />
            {unknown.length > 0 && <span className="mt-2 block text-xs font-normal leading-5 text-fitx-text-secondary">Not used for workouts: {unknown.join(", ")}. Edit and pick the matching equipment to use it.</span>}
          </Detail>
          {v2 && <Detail label="Injuries or areas to go easy on" wide><ChipList items={labelsFor(LIMITATION_OPTIONS, prefs.limitations)} /></Detail>}
        </DetailList>
      ) : (
        <form noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Where do you usually train?" options={LOCATION_OPTIONS} value={draft.location} onChange={(value) => set("location", value)} columns="grid-cols-2 sm:grid-cols-4" showHints={false} compact />
            <ChoiceGroup legend="Training experience" options={EXPERIENCE_OPTIONS} value={draft.experience} onChange={(value) => set("experience", value)} columns="grid-cols-1 sm:grid-cols-3" />
            <ChipGroup legend="Equipment you can use" hint="Bodyweight exercises are always included." options={TRAINING_EQUIPMENT} values={draft.equipment} onChange={(values) => set("equipment", values)} />
            <ChoiceGroup legend="Training days a week" options={dayOptions} value={draft.days} onChange={(value) => set("days", value)} columns="grid-cols-4 sm:grid-cols-7" showHints={false} compact />
            <ChoiceGroup legend="Typical session length" options={sessionOptions} value={draft.minutes} onChange={(value) => set("minutes", value)} columns="grid-cols-3 sm:grid-cols-6" showHints={false} compact />
            <ChoiceGroup legend="Preferred training split" options={SPLIT_OPTIONS} value={draft.split} onChange={(value) => set("split", value)} />
            {v2 ? <>
              <ChipGroup legend="Injuries or areas to go easy on" options={LIMITATION_OPTIONS} values={draft.limitations} onChange={(values) => set("limitations", values)} />
              <TagInput legend="Anything else to work around?" values={draft.customLimitations} onChange={(values) => set("customLimitations", values)} addLabel="Add limitation" placeholder="Describe it briefly" maxLength={60} max={5} />
            </> : <p className="text-xs leading-5 text-fitx-text-secondary">Injury and limitation details arrive with the next FITX update.</p>}
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

function withoutKey(errors: Record<string, string>, key: string) {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

function failed(setSaving: (value: boolean) => void, setError: (value: string) => void, message = WRITE_FAILED) {
  setSaving(false);
  setError(message);
}
