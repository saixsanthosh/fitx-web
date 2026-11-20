"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import {
  ArrowLeft, ArrowRight, BicepsFlexed, Building2, Check, CircleHelp, CookingPot, Drumstick, Dumbbell, Egg, Flame, Footprints,
  HeartPulse, House, Leaf, RotateCcw, Salad, Scale, Shuffle, Sofa, Sprout, Store, Target, TrendingDown, Wheat,
} from "lucide-react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { LogoutButton } from "@/components/app/LogoutButton";
import { EquipmentGrid } from "@/components/equipment/EquipmentGrid";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { ChoiceTiles, type TileOption } from "@/components/onboarding/ChoiceTiles";
import styles from "@/components/onboarding/Onboarding.module.css";
import { FoodArt, NotGiven, PersonalArt, PersonalReadouts, Readout, TrainingArt } from "@/components/onboarding/StageArt";
import { BirthDateField, ChipGroup, HeightField, TagInput, TextField, WeightField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import { Logo } from "@/components/ui/Logo";
import { Segmented } from "@/components/ui/Segmented";
import { calculateNutritionTargets } from "@/lib/domain/nutrition";
import {
  ACTIVITY_BAND_OPTIONS,
  ALLERGY_OPTIONS,
  DIET_OPTIONS,
  FOOD_RULE_OPTIONS,
  FOOD_SOURCE_OPTIONS,
  GOAL_OPTIONS,
  LIMITATION_OPTIONS,
  MAX_CUSTOM_LIMITATIONS,
  MAX_FOOD_DISLIKES,
  MAX_LIMITATION_LENGTH,
  NAME_MAX_LENGTH,
  NUTRITION_FOCUS_OPTIONS,
  ONBOARDING_DAYS_PER_WEEK,
  ONBOARDING_DIETS,
  ONBOARDING_GOALS,
  ONBOARDING_LOCATION_OPTIONS,
  ONBOARDING_MEAL_OPTIONS,
  SEX_OPTIONS,
  activityBand,
  activityForBand,
  ageFromBirthDate,
  formatHeight,
  formatWeight,
  optionLabel,
  type ActivityBand,
  type DietType,
  type Experience,
  type FoodSource,
  type Goal,
  type NutritionFocus,
  type TrainingLocation,
} from "@/lib/domain/profile-options";
import { ensureProfileRow, loadUserContext, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import {
  ONBOARDING_PAGES,
  initialOnboardingForm,
  pageSave,
  unavailableGoals,
  validatePage,
  withDraftsAdded,
  type OnboardingErrors,
  type OnboardingForm,
  type OnboardingPage,
} from "@/lib/onboarding/form";
import { createClient } from "@/lib/supabase/client";
import { saveEquipmentProfile } from "@/lib/training/data";
import { sortEquipmentKeys } from "@/lib/training/equipment";

const ICON = 20;

const GOAL_ICONS: Record<string, ReactNode> = {
  muscle_gain: <BicepsFlexed size={ICON} />,
  weight_loss: <TrendingDown size={ICON} />,
  strength: <Dumbbell size={ICON} />,
  general_fitness: <HeartPulse size={ICON} />,
  maintain_weight: <Scale size={ICON} />,
};
const GOAL_TILES = ONBOARDING_GOALS.map((value) => ({ value, label: optionLabel(GOAL_OPTIONS, value) ?? value, icon: GOAL_ICONS[value], disabledHint: "Arrives with the next update" }));

const ACTIVITY_ICONS: Record<ActivityBand, ReactNode> = { low: <Sofa size={ICON} />, moderate: <Footprints size={ICON} />, high: <Flame size={ICON} /> };
const ACTIVITY_TILES = ACTIVITY_BAND_OPTIONS.map((option) => ({ ...option, icon: ACTIVITY_ICONS[option.value] }));

/** Three rising bars with the first `level` filled: the experience levels at a glance. */
function LevelBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <svg width={ICON} height={ICON} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
      {[0, 1, 2].map((index) => (
        <rect key={index} x={2.5 + index * 5.5} y={13 - index * 4.5} width="4" height={5 + index * 4.5} rx="1.2" fillOpacity={index < level ? 1 : 0.28} />
      ))}
    </svg>
  );
}

const EXPERIENCE_TILES: TileOption<Experience>[] = [
  { value: "beginner", label: "Beginner", hint: "New or returning", icon: <LevelBars level={1} /> },
  { value: "intermediate", label: "Intermediate", hint: "6+ months regular", icon: <LevelBars level={2} /> },
  { value: "advanced", label: "Advanced", hint: "Years of structure", icon: <LevelBars level={3} /> },
];

