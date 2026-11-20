"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dumbbell, Ruler, Salad, X } from "lucide-react";
import { BirthDateField, ChipGroup, ChoiceGroup, HeightField, TagInput, TextField, WeightField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import { EquipmentPicker } from "@/components/workouts/EquipmentPicker";
import {
  ACTIVITY_OPTIONS,
  AGE_RANGE,
  ALLERGY_OPTIONS,
  BUDGET_LEVEL_OPTIONS,
  CUISINE_OPTIONS,
  DAYS_PER_WEEK,
  DIET_OPTIONS,
  EXPERIENCE_OPTIONS,
  FOOD_RULE_OPTIONS,
  FOOD_SOURCE_OPTIONS,
  GOAL_OPTIONS,
  HEIGHT_RANGE_CM,
  LIMITATION_OPTIONS,
  LOCATION_OPTIONS,
  MAX_CUSTOM_LIMITATIONS,
  MAX_FOOD_DISLIKES,
  MAX_LIMITATION_LENGTH,
  MEALS_PER_DAY,
  MONTHLY_BUDGET_RANGE,
  NUTRITION_FOCUS_OPTIONS,
  SESSION_LENGTHS,
  SEX_OPTIONS,
  SPLIT_OPTIONS,
  WATER_RANGE_ML,
  WEIGHT_RANGE_KG,
  birthDateEdit,
  commitDraft,
  formatHeight,
  formatRupees,
  formatWeight,
  goalsAwaitingMigration,
  goalsAwaitingMigrationHint,
  inRange,
  joinKnown,
  joinLimitations,
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
  type Experience,
  type FoodRule,
  type FoodSource,
  type Goal,
  type HeightUnit,
  type LimitationKey,
  type NutritionFocus,
  type Sex,
  type TrainingLocation,
  type WeightUnit,
  type WorkoutSplit,
} from "@/lib/domain/profile-options";
import { changedFields, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import { saveEquipmentProfile } from "@/lib/training/data";
import { equipmentLabel } from "@/lib/training/equipment";
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
const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((key, index) => key === [...b].sort()[index]);

/** What auto workouts on the Workouts page read (location, equipment, level, session length, split). */
const AUTO_WORKOUT_COLUMNS = ["workout_location", "fitness_level", "session_duration_minutes", "workout_split"];
const INJURY_NOTE = "Auto workouts don’t avoid these yet, so skip or swap any exercise that hurts. The AI coach takes them into account when you turn on “Use my FITX data”.";

// ─── Body and goal ───────────────────────────────────────────────────────────────────────────────

type BodyDraft = {
  age: string;
  /** YYYY-MM-DD, or "" (used instead of age once profiles.date_of_birth exists). */
  birthDate: string;
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
    birthDate: profile?.date_of_birth ?? "",
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
  // With a birth date column the database keeps age equal to the birth date's, so the birth date is what's edited.
  const byBirthDate = data.schema.onboardingV3;
  const unavailableGoals = goalsAwaitingMigration(data.schema);

  const start = () => {
    setDraft(original);
    setErrors({});
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    // Age and height may be removed (the targets then need them again); weight comes from weigh-ins.
    const birth = birthDateEdit({ age: profile?.age ?? null, date_of_birth: profile?.date_of_birth ?? null }, draft.birthDate);
    const typedAge = draft.age.trim() ? Number(draft.age) : null;
    const age = byBirthDate ? birth.age : typedAge;
    if (byBirthDate && birth.error) found.birthDate = birth.error;
    if (typedAge !== null && !byBirthDate && (!Number.isInteger(typedAge) || !inRange(typedAge, AGE_RANGE))) found.age = `Enter a whole number from ${AGE_RANGE.min} to ${AGE_RANGE.max}, or leave it empty.`;
    if (draft.heightCm !== null && !inRange(draft.heightCm, HEIGHT_RANGE_CM)) found.heightCm = "Enter a height between 90 and 250 cm (2 ft 11 in to 8 ft 2 in), or leave it empty.";
    if (!inRange(draft.weightKg, WEIGHT_RANGE_KG)) found.weightKg = "Enter a weight between 30 and 500 kg (66 to 1,102 lb).";
    if (draft.targetWeightKg !== null && !inRange(draft.targetWeightKg, WEIGHT_RANGE_KG)) found.targetWeightKg = "Enter a target between 30 and 500 kg, or leave it empty.";
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstInvalid(formRef.current);
      return setError("Check the highlighted answers.");
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);

    const profilePatch = {
      ...changedFields(
        { gender: profile?.gender ?? null, height: profile?.height ?? null, target_weight: profile?.target_weight ?? null },
        { gender: draft.gender, height: draft.heightCm, target_weight: draft.targetWeightKg },
      ),
      ...(byBirthDate ? birth.patch : changedFields({ age: profile?.age ?? null }, { age: typedAge })),
    };
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
    await onSaved(age !== null && draft.heightCm !== null
      ? "Body and goal saved. Your daily targets are updated."
      : "Body and goal saved. Add your age and height to see your daily targets.");
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="body" title="Body and goal" description="Used for your calorie and protein targets, and in the AI coach’s advice if you use it." icon={<Ruler size={18} />} editing={editing} onEdit={start} canEdit>
      {!editing ? (
        <DetailList>
          <Detail label="Age">{profile?.age != null ? `${profile.age} years` : <NotSet />}</Detail>
          {byBirthDate && <Detail label="Date of birth">{profile?.date_of_birth ? formatBirthDate(profile.date_of_birth) : <NotSet />}</Detail>}
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
            <p className="text-xs leading-5 text-fitx-text-secondary">Your daily targets need your age and height. You can leave them empty, but FITX then can’t calculate targets.</p>
            <div className="grid gap-5 sm:grid-cols-2">
              {byBirthDate ? (
                <div>
                  <BirthDateField value={draft.birthDate} onChange={(value) => set("birthDate", value)} error={errors.birthDate} required={false} />
                  {!profile?.date_of_birth && profile?.age != null && <p className="mt-1.5 text-xs leading-5 text-fitx-text-secondary">Age on file: {profile.age} years. Add your date of birth to keep it up to date.</p>}
                </div>
              ) : (
                <TextField label="Age" value={draft.age} onChange={(value) => set("age", value.replace(/[^\d]/g, ""))} error={errors.age} inputMode="numeric" suffix="years" maxLength={3} />
              )}
            </div>
            <ChoiceGroup legend="Sex for the calorie formula" options={SEX_OPTIONS} value={draft.gender} onChange={(value) => set("gender", value)} columns="grid-cols-1 sm:grid-cols-3" showHints={false} />
            <div className="grid gap-5 lg:grid-cols-2">
              <HeightField cm={draft.heightCm} unit={draft.heightUnit} onChange={(cm) => set("heightCm", cm)} onUnitChange={(unit) => set("heightUnit", unit)} error={errors.heightCm} showUnits={v2} />
              <WeightField label="Current weight" hint="A change is logged as today's weigh-in." kg={draft.weightKg} unit={draft.weightUnit} onChange={(kg) => set("weightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.weightKg} required showUnits={v2} />
              <WeightField label="Target weight" kg={draft.targetWeightKg} unit={draft.weightUnit} onChange={(kg) => set("targetWeightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.targetWeightKg} showUnits={v2} />
            </div>
            <ChoiceGroup
              legend="Main goal"
              options={GOAL_OPTIONS}
              value={draft.goal}
              onChange={(value) => set("goal", value)}
              disabledValues={unavailableGoals}
              hint={goalsAwaitingMigrationHint(unavailableGoals)}
            />
            <ChoiceGroup legend="Daily activity, outside workouts too" options={ACTIVITY_OPTIONS} value={draft.activity} onChange={(value) => set("activity", value)} columns="grid-cols-1 sm:grid-cols-2" />
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

/** A stored YYYY-MM-DD birth date for display, read as a calendar date (no time zone shift). */
function formatBirthDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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
  foodSource: FoodSource | null;
  nutritionFocus: NutritionFocus | null;
  /** Typed into a tag field but not added yet; saved with the section. */
  allergyDraft: string;
  dislikeDraft: string;
};

/** It guides the coach's meal plans and leaves FITX's targets alone (onboarding says the same). */
const NUTRITION_GOAL_HINT = "Shapes coach meal plans, not your daily targets.";

export function DietSection({ data, editing, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  // Onboarding v3's food preference and nutrition goal save with the v2 columns' tier, so they need both.
  const v3 = v2 && data.schema.onboardingV3;
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
    foodSource: prefs.food_source,
    nutritionFocus: prefs.nutrition_focus,
    allergyDraft: "",
    dislikeDraft: "",
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
      ...(v3 ? { food_source: prefs.food_source, nutrition_focus: prefs.nutrition_focus } : {}),
    };
    // Text still in a tag field counts as an entry.
    const customAllergies = commitDraft(draft.customAllergies, draft.allergyDraft);
    const dislikes = commitDraft(draft.dislikes, draft.dislikeDraft, { max: MAX_FOOD_DISLIKES });
    const after = {
      diet_type: draft.diet, allergies: joinKnown(draft.allergies, customAllergies), meals_per_day: draft.meals, daily_water_goal_ml: Math.round(water),
      food_rules: draft.foodRules, cuisines: draft.cuisines, food_dislikes: dislikes, food_budget_level: draft.budgetLevel, monthly_food_budget_inr: budget,
      ...(v3 ? { food_source: draft.foodSource, nutrition_focus: draft.nutritionFocus } : {}),
    };
    const patch: Record<string, unknown> = changedFields(before, after);
    if ("diet_type" in patch) patch.dietary_preferences = legacyDietaryPreferences(draft.diet, data.legacy.dietaryPreferences);
    if (!Object.keys(patch).length) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    setSaving(true);
    setError("");
    const saved = await savePreferences(supabase, data.userId, patch, { v2, v3 });
    if (saved.error) return failed(setSaving, setError);
    // The diet type is also kept in the original column, so only the other new answers can be pending.
    const pending = saved.skipped.filter((column) => column !== "diet_type");
    await onSaved(pending.length ? "Diet saved. Budget, cuisines and food rules will save once FITX's next update is live." : "Diet saved.");
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="diet" title="Diet" description="How you eat and what you avoid. The AI coach’s meal plans follow these when you turn on “Use my FITX data” (18 and over)." icon={<Salad size={18} />} editing={editing} onEdit={start} canEdit>
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
          {v3 && <>
            <Detail label="Food preference">{optionLabel(FOOD_SOURCE_OPTIONS, prefs.food_source) ?? <NotSet />}</Detail>
            <Detail label="Nutrition goal">{optionLabel(NUTRITION_FOCUS_OPTIONS, prefs.nutrition_focus) ?? <NotSet />}</Detail>
          </>}
        </DetailList>
      ) : (
        <form ref={formRef} noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Which describes you best?" options={DIET_OPTIONS} value={draft.diet} onChange={(value) => set("diet", value)} onClear={() => set("diet", null)} clearLabel="Clear your diet" />
            <ChipGroup legend="Food allergies or intolerances" hint="Leave these empty if you have none." options={ALLERGY_OPTIONS} values={draft.allergies} onChange={(values) => set("allergies", values)} />
            <TagInput legend="Other allergies" values={draft.customAllergies} onChange={(values) => set("customAllergies", values)} draft={draft.allergyDraft} onDraftChange={(value) => set("allergyDraft", value)} addLabel="Add allergy" placeholder="For example kiwi" />
            <div className="grid gap-6 sm:grid-cols-2">
              <ChoiceGroup legend="Meals a day" options={mealOptions} value={draft.meals} onChange={(value) => set("meals", value)} columns="grid-cols-6 sm:grid-cols-3" showHints={false} compact />
              <TextField label="Daily water target" value={draft.water} onChange={(value) => set("water", value.replace(/[^\d]/g, ""))} error={errors.water} inputMode="numeric" suffix="ml" maxLength={5} required />
            </div>
            {v2 ? <>
              <ChoiceGroup legend="How tight is your food budget?" options={BUDGET_LEVEL_OPTIONS} value={draft.budgetLevel} onChange={(value) => set("budgetLevel", value)} columns="grid-cols-1 sm:grid-cols-3" onClear={() => set("budgetLevel", null)} clearLabel="Clear your budget level" />
              <TextField label="Monthly food budget" hint="Roughly what you spend on food a month, in rupees." value={draft.monthlyBudget} onChange={(value) => set("monthlyBudget", value)} error={errors.monthlyBudget} inputMode="numeric" placeholder="For example 6,000" suffix="₹ / month" />
              <ChipGroup legend="Food rules you follow" options={FOOD_RULE_OPTIONS} values={draft.foodRules} onChange={(values) => set("foodRules", values)} />
              <ChipGroup legend="Cuisines you enjoy" options={CUISINE_OPTIONS} values={draft.cuisines} onChange={(values) => set("cuisines", values)} />
              <TagInput legend="Foods you don't eat" hint="Dislikes count too." values={draft.dislikes} onChange={(values) => set("dislikes", values)} draft={draft.dislikeDraft} onDraftChange={(value) => set("dislikeDraft", value)} addLabel="Add food" placeholder="For example bitter gourd" max={MAX_FOOD_DISLIKES} />
              {v3 && <>
                <ChoiceGroup legend="Food preference" options={FOOD_SOURCE_OPTIONS} value={draft.foodSource} onChange={(value) => set("foodSource", value)} columns="grid-cols-1 sm:grid-cols-3" onClear={() => set("foodSource", null)} clearLabel="Clear your food preference" />
                <ChoiceGroup legend="Nutrition goal" hint={NUTRITION_GOAL_HINT} options={NUTRITION_FOCUS_OPTIONS} value={draft.nutritionFocus} onChange={(value) => set("nutritionFocus", value)} columns="grid-cols-1 sm:grid-cols-3" onClear={() => set("nutritionFocus", null)} clearLabel="Clear your nutrition goal" />
              </>}
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
  homeEquipment: string[];
  gymEquipment: string[];
  /** Older typed equipment that matches no item; kept unless the user removes it. */
  unknownEquipment: string[];
  days: number;
  minutes: number;
  split: WorkoutSplit;
  limitations: LimitationKey[];
  customLimitations: string[];
  /** Typed into the limitations field but not added yet; saved with the section. */
  limitationDraft: string;
};

export function TrainingSection({ data, editing, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const lists = data.equipmentLists;
  const limitations = splitLimitations(prefs.limitations);
  const original: TrainingDraft = {
    location: prefs.workout_location,
    experience: prefs.fitness_level,
    homeEquipment: lists.home.keys,
    gymEquipment: lists.gym.keys,
    unknownEquipment: data.legacy.unknownEquipment,
    days: prefs.workouts_per_week,
    minutes: prefs.session_duration_minutes,
    split: prefs.workout_split,
    limitations: limitations.keys,
    customLimitations: limitations.custom,
    limitationDraft: "",
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
  const equipmentChips = (keys: readonly string[]) => keys.map(equipmentLabel);

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
      workout_location: prefs.workout_location, fitness_level: prefs.fitness_level, workouts_per_week: prefs.workouts_per_week,
      session_duration_minutes: prefs.session_duration_minutes, workout_split: prefs.workout_split, limitations: prefs.limitations,
    };
    const after = {
      workout_location: draft.location, fitness_level: draft.experience, workouts_per_week: draft.days,
      session_duration_minutes: draft.minutes, workout_split: draft.split,
      limitations: joinLimitations(draft.limitations, commitDraft(draft.customLimitations, draft.limitationDraft, { max: MAX_CUSTOM_LIMITATIONS, maxLength: MAX_LIMITATION_LENGTH })),
    };
    const patch: Record<string, unknown> = changedFields(before, after);
    const homeChanged = !sameKeys(draft.homeEquipment, original.homeEquipment);
    const gymChanged = !sameKeys(draft.gymEquipment, original.gymEquipment);
    const unknownChanged = !sameKeys(draft.unknownEquipment, original.unknownEquipment);
    // The original answer seeds the Home list until one is saved, and the AI coach reads it; older words that
    // match nothing stay unless the user removed them.
    if (homeChanged || unknownChanged) patch.equipment = [...draft.homeEquipment, ...draft.unknownEquipment];
    if (!Object.keys(patch).length && !homeChanged && !gymChanged) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    setSaving(true);
    setError("");
    if (lists.available) {
      // The lists Workouts uses. One that was never saved stays a starting point unless it changed here.
      for (const [context, changed, keys] of [["home", homeChanged, draft.homeEquipment], ["gym", gymChanged, draft.gymEquipment]] as const) {
        if (!changed) continue;
        const result = await saveEquipmentProfile(supabase, data.userId, context, keys);
        if (result.error) return failed(setSaving, setError);
      }
    }
    let skipped: string[] = [];
    if (Object.keys(patch).length) {
      const saved = await savePreferences(supabase, data.userId, patch, { v2 });
      if (saved.error) return failed(setSaving, setError);
      skipped = saved.skipped;
    }
    const usedByAutoWorkouts = homeChanged || gymChanged || AUTO_WORKOUT_COLUMNS.some((column) => column in patch);
    const parts = [usedByAutoWorkouts ? "Training saved. New auto workouts use these settings." : "Training saved."];
    if (skipped.includes("limitations")) parts.push("Injury details will save once FITX’s next update is live.");
    else if ("limitations" in patch && after.limitations.length) parts.push("Auto workouts don’t avoid injuries yet.");
    await onSaved(parts.join(" "));
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="training" title="Training" description="Auto workouts use where you train, your equipment, experience, session length and split." icon={<Dumbbell size={18} />} editing={editing} onEdit={start} canEdit>
      {!editing ? (
        <DetailList>
          <Detail label="Where you train">{optionLabel(LOCATION_OPTIONS, prefs.workout_location)}</Detail>
          <Detail label="Experience">{optionLabel(EXPERIENCE_OPTIONS, prefs.fitness_level)}</Detail>
          <Detail label="Training days">{prefs.workouts_per_week} a week<span className="block text-xs font-normal text-fitx-text-secondary">Your weekly workout goal on Home</span></Detail>
          <Detail label="Session length">{prefs.session_duration_minutes} min</Detail>
          <Detail label="Split">{optionLabel(SPLIT_OPTIONS, prefs.workout_split)}</Detail>
          <Detail label="Equipment at home" wide><ChipList items={equipmentChips(lists.home.keys)} empty="No equipment" /></Detail>
          <Detail label="Equipment at the gym" wide>
            {lists.gym.saved ? <ChipList items={equipmentChips(lists.gym.keys)} empty="No equipment" /> : <span className="font-normal text-fitx-text-secondary">A fully equipped gym, until you change it</span>}
            {unknown.length > 0 && <span className="mt-2 block text-xs font-normal leading-5 text-fitx-text-secondary">Older entries that match no equipment, so workouts don’t use them: {unknown.join(", ")}.</span>}
          </Detail>
          {v2 && (
            <Detail label="Injuries or areas to go easy on" wide>
              <ChipList items={labelsFor(LIMITATION_OPTIONS, prefs.limitations)} />
              {prefs.limitations.length > 0 && <span className="mt-2 block text-xs font-normal leading-5 text-fitx-text-secondary">{INJURY_NOTE}</span>}
            </Detail>
          )}
        </DetailList>
      ) : (
        <form noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Where do you usually train?" options={LOCATION_OPTIONS} value={draft.location} onChange={(value) => set("location", value)} columns="grid-cols-2 sm:grid-cols-4" showHints={false} compact />
            <ChoiceGroup legend="Training experience" options={EXPERIENCE_OPTIONS} value={draft.experience} onChange={(value) => set("experience", value)} columns="grid-cols-1 sm:grid-cols-3" />
            <fieldset>
              <legend className="text-sm font-semibold text-fitx-text">Equipment at home</legend>
              <p className="mb-3 mt-1 text-xs leading-5 text-fitx-text-secondary">What you can use when you train at home. The same list is on the Workouts page.</p>
              <EquipmentPicker context="home" value={draft.homeEquipment} onChange={(keys) => set("homeEquipment", keys)} />
            </fieldset>
            {lists.available ? (
              <fieldset>
                <legend className="text-sm font-semibold text-fitx-text">Equipment at the gym</legend>
                <p className="mb-3 mt-1 text-xs leading-5 text-fitx-text-secondary">{lists.gym.saved ? "What your gym has." : "Starts as a fully equipped gym: untick anything yours doesn’t have."}</p>
                <EquipmentPicker context="gym" value={draft.gymEquipment} onChange={(keys) => set("gymEquipment", keys)} />
              </fieldset>
            ) : (
              <p className="text-xs leading-5 text-fitx-text-secondary">Your gym’s equipment can be saved after FITX’s next update. Until then, auto workouts assume a fully equipped gym.</p>
            )}
            {draft.unknownEquipment.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-fitx-text">Older entries that match no equipment</p>
                <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">Workouts don’t use these. Pick the matching item above, then remove them.</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {draft.unknownEquipment.map((word) => (
                    <li key={word} className="inline-flex min-h-11 items-center rounded-full border border-fitx-border bg-fitx-surface-variant pl-4 text-sm text-fitx-text">
                      <span className="max-w-[16rem] truncate">{word}</span>
                      <button type="button" onClick={() => set("unknownEquipment", draft.unknownEquipment.filter((item) => item !== word))} aria-label={`Remove ${word}`} className="grid min-h-11 min-w-11 place-items-center rounded-full text-fitx-text-secondary hover:text-fitx-text">
                        <X size={15} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ChoiceGroup legend="Training days a week" hint="Sets your weekly workout goal on Home." options={dayOptions} value={draft.days} onChange={(value) => set("days", value)} columns="grid-cols-4 sm:grid-cols-7" showHints={false} compact />
            <ChoiceGroup legend="Typical session length" hint="Sets how long auto workouts are." options={sessionOptions} value={draft.minutes} onChange={(value) => set("minutes", value)} columns="grid-cols-3 sm:grid-cols-6" showHints={false} compact />
            <ChoiceGroup legend="Preferred training split" options={SPLIT_OPTIONS} value={draft.split} onChange={(value) => set("split", value)} />
            {v2 ? <>
              <ChipGroup legend="Injuries or areas to go easy on" hint={INJURY_NOTE} options={LIMITATION_OPTIONS} values={draft.limitations} onChange={(values) => set("limitations", values)} />
              <TagInput legend="Anything else to work around?" values={draft.customLimitations} onChange={(values) => set("customLimitations", values)} draft={draft.limitationDraft} onDraftChange={(value) => set("limitationDraft", value)} addLabel="Add limitation" placeholder="Describe it briefly" maxLength={MAX_LIMITATION_LENGTH} max={MAX_CUSTOM_LIMITATIONS} />
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
