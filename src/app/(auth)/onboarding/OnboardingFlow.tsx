"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleHelp, RotateCcw } from "lucide-react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { LogoutButton } from "@/components/app/LogoutButton";
import { ChipGroup, ChoiceGroup, HeightField, TagInput, TextField, WeightField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import { Logo } from "@/components/ui/Logo";
import { EquipmentPicker } from "@/components/workouts/EquipmentPicker";
import { calculateNutritionTargets } from "@/lib/domain/nutrition";
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
  GOAL_OPTIONS,
  GOALS_BEFORE_PROFILE_V2,
  HEIGHT_RANGE_CM,
  LIMITATION_OPTIONS,
  LOCATION_OPTIONS,
  MAX_CUSTOM_LIMITATIONS,
  MAX_FOOD_DISLIKES,
  MAX_LIMITATION_LENGTH,
  MEALS_PER_DAY,
  MONTHLY_BUDGET_RANGE,
  NAME_MAX_LENGTH,
  SESSION_LENGTHS,
  SEX_OPTIONS,
  SPLIT_OPTIONS,
  WEIGHT_RANGE_KG,
  commitDraft,
  formatRupees,
  inRange,
  joinKnown,
  joinLimitations,
  legacyDietaryPreferences,
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
  type Goal,
  type HeightUnit,
  type LimitationKey,
  type Sex,
  type TrainingLocation,
  type WeightUnit,
  type WorkoutSplit,
} from "@/lib/domain/profile-options";
import { targetReason } from "@/lib/domain/target-reason";
import { ensureProfileRow, loadUserContext, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import { saveEquipmentProfile } from "@/lib/training/data";

type Form = {
  name: string;
  age: string;
  gender: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  goal: Goal;
  activity: ActivityLevel;
  location: TrainingLocation;
  experience: Experience;
  /** Home equipment, as training-taxonomy keys (the list Workouts uses at home). */
  equipment: string[];
  limitations: LimitationKey[];
  customLimitations: string[];
  days: number;
  minutes: number;
  split: WorkoutSplit;
  diet: DietType | null;
  allergies: AllergyKey[];
  customAllergies: string[];
  meals: number;
  budgetLevel: BudgetLevel | null;
  monthlyBudget: string;
  cuisines: Cuisine[];
  foodRules: FoodRule[];
  dislikes: string[];
  /** Typed into a tag field but not added yet; saved with the step. */
  allergyDraft: string;
  limitationDraft: string;
  dislikeDraft: string;
};

type StepId = "body" | "goal" | "training" | "schedule" | "food" | "budget";
type Errors = Partial<Record<string, string>>;

const STEP_COPY: Record<StepId, { label: string; title: string; description: string }> = {
  body: { label: "About you", title: "Tell us about you", description: "FITX uses these to estimate your daily calories and protein. Only you can see them, except what the AI coach sends to outside AI services if you use it." },
  goal: { label: "Your goal", title: "What are you working toward?", description: "Your goal and activity set your daily calorie and protein targets. You can change them any time in Profile." },
  training: { label: "Training", title: "Where and how do you train?", description: "Auto workouts pick exercises that fit where you train, your equipment and your experience." },
  schedule: { label: "Schedule", title: "How much time do you have?", description: "Session length sets how long auto workouts are and your split shapes them. Training days set your weekly goal on Home." },
  food: { label: "Food", title: "How do you eat?", description: "Saved with your profile. If you’re 18 or over and turn on “Use my FITX data” in the AI coach, its meal plans follow your diet and leave out your allergies." },
  budget: { label: "Food and budget", title: "Food and budget", description: "Optional. If you’re 18 or over and turn on “Use my FITX data” in the AI coach, its meal plans take these into account. Skip it if you like; you can add it later in Profile." },
};

const SESSION_OPTIONS = SESSION_LENGTHS.map((minutes) => ({ value: minutes, label: `${minutes} min` }));
const DAY_OPTIONS = DAYS_PER_WEEK.map((days) => ({ value: days, label: String(days) }));
const MEAL_OPTIONS = MEALS_PER_DAY.map((meals) => ({ value: meals, label: String(meals) }));

function initialForm(context: UserContextData, metadataName: string): Form {
  const profile = context.profile;
  const prefs = context.preferences;
  const allergies = splitAllergies(prefs.allergies);
  const limitations = splitLimitations(prefs.limitations);
  return {
    name: (profile?.name || metadataName).slice(0, NAME_MAX_LENGTH),
    age: profile?.age == null ? "" : String(profile.age),
    gender: profile?.gender ?? null,
    heightCm: profile?.height ?? null,
    weightKg: context.currentWeightKg,
    targetWeightKg: profile?.target_weight ?? null,
    heightUnit: prefs.height_unit,
    weightUnit: prefs.weight_unit,
    goal: prefs.primary_goal,
    activity: prefs.activity_level,
    location: prefs.workout_location,
    experience: prefs.fitness_level,
    equipment: context.equipmentLists.home.keys,
    limitations: limitations.keys,
    customLimitations: limitations.custom,
    days: prefs.workouts_per_week,
    minutes: (SESSION_LENGTHS as readonly number[]).includes(prefs.session_duration_minutes) ? prefs.session_duration_minutes : 45,
    split: prefs.workout_split,
    diet: prefs.diet_type,
    allergies: allergies.keys,
    customAllergies: allergies.custom,
    meals: (MEALS_PER_DAY as readonly number[]).includes(prefs.meals_per_day) ? prefs.meals_per_day : 3,
    budgetLevel: prefs.food_budget_level,
    monthlyBudget: prefs.monthly_food_budget_inr == null ? "" : String(prefs.monthly_food_budget_inr),
    cuisines: prefs.cuisines,
    foodRules: prefs.food_rules,
    dislikes: prefs.food_dislikes,
    allergyDraft: "",
    limitationDraft: "",
    dislikeDraft: "",
  };
}

/** The form with any text still in a tag field added as an entry, as it is saved. */
function withDraftsAdded(form: Form): Form {
  return {
    ...form,
    customAllergies: commitDraft(form.customAllergies, form.allergyDraft),
    customLimitations: commitDraft(form.customLimitations, form.limitationDraft, { max: MAX_CUSTOM_LIMITATIONS, maxLength: MAX_LIMITATION_LENGTH }),
    dislikes: commitDraft(form.dislikes, form.dislikeDraft, { max: MAX_FOOD_DISLIKES }),
    allergyDraft: "",
    limitationDraft: "",
    dislikeDraft: "",
  };
}

function validate(step: StepId, form: Form): Errors {
  const errors: Errors = {};
  if (step === "body") {
    if (!form.name.trim()) errors.name = "Add your name.";
    const age = Number(form.age);
    if (!form.age.trim()) errors.age = "Add your age.";
    else if (!Number.isInteger(age) || !inRange(age, AGE_RANGE)) errors.age = `Enter a whole number from ${AGE_RANGE.min} to ${AGE_RANGE.max}.`;
    if (!form.gender) errors.gender = "Choose one. FITX uses it in the calorie formula and, if you use the AI coach, in the coach’s advice.";
    if (form.heightCm === null) errors.heightCm = "Add your height.";
    else if (!inRange(form.heightCm, HEIGHT_RANGE_CM)) errors.heightCm = "Enter a height between 90 and 250 cm (2 ft 11 in to 8 ft 2 in).";
    if (form.weightKg === null) errors.weightKg = "Add your current weight.";
    else if (!inRange(form.weightKg, WEIGHT_RANGE_KG)) errors.weightKg = "Enter a weight between 30 and 500 kg (66 to 1,102 lb).";
    if (form.targetWeightKg !== null && !inRange(form.targetWeightKg, WEIGHT_RANGE_KG)) errors.targetWeightKg = "Enter a target between 30 and 500 kg, or leave it empty.";
  }
  if (step === "food" && !form.diet) errors.diet = "Choose the option closest to how you eat.";
  if (step === "budget" && form.monthlyBudget.trim()) {
    const amount = parseRupees(form.monthlyBudget);
    if (amount === null || Number.isNaN(amount) || !inRange(amount, MONTHLY_BUDGET_RANGE)) {
      errors.monthlyBudget = `Enter an amount from ${formatRupees(MONTHLY_BUDGET_RANGE.min)} to ${formatRupees(MONTHLY_BUDGET_RANGE.max)}, or leave it empty.`;
    }
  }
  return errors;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready" | "load_failed" | "unavailable">("loading");
  const [context, setContext] = useState<UserContextData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const movedStep = useRef(false);

  const v2 = context?.schema.preferencesV2 ?? false;
  const steps: StepId[] = useMemo(() => (v2 ? ["body", "goal", "training", "schedule", "food", "budget"] : ["body", "goal", "training", "schedule", "food"]), [v2]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  useEffect(() => {
    let live = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) {
        if (live) setPhase("unavailable");
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      if (!live) return;
      if (!auth.user) {
        router.replace("/signin?next=/onboarding");
        return;
      }
      const result = await loadUserContext(supabase, { id: auth.user.id, email: auth.user.email ?? null });
      if (!live) return;
      if (result.error) {
        setPhase("load_failed");
        return;
      }
      if (result.data.profile?.onboarded) {
        router.replace("/dashboard");
        return;
      }
      // A missing profile row would otherwise keep this account in onboarding for good.
      if (!result.data.profile) await ensureProfileRow(supabase, auth.user.id);
      if (!live) return;
      const metadata = auth.user.user_metadata as { name?: unknown; full_name?: unknown } | undefined;
      const metadataName = typeof metadata?.name === "string" ? metadata.name : typeof metadata?.full_name === "string" ? metadata.full_name : "";
      setContext(result.data);
      setForm(initialForm(result.data, metadataName));
      setPhase("ready");
    })();
    return () => {
      live = false;
    };
  }, [router, reload]);

  useEffect(() => {
    if (!movedStep.current) return;
    heading.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepIndex]);

  const update = useCallback(<K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSaveError("");
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }, []);

  const preview = useMemo(() => {
    if (!form) return null;
    return calculateNutritionTargets({ age: Number(form.age), gender: form.gender, height: form.heightCm, weight: form.weightKg }, form.activity, form.goal);
  }, [form]);

  async function saveStep(current: StepId, values: Form, { skipBudget = false } = {}) {
    const supabase = createClient();
    if (!supabase || !context) return "Your session has ended. Sign in again to continue.";
    const userId = context.userId;
    const fail = (error: { code?: string } | null) =>
      error?.code === "23514" ? "One of these answers isn't accepted yet. Choose another for now." : "We couldn't save this step. Check your connection and try again.";

    if (current === "body") {
      const saved = await updateProfileRow(supabase, userId, {
        name: values.name.trim().slice(0, NAME_MAX_LENGTH),
        age: Number(values.age),
        gender: values.gender,
        height: values.heightCm,
        weight: values.weightKg,
        target_weight: values.targetWeightKg,
      });
      if (saved.error) return saved.error.code === "profile_missing" || saved.error.code === "42501"
        ? "We couldn't set up your profile. Please try again, or contact FITX support if this keeps happening."
        : fail(saved.error);
      const units = await savePreferences(supabase, userId, { height_unit: values.heightUnit, weight_unit: values.weightUnit }, { v2 });
      return units.error ? fail(units.error) : null;
    }
    const patch: Record<string, unknown> =
      current === "goal" ? { primary_goal: values.goal, activity_level: values.activity, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }
      : current === "training" ? { workout_location: values.location, fitness_level: values.experience, equipment: [...values.equipment, ...context.legacy.unknownEquipment], limitations: joinLimitations(values.limitations, values.customLimitations) }
      : current === "schedule" ? { workouts_per_week: values.days, session_duration_minutes: values.minutes, workout_split: values.split }
      : current === "food" ? { diet_type: values.diet, dietary_preferences: legacyDietaryPreferences(values.diet, context.legacy.dietaryPreferences), allergies: joinKnown(values.allergies, values.customAllergies), meals_per_day: values.meals }
      : skipBudget ? {}
      : { food_budget_level: values.budgetLevel, monthly_food_budget_inr: parseRupees(values.monthlyBudget), cuisines: values.cuisines, food_rules: values.foodRules, food_dislikes: values.dislikes };
    if (!Object.keys(patch).length) return null;
    const saved = await savePreferences(supabase, userId, patch, { v2 });
    if (saved.error) return fail(saved.error);
    // Home kit also becomes the Home list Workouts uses (once that list can be saved).
    if (current === "training" && values.location !== "gym" && context.equipmentLists.available) {
      const listed = await saveEquipmentProfile(supabase, userId, "home", values.equipment);
      if (listed.error) return fail(listed.error);
    }
    return null;
  }

  async function finish(values: Form) {
    const supabase = createClient();
    if (!supabase || !context) return "Your session has ended. Sign in again to continue.";
    const done = await updateProfileRow(supabase, context.userId, { onboarded: true });
    if (done.error) return "We couldn't finish setting up your account. Please try again.";
    // The weight typed here becomes the current weight: logged when there is no weigh-in yet, or when it
    // differs from the newest one (an older account's history), never twice for the same value.
    const prior = await supabase.from("body_metrics").select("weight").eq("user_id", context.userId).not("weight", "is", null)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const latest = prior.data ? Number((prior.data as { weight: unknown }).weight) : null;
    if (!prior.error && values.weightKg !== null && (latest === null || Math.abs(latest - values.weightKg) >= 0.05)) {
      await logWeighIn(supabase, context.userId, values.weightKg, latest === null ? "Starting weight" : "Onboarding update");
    }
    return null;
  }

  async function advance({ skipBudget = false } = {}) {
    if (!form || saving) return;
    // Text typed into a tag field but not added still counts.
    const values = withDraftsAdded(form);
    const found = skipBudget ? {} : validate(step, values);
    setErrors(found);
    setSaveError("");
    if (Object.keys(found).length) {
      setSaveError("Check the highlighted answers.");
      focusFirstInvalid(formRef.current);
      return;
    }
    setSaving(true);
    const problem = (await saveStep(step, values, { skipBudget })) ?? (isLast ? await finish(values) : null);
    if (problem) {
      setSaving(false);
      setSaveError(problem);
      return;
    }
    if (isLast) {
      // A full page load, so the head script can play the account's one-time intro on the first dashboard visit.
      window.location.assign("/dashboard");
      return;
    }
    setForm(values);
    setSaving(false);
    movedStep.current = true;
    setStepIndex((index) => index + 1);
  }

  function back() {
    setErrors({});
    setSaveError("");
    movedStep.current = true;
    setStepIndex((index) => Math.max(0, index - 1));
  }

  if (phase === "loading") return <p className="py-14 text-center text-sm text-fitx-text-secondary" role="status">Loading your profile…</p>;
  if (phase === "unavailable") {
    return <Shell><p role="alert" className="fitx-alert fitx-alert-danger">Setup isn’t available right now because FITX can’t reach its database. Please try again later.</p></Shell>;
  }
  if (phase === "load_failed" || !form || !context) {
    return (
      <Shell reachable>
        <div role="alert" className="fitx-alert fitx-alert-danger">
          We couldn’t load your details, so setup is paused to keep them safe.
          <button type="button" className="fitx-alert-action inline-flex min-h-11 items-center gap-1" onClick={() => { setPhase("loading"); setReload((count) => count + 1); }}>
            <RotateCcw size={14} aria-hidden="true" />Try again
          </button>
        </div>
      </Shell>
    );
  }

  const copy = STEP_COPY[step];
  const total = steps.length;
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-6">
        <Logo size={40} className="mb-5" />
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-fitx-primary-text">Step {stepIndex + 1} of {total} · {copy.label}</p>
        <h1 ref={heading} tabIndex={-1} className="mt-2 text-[1.65rem] font-semibold leading-tight tracking-[-.03em] text-fitx-text outline-none">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">{copy.description}</p>
        <div className="mt-5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={stepIndex + 1} aria-valuetext={`Step ${stepIndex + 1} of ${total}: ${copy.label}`}>
          {steps.map((id, index) => <span key={id} className={`h-1.5 rounded-full transition-colors ${index <= stepIndex ? "bg-fitx-primary" : "bg-fitx-track"}`} />)}
        </div>
      </div>

      <form ref={formRef} noValidate onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void advance(); }} className="rounded-2xl border border-fitx-border bg-fitx-card p-4 shadow-sm sm:p-6">
        <div className="space-y-7">
          {step === "body" && <>
            <TextField label="Name" value={form.name} onChange={(value) => update("name", value)} error={errors.name} autoComplete="name" maxLength={NAME_MAX_LENGTH} required />
            <div className="max-w-[13rem]">
              <TextField label="Age" value={form.age} onChange={(value) => update("age", value.replace(/[^\d]/g, ""))} error={errors.age} inputMode="numeric" suffix="years" maxLength={3} required />
            </div>
            <ChoiceGroup legend="Sex for the calorie formula" options={SEX_OPTIONS} value={form.gender} onChange={(value) => update("gender", value)} columns="grid-cols-1 sm:grid-cols-3" showHints={false} error={errors.gender} />
            <HeightField cm={form.heightCm} unit={form.heightUnit} onChange={(cm) => update("heightCm", cm)} onUnitChange={(unit) => update("heightUnit", unit)} error={errors.heightCm} required showUnits={v2} />
            <WeightField label="Current weight" kg={form.weightKg} unit={form.weightUnit} onChange={(kg) => update("weightKg", kg)} onUnitChange={(unit) => update("weightUnit", unit)} error={errors.weightKg} required showUnits={v2} />
            <WeightField label="Target weight" hint="If you have one in mind." kg={form.targetWeightKg} unit={form.weightUnit} onChange={(kg) => update("targetWeightKg", kg)} onUnitChange={(unit) => update("weightUnit", unit)} error={errors.targetWeightKg} showUnits={v2} />
          </>}

          {step === "goal" && <>
            <ChoiceGroup
              legend="Main goal"
              options={GOAL_OPTIONS}
              value={form.goal}
              onChange={(value) => update("goal", value)}
              disabledValues={v2 ? [] : GOAL_OPTIONS.map((option) => option.value).filter((goal) => !GOALS_BEFORE_PROFILE_V2.includes(goal))}
              hint={v2 ? undefined : "Weight gain and weight loss arrive with the next FITX update."}
            />
            <ChoiceGroup legend="Daily activity, outside workouts too" options={ACTIVITY_OPTIONS} value={form.activity} onChange={(value) => update("activity", value)} columns="grid-cols-1" />
            {preview && <TargetPreview targets={preview} />}
          </>}

          {step === "training" && <>
            <ChoiceGroup legend="Where do you usually train?" options={LOCATION_OPTIONS} value={form.location} onChange={(value) => update("location", value)} columns="grid-cols-2" showHints={false} compact />
            <ChoiceGroup legend="Training experience" options={EXPERIENCE_OPTIONS} value={form.experience} onChange={(value) => update("experience", value)} columns="grid-cols-1" />
            {form.location !== "gym" && (
              <fieldset>
                <legend className="text-sm font-semibold text-fitx-text">Equipment you have at home</legend>
                <p className="mb-3 mt-1 text-xs leading-5 text-fitx-text-secondary">Choose “No equipment” if you train with your body weight only.</p>
                <EquipmentPicker context="home" value={form.equipment} onChange={(keys) => update("equipment", keys)} />
              </fieldset>
            )}
            {(form.location === "gym" || form.location === "both") && (
              <p className="text-xs leading-5 text-fitx-text-secondary">At the gym, auto workouts assume a fully equipped gym. You can change your gym’s equipment later in Profile or on the Workouts page.</p>
            )}
            {v2 && <>
              <ChipGroup legend="Injuries or areas to go easy on" hint="Optional. Auto workouts don’t avoid these yet, so skip or swap any exercise that hurts. The AI coach takes them into account if you turn on “Use my FITX data”." options={LIMITATION_OPTIONS} values={form.limitations} onChange={(values) => update("limitations", values)} />
              <TagInput legend="Anything else to work around?" hint="For example a recent surgery or an old injury." values={form.customLimitations} onChange={(values) => update("customLimitations", values)} draft={form.limitationDraft} onDraftChange={(value) => update("limitationDraft", value)} addLabel="Add limitation" placeholder="Describe it briefly" maxLength={MAX_LIMITATION_LENGTH} max={MAX_CUSTOM_LIMITATIONS} />
            </>}
          </>}

          {step === "schedule" && <>
            <ChoiceGroup legend="Training days a week" options={DAY_OPTIONS} value={form.days} onChange={(value) => update("days", value)} columns="grid-cols-4 sm:grid-cols-7" showHints={false} compact />
            <ChoiceGroup legend="Typical session length" options={SESSION_OPTIONS} value={form.minutes} onChange={(value) => update("minutes", value)} columns="grid-cols-3" showHints={false} compact />
            <ChoiceGroup legend="Preferred training split" options={SPLIT_OPTIONS} value={form.split} onChange={(value) => update("split", value)} />
          </>}

          {step === "food" && <>
            <ChoiceGroup legend="Which describes you best?" options={DIET_OPTIONS} value={form.diet} onChange={(value) => update("diet", value)} error={errors.diet} />
            <ChipGroup legend="Food allergies or intolerances" hint="Leave these empty if you have none." options={ALLERGY_OPTIONS} values={form.allergies} onChange={(values) => update("allergies", values)} />
            <TagInput legend="Other allergies" hint="Anything not listed above." values={form.customAllergies} onChange={(values) => update("customAllergies", values)} draft={form.allergyDraft} onDraftChange={(value) => update("allergyDraft", value)} addLabel="Add allergy" placeholder="For example kiwi" />
            <ChoiceGroup legend="Meals a day" hint="Snacks count as meals." options={MEAL_OPTIONS} value={form.meals} onChange={(value) => update("meals", value)} columns="grid-cols-6" showHints={false} compact />
            {!v2 && <p className="text-xs leading-5 text-fitx-text-secondary">Food budget, cuisines and injury details arrive with the next FITX update. You can add them in Profile then.</p>}
          </>}

          {step === "budget" && <>
            <ChoiceGroup legend="How tight is your food budget?" options={BUDGET_LEVEL_OPTIONS} value={form.budgetLevel} onChange={(value) => update("budgetLevel", value)} columns="grid-cols-1 sm:grid-cols-3" />
            <TextField label="Monthly food budget" hint="Roughly what you spend on food a month, in rupees." value={form.monthlyBudget} onChange={(value) => update("monthlyBudget", value)} error={errors.monthlyBudget} inputMode="numeric" placeholder="For example 6,000" suffix="₹ / month" />
            <ChipGroup legend="Cuisines you enjoy" options={CUISINE_OPTIONS} values={form.cuisines} onChange={(values) => update("cuisines", values)} />
            <ChipGroup legend="Food rules you follow" options={FOOD_RULE_OPTIONS} values={form.foodRules} onChange={(values) => update("foodRules", values)} />
            <TagInput legend="Foods you don't eat" hint="Dislikes count too." values={form.dislikes} onChange={(values) => update("dislikes", values)} draft={form.dislikeDraft} onDraftChange={(value) => update("dislikeDraft", value)} addLabel="Add food" placeholder="For example bitter gourd" max={MAX_FOOD_DISLIKES} />
          </>}
        </div>

        {saveError && <p role="alert" className="fitx-alert fitx-alert-danger mt-6">{saveError}</p>}

        {/* Phones: the forward actions sit on top at full width, Back below; wider screens: one row. */}
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-fitx-divider pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {stepIndex > 0 && <button type="button" onClick={back} disabled={saving} className="fitx-button fitx-button-secondary w-full sm:w-auto"><ArrowLeft size={16} aria-hidden="true" />Back</button>}
          <div className="flex items-center gap-2 sm:ml-auto">
            {step === "budget" && <button type="button" disabled={saving} onClick={() => void advance({ skipBudget: true })} className="fitx-button fitx-button-quiet whitespace-nowrap px-4">Skip for now</button>}
            <button type="submit" disabled={saving} className="fitx-button flex-1 whitespace-nowrap sm:flex-none">
              {saving ? "Saving…" : isLast ? "Finish setup" : "Continue"}
              {isLast ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </form>
      {/* Signed in with the wrong Google account? Besides Help, onboarding is the only page such an account can
          reach, so it can sign out or delete the account from here. */}
      <div className="mt-4 flex flex-wrap justify-center gap-x-6">
        <LogoutButton label="Use a different account" />
        <HelpLink />
        <DeleteAccount variant="link" returnTo="/onboarding" />
      </div>
    </div>
  );
}