const LOCATION_ICONS: Record<string, ReactNode> = { gym: <Dumbbell size={ICON} />, home: <House size={ICON} />, both: <Building2 size={ICON} /> };
const LOCATION_TILES = ONBOARDING_LOCATION_OPTIONS.map((option) => ({ ...option, icon: LOCATION_ICONS[option.value] }));

const DIET_ICONS: Record<string, ReactNode> = { vegetarian: <Leaf size={ICON} />, non_vegetarian: <Drumstick size={ICON} />, vegan: <Sprout size={ICON} />, eggetarian: <Egg size={ICON} /> };
const DIET_TILES = ONBOARDING_DIETS.map((value) => ({ value, label: optionLabel(DIET_OPTIONS, value) ?? value, icon: DIET_ICONS[value] }));

const SOURCE_ICONS: Record<FoodSource, ReactNode> = { home: <CookingPot size={ICON} />, outside: <Store size={ICON} />, both: <Shuffle size={ICON} /> };
const SOURCE_TILES = FOOD_SOURCE_OPTIONS.map((option) => ({ ...option, icon: SOURCE_ICONS[option.value] }));

const FOCUS_ICONS: Record<NutritionFocus, ReactNode> = { high_protein: <Target size={ICON} />, balanced: <Salad size={ICON} />, none: <Wheat size={ICON} /> };
const FOCUS_TILES = NUTRITION_FOCUS_OPTIONS.map((option) => ({ ...option, icon: FOCUS_ICONS[option.value] }));

const SEX_TILES = SEX_OPTIONS.map(({ value, label }) => ({ value, label }));
const MEAL_TILES = ONBOARDING_MEAL_OPTIONS.map(({ value, label }) => ({ value, label }));
const DAY_TILES = ONBOARDING_DAYS_PER_WEEK.map((value) => ({ value, label: String(value) }));

