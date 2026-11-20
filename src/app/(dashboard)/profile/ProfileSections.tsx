"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dumbbell, HeartPulse, Ruler, Salad, Target, X } from "lucide-react";
import { EquipmentGrid } from "@/components/equipment/EquipmentGrid";
import { BirthDateField, ChipGroup, ChoiceGroup, HeightField, TagInput, TextField, WeightField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import {
  ACTIVITY_OPTIONS,
  AGE_RANGE,
  ALLERGY_OPTIONS,
  BUDGET_LEVEL_OPTIONS,
  CUISINE_OPTIONS,
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
  MONTHLY_BUDGET_RANGE,
  NUTRITION_FOCUS_OPTIONS,
  ONBOARDING_DAYS_PER_WEEK,
  ONBOARDING_DIETS,
  ONBOARDING_MEAL_OPTIONS,
  SESSION_LENGTHS,
  SEX_OPTIONS,
  SPLIT_OPTIONS,
  WATER_RANGE_ML,
  WEIGHT_RANGE_KG,
  ageFromBirthDate,
  choicesKeeping,
  commitDraft,
  formatHeight,
  formatRupees,
  formatWeight,
  inRange,
  joinKnown,
  joinLimitations,
  legacyDietaryPreferences,
  normalizeBirthDate,
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
  unavailableProfileGoals,
} from "@/lib/domain/profile-options";
import { changedFields, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import { saveEquipmentProfile } from "@/lib/training/data";
import { equipmentLabel } from "@/lib/training/equipment";
import { ChipList, Detail, DetailList, EditActions, NotSet, SectionCard, type SectionNotice } from "./ProfileParts";

export type SectionId = "body" | "goal" | "training" | "food" | "limits";

export type SectionProps = {
  data: UserContextData;
  editing: boolean;
  notice: SectionNotice | null;
  onEdit: () => void;
  onClose: () => void;
  /** Reloads the shared context after a save, then shows the notice in the section. */
  onSaved: (notice: SectionNotice) => Promise<void>;
};

const WRITE_FAILED = "Your changes couldn't be saved. Check your connection and try again.";
const SAVED: SectionNotice = { tone: "saved", text: "Saved" };
const NO_CHANGES: SectionNotice = { tone: "saved", text: "No changes" };

const labelsFor = <V extends string>(options: readonly { value: V; label: string }[], values: readonly string[]) =>
  values.map((value) => optionLabel(options, value) ?? value);

const sameWeight = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.05);
const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((key, index) => key === [...b].sort()[index]);
const dateText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// ─── Body ────────────────────────────────────────────────────────────────────────────────────────

type BodyDraft = {
  birthDate: string;
  /** Used only before the onboarding v3 migration, when a birth date cannot be stored. */
  age: string;
  gender: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
};

export function BodySection({ data, editing, notice, onEdit, onClose, onSaved }: SectionProps) {
  const { profile, preferences: prefs } = data;
  const v2 = data.schema.preferencesV2;
  const v3 = data.schema.onboardingV3;
  const original: BodyDraft = {
    birthDate: profile?.date_of_birth ?? "",
    age: profile?.age == null ? "" : String(profile.age),
    gender: profile?.gender ?? null,
    heightCm: profile?.height ?? null,
    weightKg: data.currentWeightKg,
    targetWeightKg: profile?.target_weight ?? null,
    heightUnit: prefs.height_unit,
    weightUnit: prefs.weight_unit,
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

  const start = () => {
    setDraft(original);
    setErrors({});
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    let age: number | null = null;
    let birthDate: string | null = null;
    if (v3) {
      birthDate = draft.birthDate.trim() ? normalizeBirthDate(draft.birthDate) : null;
      age = ageFromBirthDate(birthDate);
      if (draft.birthDate.trim() && (!birthDate || age === null)) found.birthDate = "Enter a real date, not in the future.";
      else if (age !== null && !inRange(age, AGE_RANGE)) found.birthDate = `FITX is for ages ${AGE_RANGE.min} to ${AGE_RANGE.max}.`;
    } else {
      age = draft.age.trim() ? Number(draft.age) : null;
      if (age !== null && (!Number.isInteger(age) || !inRange(age, AGE_RANGE))) found.age = `Enter a whole number from ${AGE_RANGE.min} to ${AGE_RANGE.max}, or leave it empty.`;
    }
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

    const before = { age: profile?.age ?? null, gender: profile?.gender ?? null, height: profile?.height ?? null, target_weight: profile?.target_weight ?? null, ...(v3 ? { date_of_birth: profile?.date_of_birth ?? null } : {}) };
    const after = { age, gender: draft.gender, height: draft.heightCm, target_weight: draft.targetWeightKg, ...(v3 ? { date_of_birth: birthDate } : {}) };
    const profilePatch: Record<string, unknown> = changedFields(before, after);
    // The age always follows the birth date, so a changed date sends both.
    if ("date_of_birth" in profilePatch) profilePatch.age = age;
    const prefsPatch = changedFields({ height_unit: prefs.height_unit, weight_unit: prefs.weight_unit }, { height_unit: draft.heightUnit, weight_unit: draft.weightUnit });
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
      const saved = await savePreferences(supabase, data.userId, prefsPatch, { v2, v3 });
      if (saved.error) return failed(setSaving, setError);
    }
    if (weightChanged && draft.weightKg !== null) {
      // A changed weight is a new weigh-in for today (on Progress too), and keeps profiles.weight in step.
      const logged = await logWeighIn(supabase, data.userId, draft.weightKg, "Profile update");
      if (logged.error) return failed(setSaving, setError, "Your details were saved, but the new weight couldn't be added to your progress. Try saving again.");
    }
    await onSaved(age !== null && draft.heightCm !== null ? SAVED : { tone: "note", text: "Saved. Add your date of birth and height for daily targets." });
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="body" title="Body" icon={<Ruler size={18} />} editing={editing} onEdit={start} canEdit notice={notice}>
      {!editing ? (
        <DetailList>
          {v3 ? (
            <Detail label="Date of birth">{profile?.date_of_birth ? <>{dateText(profile.date_of_birth)}{profile.age !== null && <span className="ml-1.5 font-normal text-fitx-text-secondary">· {profile.age} years</span>}</> : profile?.age != null ? `${profile.age} years` : <NotSet />}</Detail>
          ) : (
            <Detail label="Age">{profile?.age != null ? `${profile.age} years` : <NotSet />}</Detail>
          )}
          <Detail label="Sex">{optionLabel(SEX_OPTIONS, profile?.gender) ?? <NotSet />}</Detail>
          <Detail label="Height">{formatHeight(profile?.height, prefs.height_unit) ?? <NotSet />}</Detail>
          <Detail label="Weight">
            {formatWeight(data.currentWeightKg, prefs.weight_unit) ?? <NotSet />}
            {data.latestWeighIn && <span className="ml-1.5 font-normal text-fitx-text-secondary">· {new Date(`${data.latestWeighIn.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
          </Detail>
          <Detail label="Target weight">{formatWeight(profile?.target_weight, prefs.weight_unit) ?? <NotSet />}</Detail>
        </DetailList>
      ) : (
        <form ref={formRef} noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-6">
            {v3 ? (
              <BirthDateField value={draft.birthDate} onChange={(value) => set("birthDate", value)} error={errors.birthDate} required={false} />
            ) : (
              <div className="max-w-xs">
                <TextField label="Age" value={draft.age} onChange={(value) => set("age", value.replace(/[^\d]/g, ""))} error={errors.age} inputMode="numeric" suffix="years" maxLength={3} />
              </div>
            )}
            <ChoiceGroup legend="Sex" hint="Used in the calorie formula." options={SEX_OPTIONS} value={draft.gender} onChange={(value) => set("gender", value)} columns="grid-cols-1 sm:grid-cols-3" showHints={false} />
            <div className="grid gap-5 lg:grid-cols-2">
              <HeightField cm={draft.heightCm} unit={draft.heightUnit} onChange={(cm) => set("heightCm", cm)} onUnitChange={(unit) => set("heightUnit", unit)} error={errors.heightCm} showUnits={v2} />
              <WeightField label="Weight" hint="A change logs today's weigh-in." kg={draft.weightKg} unit={draft.weightUnit} onChange={(kg) => set("weightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.weightKg} required showUnits={v2} />
              <WeightField label="Target weight" kg={draft.targetWeightKg} unit={draft.weightUnit} onChange={(kg) => set("targetWeightKg", kg)} onUnitChange={(unit) => set("weightUnit", unit)} error={errors.targetWeightKg} showUnits={v2} />
            </div>
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

// ─── Goal ────────────────────────────────────────────────────────────────────────────────────────

export function GoalSection({ data, editing, notice, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const v3 = data.schema.onboardingV3;
  const [goal, setGoal] = useState<Goal>(prefs.primary_goal);
  const [activity, setActivity] = useState<ActivityLevel>(prefs.activity_level);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unavailable = unavailableProfileGoals(data.schema);

  const start = () => {
    setGoal(prefs.primary_goal);
    setActivity(prefs.activity_level);
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch = changedFields({ primary_goal: prefs.primary_goal, activity_level: prefs.activity_level }, { primary_goal: goal, activity_level: activity });
    if (!Object.keys(patch).length) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);
    setSaving(true);
    setError("");
    const saved = await savePreferences(supabase, data.userId, patch, { v2, v3 });
    if (saved.error) return failed(setSaving, setError, saved.error.code === "23514" ? "That goal isn't available yet. Choose another for now." : undefined);
    await onSaved(data.targets ? { tone: "saved", text: "Saved · targets updated" } : SAVED);
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="goal" title="Goal" icon={<Target size={18} />} editing={editing} onEdit={start} canEdit notice={notice}>
      {!editing ? (
        <DetailList>
          <Detail label="Main goal">{optionLabel(GOAL_OPTIONS, prefs.primary_goal)}</Detail>
          <Detail label="Daily activity">{optionLabel(ACTIVITY_OPTIONS, prefs.activity_level)}</Detail>
        </DetailList>
      ) : (
        <form noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup
              legend="Main goal"
              options={GOAL_OPTIONS}
              value={goal}
              onChange={(value) => { setGoal(value); setError(""); }}
              disabledValues={unavailable}
              hint={unavailable.length ? `${unavailable.map((value) => optionLabel(GOAL_OPTIONS, value)).join(", ")} arrive with the next FITX update.` : undefined}
            />
            <ChoiceGroup legend="Daily activity, outside workouts too" options={ACTIVITY_OPTIONS} value={activity} onChange={(value) => { setActivity(value); setError(""); }} columns="grid-cols-1 sm:grid-cols-2" />
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
};

/** What auto workouts on the Workouts page read (location, equipment, level, session length, split). */
const AUTO_WORKOUT_COLUMNS = ["workout_location", "fitness_level", "session_duration_minutes", "workout_split"];

export function TrainingSection({ data, editing, notice, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const v3 = data.schema.onboardingV3;
  const lists = data.equipmentLists;
  const original: TrainingDraft = {
    location: prefs.workout_location,
    experience: prefs.fitness_level,
    homeEquipment: lists.home.keys,
    gymEquipment: lists.gym.keys,
    unknownEquipment: data.legacy.unknownEquipment,
    days: prefs.workouts_per_week,
    minutes: prefs.session_duration_minutes,
    split: prefs.workout_split,
  };
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof TrainingDraft>(key: K, value: TrainingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const sessionOptions = [...new Set([...SESSION_LENGTHS, prefs.session_duration_minutes])].sort((a, b) => a - b).map((value) => ({ value, label: `${value} min` }));
  // Weekly availability is 2 to 7 days; an older answer of 1 stays offered so it is never changed silently.
  const dayOptions = choicesKeeping(ONBOARDING_DAYS_PER_WEEK.map((value) => ({ value, label: String(value) })), prefs.workouts_per_week);
  const unknown = data.legacy.unknownEquipment;
  const equipmentChips = (keys: readonly string[]) => keys.map(equipmentLabel);
  const homeFirst = draft.location === "home" || draft.location === "outdoor";

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
      session_duration_minutes: prefs.session_duration_minutes, workout_split: prefs.workout_split,
    };
    const after = {
      workout_location: draft.location, fitness_level: draft.experience, workouts_per_week: draft.days,
      session_duration_minutes: draft.minutes, workout_split: draft.split,
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
    if (Object.keys(patch).length) {
      const saved = await savePreferences(supabase, data.userId, patch, { v2, v3 });
      if (saved.error) return failed(setSaving, setError);
    }
    const usedByAutoWorkouts = homeChanged || gymChanged || AUTO_WORKOUT_COLUMNS.some((column) => column in patch);
    await onSaved(usedByAutoWorkouts ? { tone: "saved", text: "Saved · new auto workouts use it" } : SAVED);
    setSaving(false);
    onClose();
  }

  const homeGrid = (
    <fieldset key="home">
      <legend className="text-sm font-semibold text-fitx-text">Home equipment</legend>
      <div className="mt-3"><EquipmentGrid context="home" label="Home equipment" value={draft.homeEquipment} onChange={(keys) => set("homeEquipment", keys)} /></div>
    </fieldset>
  );
  const gymGrid = lists.available ? (
    <fieldset key="gym">
      <legend className="text-sm font-semibold text-fitx-text">Gym equipment</legend>
      {!lists.gym.saved && <p className="mt-1 text-xs text-fitx-text-secondary">Starts as a full gym. Untick what yours lacks.</p>}
      <div className="mt-3"><EquipmentGrid context="gym" label="Gym equipment" value={draft.gymEquipment} onChange={(keys) => set("gymEquipment", keys)} /></div>
    </fieldset>
  ) : (
    <p key="gym" className="text-xs leading-5 text-fitx-text-secondary">Gym equipment saves after the next FITX update. Until then, a full gym is assumed.</p>
  );

  return (
    <SectionCard id="training" title="Training" icon={<Dumbbell size={18} />} editing={editing} onEdit={start} canEdit notice={notice}>
      {!editing ? (
        <DetailList>
          <Detail label="Experience">{optionLabel(EXPERIENCE_OPTIONS, prefs.fitness_level)}</Detail>
          <Detail label="Workout setup">{optionLabel(LOCATION_OPTIONS, prefs.workout_location)}</Detail>
          <Detail label="Weekly availability">{prefs.workouts_per_week} {prefs.workouts_per_week === 1 ? "day" : "days"} a week</Detail>
          <Detail label="Session length">{prefs.session_duration_minutes} min · {optionLabel(SPLIT_OPTIONS, prefs.workout_split)}</Detail>
          <Detail label="Home equipment" wide><ChipList items={equipmentChips(lists.home.keys)} empty="No equipment" /></Detail>
          <Detail label="Gym equipment" wide>
            {lists.gym.saved ? <ChipList items={equipmentChips(lists.gym.keys)} empty="No equipment" /> : <span className="font-normal text-fitx-text-secondary">A full gym, until you change it</span>}
            {unknown.length > 0 && <span className="mt-2 block text-xs font-normal leading-5 text-fitx-text-secondary">Not used for workouts: {unknown.join(", ")}</span>}
          </Detail>
        </DetailList>
      ) : (
        <form noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Experience" options={EXPERIENCE_OPTIONS} value={draft.experience} onChange={(value) => set("experience", value)} columns="grid-cols-1 sm:grid-cols-3" />
            <ChoiceGroup legend="Workout setup" options={LOCATION_OPTIONS} value={draft.location} onChange={(value) => set("location", value)} columns="grid-cols-2 sm:grid-cols-4" showHints={false} compact />
            <ChoiceGroup legend="Weekly availability" hint="Days a week. Sets your weekly goal on Home." options={dayOptions} value={draft.days} onChange={(value) => set("days", value)} columns="grid-cols-6" showHints={false} compact />
            <ChoiceGroup legend="Session length" options={sessionOptions} value={draft.minutes} onChange={(value) => set("minutes", value)} columns="grid-cols-3 sm:grid-cols-6" showHints={false} compact />
            <ChoiceGroup legend="Training split" options={SPLIT_OPTIONS} value={draft.split} onChange={(value) => set("split", value)} />
            {homeFirst ? [homeGrid, gymGrid] : [gymGrid, homeGrid]}
            {draft.unknownEquipment.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-fitx-text">Older entries</p>
                <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">Workouts don’t use these. Pick the match above, then remove them.</p>
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
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

// ─── Food ────────────────────────────────────────────────────────────────────────────────────────

type FoodDraft = {
  diet: DietType | null;
  allergies: AllergyKey[];
  customAllergies: string[];
  dislikes: string[];
  meals: number;
  foodSource: FoodSource | null;
  nutritionFocus: NutritionFocus | null;
  water: string;
  foodRules: FoodRule[];
  cuisines: Cuisine[];
  budgetLevel: BudgetLevel | null;
  monthlyBudget: string;
  /** Typed into a tag field but not added yet; saved with the section. */
  allergyDraft: string;
  dislikeDraft: string;
};

export function FoodSection({ data, editing, notice, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const v3 = data.schema.onboardingV3;
  const allergies = splitAllergies(prefs.allergies);
  const original: FoodDraft = {
    diet: prefs.diet_type,
    allergies: allergies.keys,
    customAllergies: allergies.custom,
    dislikes: prefs.food_dislikes,
    meals: prefs.meals_per_day,
    foodSource: prefs.food_source,
    nutritionFocus: prefs.nutrition_focus,
    water: String(prefs.daily_water_goal_ml),
    foodRules: prefs.food_rules,
    cuisines: prefs.cuisines,
    budgetLevel: prefs.food_budget_level,
    monthlyBudget: prefs.monthly_food_budget_inr == null ? "" : String(prefs.monthly_food_budget_inr),
    allergyDraft: "",
    dislikeDraft: "",
  };
  const [draft, setDraft] = useState(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => withoutKey(current, key));
    setError("");
  };
  // The four setup diets, plus "Both" for an account that has it.
  const dietOptions = DIET_OPTIONS.filter((option) => ONBOARDING_DIETS.includes(option.value) || option.value === prefs.diet_type);
  // 2, 3, 4 or 5+; an older answer outside those (1, 6 or more) stays offered so it is never changed silently.
  const mealOptions = choicesKeeping(ONBOARDING_MEAL_OPTIONS, prefs.meals_per_day);
  const mealsLabel = (meals: number) => (meals === 5 ? "5+" : String(meals));

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
      // The fields with errors may sit in the folded "More" part.
      formRef.current?.querySelectorAll("details").forEach((details) => { details.open = true; });
      focusFirstInvalid(formRef.current);
      return setError("Check the highlighted answers.");
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);

    const before = {
      diet_type: prefs.diet_type, allergies: prefs.allergies, meals_per_day: prefs.meals_per_day, daily_water_goal_ml: prefs.daily_water_goal_ml,
      food_source: prefs.food_source, nutrition_focus: prefs.nutrition_focus,
      food_rules: prefs.food_rules, cuisines: prefs.cuisines, food_dislikes: prefs.food_dislikes, food_budget_level: prefs.food_budget_level, monthly_food_budget_inr: prefs.monthly_food_budget_inr,
    };
    // Text still in a tag field counts as an entry.
    const customAllergies = commitDraft(draft.customAllergies, draft.allergyDraft);
    const dislikes = commitDraft(draft.dislikes, draft.dislikeDraft, { max: MAX_FOOD_DISLIKES });
    const after = {
      diet_type: draft.diet, allergies: joinKnown(draft.allergies, customAllergies), meals_per_day: draft.meals, daily_water_goal_ml: Math.round(water),
      food_source: draft.foodSource, nutrition_focus: draft.nutritionFocus,
      food_rules: draft.foodRules, cuisines: draft.cuisines, food_dislikes: dislikes, food_budget_level: draft.budgetLevel, monthly_food_budget_inr: budget,
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
    const focusChanged = "nutrition_focus" in patch && !pending.includes("nutrition_focus");
    await onSaved(pending.length
      ? { tone: "note", text: "Saved. Some answers save after the next FITX update." }
      : focusChanged && data.targets ? { tone: "saved", text: "Saved · protein target updated" } : SAVED);
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="food" title="Food" icon={<Salad size={18} />} editing={editing} onEdit={start} canEdit notice={notice}>
      {!editing ? (
        <DetailList>
          <Detail label="Diet">{optionLabel(DIET_OPTIONS, prefs.diet_type) ?? <NotSet />}</Detail>
          <Detail label="Meals a day">{mealsLabel(prefs.meals_per_day)}</Detail>
          {v3 && <Detail label="Food preference">{optionLabel(FOOD_SOURCE_OPTIONS, prefs.food_source) ?? <NotSet />}</Detail>}
          {v3 && <Detail label="Nutrition goal">{optionLabel(NUTRITION_FOCUS_OPTIONS, prefs.nutrition_focus) ?? <NotSet />}</Detail>}
          <Detail label="Allergies" wide><ChipList items={labelsFor(ALLERGY_OPTIONS, prefs.allergies)} /></Detail>
          {v2 && <Detail label="Foods avoided" wide><ChipList items={prefs.food_dislikes} /></Detail>}
          <Detail label="Water">{(prefs.daily_water_goal_ml / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} litres a day</Detail>
          {v2 && (prefs.food_rules.length > 0 || prefs.cuisines.length > 0) && (
            <Detail label="Rules and cuisines" wide><ChipList items={[...labelsFor(FOOD_RULE_OPTIONS, prefs.food_rules), ...labelsFor(CUISINE_OPTIONS, prefs.cuisines)]} /></Detail>
          )}
          {v2 && (prefs.food_budget_level || prefs.monthly_food_budget_inr != null) && (
            <Detail label="Food budget">
              {[optionLabel(BUDGET_LEVEL_OPTIONS, prefs.food_budget_level), prefs.monthly_food_budget_inr != null ? `${formatRupees(prefs.monthly_food_budget_inr)} a month` : null].filter(Boolean).join(" · ")}
            </Detail>
          )}
        </DetailList>
      ) : (
        <form ref={formRef} noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChoiceGroup legend="Diet" options={dietOptions} value={draft.diet} onChange={(value) => set("diet", value)} onClear={() => set("diet", null)} clearLabel="Clear your diet" />
            <ChipGroup legend="Food allergies or intolerances" options={ALLERGY_OPTIONS} values={draft.allergies} onChange={(values) => set("allergies", values)} />
            <TagInput legend="Other allergies" values={draft.customAllergies} onChange={(values) => set("customAllergies", values)} draft={draft.allergyDraft} onDraftChange={(value) => set("allergyDraft", value)} addLabel="Add allergy" placeholder="For example kiwi" />
            {v2 && <TagInput legend="Foods avoided" values={draft.dislikes} onChange={(values) => set("dislikes", values)} draft={draft.dislikeDraft} onDraftChange={(value) => set("dislikeDraft", value)} addLabel="Add food" placeholder="For example bitter gourd" max={MAX_FOOD_DISLIKES} />}
            <ChoiceGroup legend="Meals a day" options={mealOptions} value={draft.meals} onChange={(value) => set("meals", value)} columns="grid-cols-4 sm:grid-cols-5" showHints={false} compact />
            {v3 && <ChoiceGroup legend="Food preference" options={FOOD_SOURCE_OPTIONS} value={draft.foodSource} onChange={(value) => set("foodSource", value)} columns="grid-cols-3" showHints={false} compact onClear={() => set("foodSource", null)} clearLabel="Clear food preference" />}
            {v3 && <ChoiceGroup legend="Nutrition goal" hint="High protein raises your daily protein target." options={NUTRITION_FOCUS_OPTIONS} value={draft.nutritionFocus} onChange={(value) => set("nutritionFocus", value)} columns="grid-cols-1 sm:grid-cols-3" showHints={false} onClear={() => set("nutritionFocus", null)} clearLabel="Clear nutrition goal" />}
            <details className="group rounded-xl border border-fitx-border">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-fitx-text [&::-webkit-details-marker]:hidden">
                More
                <span aria-hidden="true" className="text-fitx-text-secondary transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <div className="space-y-7 border-t border-fitx-divider px-4 py-5">
                <div className="max-w-xs">
                  <TextField label="Daily water" value={draft.water} onChange={(value) => set("water", value.replace(/[^\d]/g, ""))} error={errors.water} inputMode="numeric" suffix="ml" maxLength={5} required />
                </div>
                {v2 ? <>
                  <ChipGroup legend="Food rules you follow" options={FOOD_RULE_OPTIONS} values={draft.foodRules} onChange={(values) => set("foodRules", values)} />
                  <ChipGroup legend="Cuisines you enjoy" options={CUISINE_OPTIONS} values={draft.cuisines} onChange={(values) => set("cuisines", values)} />
                  <ChoiceGroup legend="Food budget" options={BUDGET_LEVEL_OPTIONS} value={draft.budgetLevel} onChange={(value) => set("budgetLevel", value)} columns="grid-cols-1 sm:grid-cols-3" onClear={() => set("budgetLevel", null)} clearLabel="Clear your budget level" />
                  <div className="max-w-xs">
                    <TextField label="Monthly food budget" value={draft.monthlyBudget} onChange={(value) => set("monthlyBudget", value)} error={errors.monthlyBudget} inputMode="numeric" placeholder="For example 6,000" suffix="₹" />
                  </div>
                </> : <p className="text-xs leading-5 text-fitx-text-secondary">Food rules, cuisines and budget arrive with the next FITX update.</p>}
              </div>
            </details>
          </div>
          <EditActions saving={saving} onCancel={onClose} error={error} />
        </form>
      )}
    </SectionCard>
  );
}

// ─── Injuries and limitations ────────────────────────────────────────────────────────────────────

export function LimitsSection({ data, editing, notice, onEdit, onClose, onSaved }: SectionProps) {
  const prefs = data.preferences;
  const v2 = data.schema.preferencesV2;
  const v3 = data.schema.onboardingV3;
  const stored = splitLimitations(prefs.limitations);
  const original: { limitations: LimitationKey[]; customLimitations: string[]; limitationDraft: string } = { limitations: stored.keys, customLimitations: stored.custom, limitationDraft: "" };
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof original>(key: K, value: (typeof original)[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const start = () => {
    setDraft(original);
    setError("");
    onEdit();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = joinLimitations(draft.limitations, commitDraft(draft.customLimitations, draft.limitationDraft, { max: MAX_CUSTOM_LIMITATIONS, maxLength: MAX_LIMITATION_LENGTH }));
    const patch = changedFields({ limitations: prefs.limitations }, { limitations: next });
    if (!Object.keys(patch).length) {
      onClose();
      return void onSaved(NO_CHANGES);
    }
    const supabase = createClient();
    if (!supabase) return setError(WRITE_FAILED);
    setSaving(true);
    setError("");
    const saved = await savePreferences(supabase, data.userId, patch, { v2, v3 });
    if (saved.error) return failed(setSaving, setError);
    await onSaved(saved.skipped.includes("limitations") ? { tone: "note", text: "These save after the next FITX update." } : SAVED);
    setSaving(false);
    onClose();
  }

  return (
    <SectionCard id="limits" title="Injuries and limitations" icon={<HeartPulse size={18} />} editing={editing} onEdit={start} canEdit={v2} notice={notice}>
      {!editing ? (
        v2 ? (
          <div className="space-y-2">
            <ChipList items={labelsFor(LIMITATION_OPTIONS, prefs.limitations)} />
            {prefs.limitations.length > 0 && <p className="text-xs leading-5 text-fitx-text-secondary">Auto workouts don’t avoid these yet. Swap any exercise that hurts.</p>}
          </div>
        ) : <p className="text-sm text-fitx-text-secondary">Arrives with the next FITX update.</p>
      ) : (
        <form noValidate onSubmit={(event) => void save(event)}>
          <div className="space-y-7">
            <ChipGroup legend="Injuries or areas to go easy on" options={LIMITATION_OPTIONS} values={draft.limitations} onChange={(values) => set("limitations", values)} />
            <TagInput legend="Anything else" values={draft.customLimitations} onChange={(values) => set("customLimitations", values)} draft={draft.limitationDraft} onDraftChange={(value) => set("limitationDraft", value)} addLabel="Add limitation" placeholder="Describe it briefly" maxLength={MAX_LIMITATION_LENGTH} max={MAX_CUSTOM_LIMITATIONS} />
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