/** `reachable`: FITX's services answer, so Help and deleting the account can work from here. */
function Shell({ children, reachable = false }: { children: React.ReactNode; reachable?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4">
      <Logo size={40} />
      {children}
      <div className="flex flex-wrap justify-center gap-x-6">
        <LogoutButton label="Use a different account" />
        {reachable && <HelpLink />}
        {reachable && <DeleteAccount variant="link" returnTo="/onboarding" />}
      </div>
    </div>
  );
}

/** Help is open to an account still in setup (src/lib/auth/before-onboarding.ts); a request sent from there notes it came from setup. */
function HelpLink() {
  return (
    <Link href="/help?from=%2Fonboarding" className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text">
      <CircleHelp size={16} aria-hidden="true" />Get help
    </Link>
  );
}

function TargetPreview({ targets }: { targets: NonNullable<ReturnType<typeof calculateNutritionTargets>> }) {
  const reason = targetReason(targets);
  return (
    <div className="rounded-xl border border-fitx-border bg-fitx-surface-variant p-4" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-fitx-text-secondary">Your starting targets</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-.02em] text-fitx-text">{targets.calories.toLocaleString("en-IN")} <span className="text-sm font-medium text-fitx-text-secondary">kcal a day</span></p>
      <p className="mt-1 text-sm text-fitx-text-secondary">{targets.protein} g protein · {targets.carbs} g carbs · {targets.fat} g fat</p>
      <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">{reason} An estimate from the Mifflin-St Jeor formula; FITX updates it as you log your weight.</p>
    </div>
  );
}
