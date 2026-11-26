"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Mars, RotateCcw, UserRound, Venus } from "lucide-react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { LogoutButton } from "@/components/app/LogoutButton";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { ChoiceTiles } from "@/components/onboarding/ChoiceTiles";
import { MeasureDial } from "@/components/onboarding/MeasureDial";
import styles from "@/components/onboarding/Onboarding.module.css";
import { PhotoChoices, type PhotoOption } from "@/components/onboarding/PhotoChoices";
import { PostOnboardingSequence } from "@/components/onboarding/PostOnboardingSequence";
import { NotGiven, PersonalArt, PersonalReadouts, Readout, StagePhoto } from "@/components/onboarding/StageArt";
import { BirthDateField, SavedBirthDate, TextField, focusFirstInvalid } from "@/components/profile/ProfileControls";
import { Logo } from "@/components/ui/Logo";
import { ONBOARDING_MEDIA } from "@/data/onboarding-media";
import { calculateNutritionTargets } from "@/lib/domain/nutrition";
import {
  ACTIVITY_BAND_OPTIONS,
  GOAL_OPTIONS,
  NAME_MAX_LENGTH,
  ONBOARDING_GOALS,
  SEX_OPTIONS,
  activityBand,
  activityForBand,
  BIRTH_DATE_ONCE_NOTE,
  BIRTH_DATE_SAVED_ERROR,
  formatHeight,
  formatWeight,
  isBirthDateLocked,
  normalizeBirthDate,
  optionLabel,
  sameWeightKg,
  shownAge,
  type ActivityBand,
  type Goal,
  type Sex,
} from "@/lib/domain/profile-options";
import { ensureProfileRow, loadBirthDate, loadUserContext, logWeighIn, savePreferences, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import {
  NO_DRAFTS,
  ONBOARDING_PAGES,
  firstName,
  initialOnboardingForm,
  messagesAfterUnitChange,
  pageSave,
  unavailableGoals,
  validatePage,
  type MeasureDrafts,
  type MeasureKey,
  type OnboardingErrors,
  type OnboardingForm,
  type OnboardingPage,
} from "@/lib/onboarding/form";
import type { MeasureText } from "@/lib/onboarding/measure-field";
import { focusAfterFailedSave, focusAfterRetry } from "@/lib/onboarding/save-focus";
import { createClient } from "@/lib/supabase/client";

const GOAL_PHOTOS: Readonly<Record<string, keyof typeof ONBOARDING_MEDIA>> = {
  muscle_gain: "goal-muscle",
  weight_loss: "goal-loss",
  strength: "goal-strength",
  general_fitness: "goal-fitness",
  maintain_weight: "goal-maintain",
};
const GOAL_HINTS: Readonly<Record<string, string>> = {
  muscle_gain: "Build size",
  weight_loss: "Lean down steadily",
  strength: "Lift heavier",
  general_fitness: "Feel fitter all round",
  maintain_weight: "Hold steady",
};
const GOAL_CARDS: PhotoOption<Goal>[] = ONBOARDING_GOALS.map((value) => ({
  value,
  label: optionLabel(GOAL_OPTIONS, value) ?? value,
  hint: GOAL_HINTS[value],
  photo: ONBOARDING_MEDIA[GOAL_PHOTOS[value]],
  disabledHint: "Arrives with the next update",
}));

const ACTIVITY_PHOTOS: Readonly<Record<ActivityBand, keyof typeof ONBOARDING_MEDIA>> = { low: "activity-low", moderate: "activity-moderate", high: "activity-high" };
const ACTIVITY_CARDS: PhotoOption<ActivityBand>[] = ACTIVITY_BAND_OPTIONS.map((option) => ({ ...option, photo: ONBOARDING_MEDIA[ACTIVITY_PHOTOS[option.value]] }));

const SEX_ICONS: Record<Sex, ReactNode> = { male: <Mars size={20} />, female: <Venus size={20} />, other: <UserRound size={20} /> };
const SEX_TILES = SEX_OPTIONS.map(({ value, label }) => ({ value, label, icon: SEX_ICONS[value] }));

const LEDE: Record<OnboardingPage, string> = {
  you: "Three quick steps and FITX is yours.",
  body: "Slide, tap or type. Change it any time in Profile.",
  goal: "Pick what matters most right now.",
};

export function OnboardingFlow() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const [phase, setPhase] = useState<"loading" | "ready" | "load_failed" | "unavailable" | "welcome">("loading");
  const [context, setContext] = useState<UserContextData | null>(null);
  const [form, setForm] = useState<OnboardingForm | null>(null);
  // What step 2's dials show in place of their values (text being typed, or kept because it is not a number). Held
  // here with the answers: Back unmounts the dials, and a NaN answer must come back with the text that gave it.
  const [drafts, setDrafts] = useState<MeasureDrafts>(NO_DRAFTS);
  // Once saved, the date of birth is shown, not edited: changing it is a FITX support request (the database refuses it).
  const [savedBirthDate, setSavedBirthDate] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Counts the saves that failed, so focus can be checked once each failure is on the screen.
  const [failedSaves, setFailedSaves] = useState(0);
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const movedPage = useRef(false);
  // Set by Try again: focus is handed on once the details have loaded (the button goes while they load).
  const retried = useRef(false);

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
      // Answers already given are never asked again: an onboarded account goes straight to Home.
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
      setSavedBirthDate(result.data.schema.onboardingV3 ? normalizeBirthDate(result.data.profile?.date_of_birth) : null);
      setForm(initialOnboardingForm(result.data, metadataName));
      setDrafts(NO_DRAFTS);
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

  // A failed save leaves focus where the member left it: Continue stays focusable while the step saves. If focus fell
  // to the page anyway (the save replaced the field it was in), it goes to Continue, under the message.
  useEffect(() => {
    if (failedSaves) focusAfterFailedSave(document.activeElement, document.body, submitRef.current)?.focus({ preventScroll: true });
  }, [failedSaves]);

  // After Try again, once loading ends: the step's heading when setup is ready, or the new Try again if it failed again.
  useEffect(() => {
    if (!retried.current || phase === "loading") return;
    retried.current = false;
    const target = focusAfterRetry(phase);
    (target === "heading" ? heading.current : target === "retry" ? retryRef.current : null)?.focus({ preventScroll: true });
  }, [phase]);

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

  const changeDraft = useCallback((key: MeasureKey, draft: MeasureText | null) => {
    setDrafts((current) => (current[key] === draft ? current : { ...current, [key]: draft }));
  }, []);

  /** A height or weight that can't be saved is said as soon as its field is left; an empty one waits for Continue. */
  function checkTyped(key: MeasureKey) {
    if (!form || form[key] === null) return;
    const message = validatePage("body", form, schema)[key];
    if (message) setErrors((current) => (current[key] === message ? current : { ...current, [key]: message }));
  }

  /**
   * A new unit, with what the dial that changed it holds in that unit (its kept text read again there). Messages
   * already shown for the unit's fields are said again for what they hold now, in the new unit (their limits are in it).
   */
  function changeUnit<K extends "heightUnit" | "weightUnit">(key: K, unit: OnboardingForm[K], values: Partial<Pick<OnboardingForm, MeasureKey>>) {
    setForm((current) => (current ? { ...current, ...values, [key]: unit } : current));
    setSaveError("");
    if (!form) return;
    const next = { ...form, ...values, [key]: unit };
    setErrors((current) => messagesAfterUnitChange(current, next, key, schema));
  }

  // The readouts follow the date as it is typed, so only an age somebody could have shows (never "1926 yrs").
  const age = form ? shownAge(form.birthDate) : null;
  const targets = useMemo(() => {
    if (!form) return null;
    // Nutrition's own setup asks for the member's focus; one already stored counts here too, as on every screen.
    const focus = schema.onboardingV3 ? context?.preferences.nutrition_focus ?? null : null;
    return calculateNutritionTargets({ age, gender: form.gender, height: form.heightCm, weight: form.weightKg }, form.activity, form.goal, focus);
  }, [form, age, schema, context]);

  async function savePage(current: OnboardingPage, values: OnboardingForm) {
    const supabase = createClient();
    if (!supabase || !context) return "Your session has ended. Sign in again to continue.";
    const userId = context.userId;
    const fail = (error: { code?: string } | null) =>
      error?.code === "23514" ? "One of these answers isn't accepted yet. Choose another for now." : "We couldn't save this page. Check your connection and try again.";
    const plan = pageSave(current, values, { schema, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    if (plan.profile) {
      let birthDateSent = "date_of_birth" in plan.profile;
      let saved = await updateProfileRow(supabase, userId, plan.profile);
      // Without the right to set the birth date yet, the age (worked out from it) still saves.
      if (saved.error?.code === "42501" && birthDateSent) {
        const rest = { ...plan.profile };
        delete rest.date_of_birth;
        birthDateSent = false;
        saved = await updateProfileRow(supabase, userId, rest);
      }
      // A date of birth saved earlier (another tab, or Explore) is not replaced: changing it is a support request.
      // It is shown from then on, and the page can be saved again with it.
      if (isBirthDateLocked(saved.error)) {
        const kept = await loadBirthDate(supabase, userId);
        if (kept) {
          setSavedBirthDate(kept);
          setForm((form) => (form ? { ...form, birthDate: kept } : form));
        }
        return BIRTH_DATE_SAVED_ERROR;
      }
      if (saved.error) {
        return saved.error.code === "profile_missing" || saved.error.code === "42501"
          ? "We couldn't set up your profile. Please try again, or contact FITX support if this keeps happening."
          : fail(saved.error);
      }
      if (birthDateSent) setSavedBirthDate(normalizeBirthDate(plan.profile.date_of_birth));
    }
    if (Object.keys(plan.preferences).length) {
      const prefs = await savePreferences(supabase, userId, plan.preferences, { v2: schema.preferencesV2, v3: schema.onboardingV3 });
      if (prefs.error) return fail(prefs.error);
    }
    return null;
  }

  async function finish(values: OnboardingForm) {
    const supabase = createClient();
    if (!supabase || !context) return "Your session has ended. Sign in again to continue.";
    const done = await updateProfileRow(supabase, context.userId, { onboarded: true });
    if (done.error) return "We couldn't finish setting up your account. Please try again.";
    // The weight given here becomes the current weight: logged when there is no weigh-in yet, or when it
    // differs from the newest one (an older account's history), never twice for the same value.
    const prior = await supabase.from("body_metrics").select("weight").eq("user_id", context.userId).not("weight", "is", null)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const latest = prior.data ? Number((prior.data as { weight: unknown }).weight) : null;
    // Compared at the stored 0.01 kg: a change of 0.1 lb (0.045 kg) is a new weight.
    if (!prior.error && values.weightKg !== null && (latest === null || !sameWeightKg(latest, values.weightKg))) {
      await logWeighIn(supabase, context.userId, values.weightKg, latest === null ? "Starting weight" : "Onboarding update");
    }
    return null;
  }

  async function advance() {
    // A press of Continue (or Enter in a field) while the step saves does nothing: the button is only aria-disabled.
    if (!form || saving) return;
    const found = validatePage(page, form, schema);
    setErrors(found);
    setSaveError("");
    if (Object.keys(found).length) {
      setSaveError("Check the highlighted answers.");
      focusFirstInvalid(formRef.current);
      return;
    }
    setSaving(true);
    const problem = (await savePage(page, form)) ?? (isLast ? await finish(form) : null);
    if (problem) {
      setSaving(false);
      setSaveError(problem);
      setFailedSaves((count) => count + 1);
      return;
    }
    if (isLast) {
      setPhase("welcome");
      return;
    }
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

  if (phase === "welcome") {
    // A full page load, so the head script can play the account's one-time intro on the first Home visit.
    return <PostOnboardingSequence onDone={() => window.location.assign("/dashboard")} firstName={form ? firstName(form.name) : null} />;
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
          <span id="onboarding-load-failed">We couldn’t load your details, so setup is paused to keep them safe.</span>
          {/* Focus comes here when a retry fails too, so the button carries the message for screen readers. */}
          <button ref={retryRef} type="button" aria-describedby="onboarding-load-failed" className="fitx-alert-action inline-flex min-h-11 items-center gap-1" onClick={() => { retried.current = true; setPhase("loading"); setReload((count) => count + 1); }}>
            <RotateCcw size={14} aria-hidden="true" />Try again
          </button>
        </div>
      </Shell>
    );
  }

  const meta = ONBOARDING_PAGES[pageIndex];
  const total = ONBOARDING_PAGES.length;
  const goalLabel = optionLabel(GOAL_OPTIONS, form.goal) ?? <NotGiven />;
  const name = firstName(form.name);
  const stagePhoto = page === "goal" ? ONBOARDING_MEDIA[GOAL_PHOTOS[form.goal] ?? "stage"] : ONBOARDING_MEDIA.stage;
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
        {/* The stage: the page title over a slowly drifting photograph, and what the answers so far add up to. */}
        <section data-onboarding-stage="" className={`${styles.stage} px-4 pb-5 pt-5 sm:px-8 sm:pb-7 lg:flex lg:flex-col lg:px-12 lg:py-10`} aria-labelledby="onboarding-title">
          <StagePhoto photo={stagePhoto} dim={page === "body"} />
          <div className="flex items-start justify-between gap-4 lg:block">
            <div className="min-w-0">
              <p className="text-[.6875rem] font-semibold uppercase tracking-[.16em] text-fitx-on-stage-secondary">Step {pageIndex + 1} of {total}</p>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1} className={`${styles.title} mt-2 text-[2rem] text-fitx-on-stage outline-none sm:text-[2.6rem] lg:text-[3.4rem]`}>{meta.title}</h1>
              <p className={`${styles.lede} mt-2`}>{page === "you" && name ? `Hi ${name}. ` : ""}{LEDE[page]}</p>
            </div>
            <span aria-hidden="true" className={`${styles.stepNumber} hidden sm:block lg:hidden`}>0{pageIndex + 1}</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <m.div key={page} {...pageMotion} className={`${styles.stageBody} mt-5 lg:mt-8`}>
              {page === "you" && (
                <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 lg:mt-auto">
                  <Readout label="Name" value={name ?? <NotGiven />} />
                  <Readout label="Age" value={age === null ? <NotGiven /> : `${age} yrs`} />
                </dl>
              )}
              {page === "body" && <>
                <div className={`${styles.art} order-2 sm:order-1`}><PersonalArt heightCm={form.heightCm} /></div>
                <dl className="order-1 grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-4 sm:order-2 lg:flex-none">
                  <Readout label="Height" value={formatHeight(form.heightCm, form.heightUnit) ?? <NotGiven />} />
                  <Readout label="Weight" value={formatWeight(form.weightKg, form.weightUnit) ?? <NotGiven />} />
                  <Readout label="Target" value={formatWeight(form.targetWeightKg, form.weightUnit) ?? <NotGiven />} />
                </dl>
              </>}
              {page === "goal" && (
                <div className="min-w-0 flex-1 lg:mt-auto lg:flex-none">
                  <PersonalReadouts age={age} height={formatHeight(form.heightCm, form.heightUnit)} weight={formatWeight(form.weightKg, form.weightUnit)} goal={goalLabel} kcal={targets?.calories ?? null} />
                </div>
              )}
            </m.div>
          </AnimatePresence>
        </section>

        <div className="min-w-0">
          <form ref={formRef} noValidate onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void advance(); }} className="mx-auto w-full max-w-[680px]">
            <AnimatePresence mode="wait" initial={false}>
              <m.div key={page} {...pageMotion} className="space-y-7 px-4 py-7 sm:px-8 sm:py-9 lg:px-12">
                {page === "you" && <>
                  <TextField label="Name" value={form.name} onChange={(value) => update("name", value)} error={errors.name} autoComplete="name" maxLength={NAME_MAX_LENGTH} required />
                  <ChoiceTiles legend="Gender" options={SEX_TILES} value={form.gender} onChange={(value) => update("gender", value)} columns="grid-cols-3" variant="tile" error={errors.gender} />
                  {/* Continue saves the date of birth for good (the database refuses a member's change), so the field
                      says so before then, as Profile and Explore settings do. */}
                  {savedBirthDate
                    ? <SavedBirthDate value={savedBirthDate} helpHref="/help?from=%2Fonboarding" />
                    : <BirthDateField value={form.birthDate} onChange={(value) => update("birthDate", value)} error={errors.birthDate} note={BIRTH_DATE_ONCE_NOTE} />}
                </>}

                {page === "body" && <>
                  <MeasureDial kind="height" label="Height" value={form.heightCm} draft={drafts.heightCm} onDraftChange={(draft) => changeDraft("heightCm", draft)} unit={form.heightUnit} onChange={(cm) => update("heightCm", cm)} onUnitChange={(unit, cm) => changeUnit("heightUnit", unit, { heightCm: cm })} onCommit={() => checkTyped("heightCm")} error={errors.heightCm} showUnits={schema.preferencesV2} />
                  <MeasureDial kind="weight" label="Current weight" value={form.weightKg} draft={drafts.weightKg} onDraftChange={(draft) => changeDraft("weightKg", draft)} unit={form.weightUnit} onChange={(kg) => update("weightKg", kg)} onUnitChange={(unit, kg) => changeUnit("weightUnit", unit, { weightKg: kg })} onCommit={() => checkTyped("weightKg")} error={errors.weightKg} showUnits={schema.preferencesV2} />
                  <MeasureDial kind="weight" label="Target weight" optional value={form.targetWeightKg} draft={drafts.targetWeightKg} onDraftChange={(draft) => changeDraft("targetWeightKg", draft)} unit={form.weightUnit} onChange={(kg) => update("targetWeightKg", kg)} onUnitChange={(unit, kg) => changeUnit("weightUnit", unit, { targetWeightKg: kg })} onCommit={() => checkTyped("targetWeightKg")} error={errors.targetWeightKg} showUnits={schema.preferencesV2} />
                </>}

                {page === "goal" && <>
                  <PhotoChoices legend="Primary goal" options={GOAL_CARDS} value={form.goal} onChange={(value) => update("goal", value)} disabledValues={unavailableGoals(schema)} error={errors.goal} />
                  <PhotoChoices legend="Activity level" layout="three" options={ACTIVITY_CARDS} value={activityBand(form.activity)} onChange={(band) => update("activity", activityForBand(band, form.activity))} />
                </>}
              </m.div>
            </AnimatePresence>

            <div className={`${styles.actions} px-4 pt-3 sm:px-8 lg:px-12`}>
              {saveError && <p role="alert" className="fitx-alert fitx-alert-danger mb-3">{saveError}</p>}
              <div className="flex items-center gap-2">
                {/* Back can't be pressed while the step saves, so it never races the save. A save starts from Continue
                    or from Enter in a field, never with focus on Back, so its being disabled drops no focus. */}
                {pageIndex > 0 && (
                  <button type="button" onClick={back} disabled={saving} className="fitx-button fitx-button-secondary shrink-0 px-4">
                    <ArrowLeft size={16} aria-hidden="true" />Back
                  </button>
                )}
                {/* aria-disabled while saving, not disabled: Chrome drops focus from a button that becomes disabled, and
                    a failed save's message is then read with focus nowhere. advance() ignores a press meanwhile. */}
                <button ref={submitRef} type="submit" aria-disabled={saving || undefined} className={`fitx-button ${styles.submit} flex-1 whitespace-nowrap sm:ml-auto sm:flex-none sm:px-7`}>
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