export function OnboardingFlow() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const [phase, setPhase] = useState<"loading" | "ready" | "load_failed" | "unavailable">("loading");
  const [context, setContext] = useState<UserContextData | null>(null);
  const [form, setForm] = useState<OnboardingForm | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reload, setReload] = useState(0);
  const [kitView, setKitView] = useState<"gym" | "home">("gym");
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const movedPage = useRef(false);

  const page: OnboardingPage = ONBOARDING_PAGES[pageIndex].id;
  const isLast = pageIndex === ONBOARDING_PAGES.length - 1;
  const schema = useMemo(() => ({ preferencesV2: context?.schema.preferencesV2 ?? false, onboardingV3: context?.schema.onboardingV3 ?? false }), [context]);

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
      setForm(initialOnboardingForm(result.data, metadataName));
      setKitView(result.data.preferences.workout_location === "home" ? "home" : "gym");
      setPhase("ready");
    })();
    return () => {
      live = false;
    };
  }, [router, reload]);

  useEffect(() => {
    if (!movedPage.current) return;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [pageIndex, reduced]);

  const update = useCallback(<K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSaveError("");
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const age = form ? ageFromBirthDate(form.birthDate) : null;
  const targets = useMemo(() => {
    if (!form) return null;
    return calculateNutritionTargets({ age, gender: form.gender, height: form.heightCm, weight: form.weightKg }, form.activity, form.goal);
  }, [form, age]);

  async function savePage(current: OnboardingPage, values: OnboardingForm) {
    const supabase = createClient();
    if (!supabase || !context) return "Your session has ended. Sign in again to continue.";
    const userId = context.userId;
    const fail = (error: { code?: string } | null) =>
      error?.code === "23514" ? "One of these answers isn't accepted yet. Choose another for now." : "We couldn't save this page. Check your connection and try again.";
    const plan = pageSave(current, values, {
      schema,
      legacyDiet: context.legacy.dietaryPreferences,
      unknownEquipment: context.legacy.unknownEquipment,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (plan.profile) {
      let saved = await updateProfileRow(supabase, userId, plan.profile);
      // Without the right to set the birth date yet, the age (worked out from it) still saves.
      if (saved.error?.code === "42501" && "date_of_birth" in plan.profile) {
        const rest = { ...plan.profile };
        delete rest.date_of_birth;
        saved = await updateProfileRow(supabase, userId, rest);
      }
      if (saved.error) {
        return saved.error.code === "profile_missing" || saved.error.code === "42501"
          ? "We couldn't set up your profile. Please try again, or contact FITX support if this keeps happening."
          : fail(saved.error);
      }
    }
    const prefs = await savePreferences(supabase, userId, plan.preferences, { v2: schema.preferencesV2, v3: schema.onboardingV3 });
    if (prefs.error) return fail(prefs.error);
    if (context.equipmentLists.available) {
      const lists = context.equipmentLists;
      const same = (a: readonly string[], b: readonly string[]) => sortEquipmentKeys(a).join() === sortEquipmentKeys(b).join();
      if (plan.equipment.home) {
        const listed = await saveEquipmentProfile(supabase, userId, "home", plan.equipment.home);
        if (listed.error) return fail(listed.error);
      }
      // The gym list starts as a fully equipped gym; it is saved once it is changed (or was saved before).
      if (plan.equipment.gym && (lists.gym.saved || !same(plan.equipment.gym, lists.gym.keys))) {
        const listed = await saveEquipmentProfile(supabase, userId, "gym", plan.equipment.gym);
        if (listed.error) return fail(listed.error);
      }
    }
    return null;
  }

  async function finish(values: OnboardingForm) {
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

  async function advance() {
    if (!form || saving) return;
    // Text typed into a tag field but not added still counts.
    const values = withDraftsAdded(form);
    const found = validatePage(page, values, schema);
    setErrors(found);
    setSaveError("");
    if (Object.keys(found).length) {
      setSaveError("Check the highlighted answers.");
      focusFirstInvalid(formRef.current);
      return;
    }
    setSaving(true);
    const problem = (await savePage(page, values)) ?? (isLast ? await finish(values) : null);
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
    movedPage.current = true;
    setPageIndex((index) => index + 1);
  }

  function back() {
    setErrors({});
    setSaveError("");
    movedPage.current = true;
    setPageIndex((index) => Math.max(0, index - 1));
  }

  if (phase === "loading") {
    return (
      <Frame>
        <p className="py-16 text-center text-sm text-fitx-text-secondary" role="status">Loading your profile…</p>
      </Frame>
    );
  }
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

  const v2 = schema.preferencesV2;
  const v3 = schema.onboardingV3;
  const meta = ONBOARDING_PAGES[pageIndex];
  const total = ONBOARDING_PAGES.length;
  const goalLabel = optionLabel(GOAL_OPTIONS, form.goal) ?? <NotGiven />;
  const visibleKit = form.location === "home" ? form.homeEquipment : form.location === "gym" ? form.gymEquipment : [...new Set([...form.gymEquipment, ...form.homeEquipment])];
  const kitShown: "gym" | "home" = form.location === "both" ? kitView : form.location === "home" ? "home" : "gym";
  const pageMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12, transition: { duration: DURATION.fast } }, transition: { duration: DURATION.base, ease: EASE.out } };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className="mx-auto flex h-full max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Logo size={30} />
          <Progress index={pageIndex} />
        </div>
      </header>

      <div className={styles.layout}>
        {/* The stage: the page title, and what the answers so far add up to, drawn. */}
        <section data-onboarding-stage="" className={`${styles.stage} px-4 pb-5 pt-5 sm:px-8 sm:pb-7 lg:flex lg:flex-col lg:px-12 lg:py-10`} aria-labelledby="onboarding-title">
          <div className="flex items-start justify-between gap-4 lg:block">
            <div className="min-w-0">
              <p className="text-[.6875rem] font-semibold uppercase tracking-[.16em] text-fitx-on-stage-secondary">Step {pageIndex + 1} of {total}</p>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1} className={`${styles.title} mt-2 text-[2rem] text-fitx-on-stage outline-none sm:text-[2.6rem] lg:text-[3.4rem]`}>{meta.title}</h1>
            </div>
            <span aria-hidden="true" className={`${styles.stepNumber} hidden sm:block lg:hidden`}>0{pageIndex + 1}</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <m.div key={page} {...pageMotion} className={`${styles.stageBody} mt-5 lg:mt-8`}>
              {page === "personal" && <>
                <div className={`${styles.art} order-2 sm:order-1`}><PersonalArt heightCm={form.heightCm} /></div>
                <div className="order-1 min-w-0 flex-1 sm:order-2 lg:flex-none">
                  <PersonalReadouts age={age} height={formatHeight(form.heightCm, form.heightUnit)} weight={formatWeight(form.weightKg, form.weightUnit)} goal={goalLabel} kcal={targets?.calories ?? null} />
                </div>
              </>}
              {page === "food" && <>
                <div className={`${styles.art} order-2 sm:order-1`}><FoodArt meals={form.meals} icon={form.diet ? <DietIcon diet={form.diet} /> : <Salad size={34} />} /></div>
                <dl className="order-1 grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-4 sm:order-2 lg:flex-none">
                  <Readout label="Diet" value={optionLabel(DIET_OPTIONS, form.diet) ?? <NotGiven />} />
                  <Readout label="Meals a day" value={form.meals >= 5 ? "5+" : String(form.meals)} />
                  {v3 && <Readout label="Food" value={optionLabel(FOOD_SOURCE_OPTIONS, form.foodSource) ?? <NotGiven />} />}
                  {v3 && <Readout label="Focus" value={optionLabel(NUTRITION_FOCUS_OPTIONS, form.nutritionFocus) ?? <NotGiven />} />}
                </dl>
              </>}
              {page === "training" && (
                <div className="flex w-full flex-col gap-5 lg:flex-1 lg:justify-between">
                  <TrainingArt days={form.days} kit={visibleKit} homeBodyweight={form.location !== "gym" && form.homeEquipment.length === 0} />
                  <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 lg:grid-cols-2">
                    <Readout label="Where" value={optionLabel(ONBOARDING_LOCATION_OPTIONS, form.location) ?? <NotGiven />} />
                    <Readout label="Days a week" value={String(form.days)} />
                    <Readout label="Level" value={EXPERIENCE_TILES.find((tile) => tile.value === form.experience)?.label ?? <NotGiven />} />
                    <Readout label="Equipment" value={visibleKit.length ? `${visibleKit.length} ${visibleKit.length === 1 ? "item" : "items"}` : "Bodyweight"} />
                  </dl>
                </div>
              )}
            </m.div>
          </AnimatePresence>
        </section>

        <div className="min-w-0">
          <form ref={formRef} noValidate onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void advance(); }} className="mx-auto w-full max-w-[680px]">
            <AnimatePresence mode="wait" initial={false}>
              <m.div key={page} {...pageMotion} className="px-4 sm:px-8 lg:px-12">
                {page === "personal" && <>
                  <Block title="Basics">
                    <TextField label="Name" value={form.name} onChange={(value) => update("name", value)} error={errors.name} autoComplete="name" maxLength={NAME_MAX_LENGTH} required />
                    <BirthDateField value={form.birthDate} onChange={(value) => update("birthDate", value)} error={errors.birthDate} />
                    <ChoiceTiles legend="Gender" options={SEX_TILES} value={form.gender} onChange={(value) => update("gender", value)} columns="grid-cols-3" variant="compact" error={errors.gender} />
                  </Block>
                  <Block title="Body">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <HeightField cm={form.heightCm} unit={form.heightUnit} onChange={(cm) => update("heightCm", cm)} onUnitChange={(unit) => update("heightUnit", unit)} error={errors.heightCm} required showUnits={v2} />
                      <WeightField label="Current weight" kg={form.weightKg} unit={form.weightUnit} onChange={(kg) => update("weightKg", kg)} onUnitChange={(unit) => update("weightUnit", unit)} error={errors.weightKg} required showUnits={v2} />
                    </div>
                    <WeightField label="Target weight" kg={form.targetWeightKg} unit={form.weightUnit} onChange={(kg) => update("targetWeightKg", kg)} onUnitChange={(unit) => update("weightUnit", unit)} error={errors.targetWeightKg} showUnits={v2} />
                  </Block>
                  <Block title="Goal">
                    <ChoiceTiles legend="Primary goal" options={GOAL_TILES} value={form.goal} onChange={(value: Goal) => update("goal", value)} disabledValues={unavailableGoals(schema)} error={errors.goal} />
                    <ChoiceTiles legend="Fitness experience" options={EXPERIENCE_TILES} value={form.experience} onChange={(value) => update("experience", value)} columns="grid-cols-3" variant="tile" />
                    <ChoiceTiles legend="Activity level" options={ACTIVITY_TILES} value={activityBand(form.activity)} onChange={(band) => update("activity", activityForBand(band, form.activity))} columns="grid-cols-3" />
                    <ChoiceTiles legend="Workout setup" options={LOCATION_TILES} value={form.location} onChange={(value: TrainingLocation) => { update("location", value); if (value !== "both") setKitView(value === "home" ? "home" : "gym"); }} columns="grid-cols-3" variant="tile" />
                  </Block>
                  <Block title="Diet and safety">
                    <ChoiceTiles legend="Diet" options={DIET_TILES} value={form.diet} onChange={(value: DietType) => update("diet", value)} columns="grid-cols-2" variant="row" />
                    <ChipGroup legend="Food allergies" hint="Leave empty if you have none." options={ALLERGY_OPTIONS} values={form.allergies} onChange={(values) => update("allergies", values)} />
                    {v2 && <>
                      <ChipGroup legend="Injuries or limitations" options={LIMITATION_OPTIONS} values={form.limitations} onChange={(values) => update("limitations", values)} />
                      <TagInput legend="Anything else to work around?" values={form.customLimitations} onChange={(values) => update("customLimitations", values)} draft={form.limitationDraft} onDraftChange={(value) => update("limitationDraft", value)} addLabel="Add limitation" placeholder="For example a recent surgery" maxLength={MAX_LIMITATION_LENGTH} max={MAX_CUSTOM_LIMITATIONS} />
                    </>}
                  </Block>
                </>}

                {page === "food" && <>
                  <Block title="Diet preference">
                    <ChoiceTiles legend="Which describes you best?" options={DIET_TILES} value={form.diet} onChange={(value: DietType) => update("diet", value)} columns="grid-cols-2 sm:grid-cols-4" error={errors.diet} />
                  </Block>
                  <Block title="Allergies">
                    <ChipGroup legend="Food allergies or intolerances" hint="Choose all that apply." options={ALLERGY_OPTIONS} values={form.allergies} onChange={(values) => update("allergies", values)} />
                    <TagInput legend="Other allergies" values={form.customAllergies} onChange={(values) => update("customAllergies", values)} draft={form.allergyDraft} onDraftChange={(value) => update("allergyDraft", value)} addLabel="Add allergy" placeholder="For example kiwi" />
                  </Block>
                  {v2 && (
                    <Block title="Restrictions">
                      <ChipGroup legend="Rules you follow" options={FOOD_RULE_OPTIONS} values={form.foodRules} onChange={(values) => update("foodRules", values)} />
                      <TagInput legend="Foods you avoid" values={form.dislikes} onChange={(values) => update("dislikes", values)} draft={form.dislikeDraft} onDraftChange={(value) => update("dislikeDraft", value)} addLabel="Add food" placeholder="For example bitter gourd" max={MAX_FOOD_DISLIKES} />
                    </Block>
                  )}
                  <Block title="Habits">
                    <ChoiceTiles legend="Meals per day" options={MEAL_TILES} value={form.meals} onChange={(value) => update("meals", value)} columns="grid-cols-4" variant="number" />
                    {v3 && <ChoiceTiles legend="Food preference" options={SOURCE_TILES} value={form.foodSource} onChange={(value) => update("foodSource", value)} columns="grid-cols-3" />}
                    {v3 && <ChoiceTiles legend="Nutrition goal" hint="High protein raises your daily protein target." options={FOCUS_TILES} value={form.nutritionFocus} onChange={(value) => update("nutritionFocus", value)} columns="grid-cols-3" />}
                  </Block>
                </>}

                {page === "training" && <>
                  <Block title="Location">
                    <ChoiceTiles legend="Workout location" options={LOCATION_TILES} value={form.location} onChange={(value: TrainingLocation) => { update("location", value); setKitView(value === "home" ? "home" : "gym"); }} columns="grid-cols-3" />
                  </Block>
                  <Block title="Equipment" hint="Select all that apply.">
                    {form.location === "both" && (
                      <Segmented label="Equipment for" block options={[{ value: "gym", label: "Gym" }, { value: "home", label: "Home" }]} value={kitView} onChange={setKitView} />
                    )}
                    <AnimatePresence mode="wait" initial={false}>
                      <m.div key={kitShown} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.15 : DURATION.fast }}>
                        {kitShown === "home"
                          ? <EquipmentGrid context="home" label="Home equipment" value={form.homeEquipment} onChange={(keys) => update("homeEquipment", keys)} />
                          : <EquipmentGrid context="gym" label="Gym equipment" value={form.gymEquipment} onChange={(keys) => update("gymEquipment", keys)} />}
                      </m.div>
                    </AnimatePresence>
                  </Block>
                  <Block title="Experience">
                    <ChoiceTiles legend="Workout experience" options={EXPERIENCE_TILES} value={form.experience} onChange={(value) => update("experience", value)} columns="grid-cols-3" />
                  </Block>
                  <Block title="Availability">
                    <ChoiceTiles legend="Days a week" options={DAY_TILES} value={form.days} onChange={(value) => update("days", value)} columns="grid-cols-6" variant="number" error={errors.days} />
                  </Block>
                </>}
              </m.div>
            </AnimatePresence>

            <div className={`${styles.actions} mt-4 px-4 pt-3 sm:px-8 lg:px-12`}>
              {saveError && <p role="alert" className="fitx-alert fitx-alert-danger mb-3">{saveError}</p>}
              <div className="flex items-center gap-2">
                {pageIndex > 0 && (
                  <button type="button" onClick={back} disabled={saving} className="fitx-button fitx-button-secondary shrink-0 px-4">
                    <ArrowLeft size={16} aria-hidden="true" />Back
                  </button>
                )}
                <button type="submit" disabled={saving} className="fitx-button flex-1 whitespace-nowrap sm:ml-auto sm:flex-none sm:px-7">
                  {saving ? "Saving…" : isLast ? "Finish setup" : "Continue"}
                  {isLast ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
          </form>
          {/* Signed in with the wrong Google account? Besides Help, onboarding is the only page such an account can
              reach, so it can sign out or delete the account from here. */}
          <div className="mx-auto flex max-w-[680px] flex-wrap justify-center gap-x-6 px-4 pb-6 pt-4">
            <LogoutButton label="Use a different account" />
            <HelpLink />
            <DeleteAccount variant="link" returnTo="/onboarding" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DietIcon({ diet }: { diet: DietType }) {
  const size = 34;
  if (diet === "non_vegetarian") return <Drumstick size={size} />;
  if (diet === "vegan") return <Sprout size={size} />;
  if (diet === "eggetarian") return <Egg size={size} />;
  return <Leaf size={size} />;
}

/** Three labelled segments; the current one fills. */
function Progress({ index }: { index: number }) {
  const reduced = useReducedMotionSafe();
  const total = ONBOARDING_PAGES.length;
  const current = ONBOARDING_PAGES[index];
  return (
    <div className="ml-auto w-full max-w-[420px]" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${total}: ${current.title}`}>
      <ol className="grid grid-cols-3 gap-2" aria-hidden="true">
        {ONBOARDING_PAGES.map((item, position) => (
          <li key={item.id} className="min-w-0">
            <span className={`block truncate text-[.6875rem] font-semibold uppercase tracking-[.12em] ${position <= index ? "text-fitx-text" : "text-fitx-text-disabled"}`}>{item.label}</span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-fitx-track">
              <m.span
                className="block h-full origin-left rounded-full bg-fitx-primary"
                initial={false}
                animate={{ scaleX: position <= index ? 1 : 0 }}
                transition={reduced ? { duration: 0 } : { duration: DURATION.slow, ease: EASE.out }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A titled group of questions on a page. */
function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={`${styles.section} py-7 sm:py-9`}>
      <h2 className="text-lg font-semibold tracking-[-.02em] text-fitx-text">{title}</h2>
      {hint && <p className="mt-1 text-sm text-fitx-text-secondary">{hint}</p>}
      <div className="mt-5 space-y-6">{children}</div>
    </section>
  );
}

/** The full-window frame with the header, for the loading and error states (so nothing jumps when setup loads). */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className="mx-auto flex h-full max-w-[1440px] items-center px-4 sm:px-6 lg:px-10"><Logo size={30} /></div>
      </header>
      {children}
    </div>
  );
}

/** `reachable`: FITX's services answer, so Help and deleting the account can work from here. */
function Shell({ children, reachable = false }: { children: ReactNode; reachable?: boolean }) {
  return (
    <Frame>
      <div className="mx-auto w-full max-w-[560px] space-y-4 px-4 py-10">
        {children}
        <div className="flex flex-wrap justify-center gap-x-6">
          <LogoutButton label="Use a different account" />
          {reachable && <HelpLink />}
          {reachable && <DeleteAccount variant="link" returnTo="/onboarding" />}
        </div>
      </div>
    </Frame>
  );
}

/**
 * Help is open to an account still in setup (src/lib/auth/before-onboarding.ts); a request sent from there notes it
 * came from setup. The colour sits on the inner span: the global unlayered `a { color: inherit }` outranks utilities
 * on the link itself, and this should look like the two buttons beside it.
 */
function HelpLink() {
  return (
    <Link href="/help?from=%2Fonboarding" className="group inline-flex min-h-11 items-center text-sm">
      <span className="inline-flex items-center gap-2 text-fitx-text-secondary group-hover:text-fitx-text"><CircleHelp size={16} aria-hidden="true" />Get help</span>
    </Link>
  );
}
