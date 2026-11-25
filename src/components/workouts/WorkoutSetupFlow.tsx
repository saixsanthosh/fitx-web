"use client";

/**
 * The Workouts first-time setup (phase 7, brief 3.4): where the member trains, the equipment they have (photo
 * tiles), their experience, training days, anything to go easy on and the demonstration model. A few short
 * steps; nothing is typed. It never blocks the page: inline on a first visit with Later, and in a sheet from
 * "Workout setup" whenever the member wants to change an answer. Saving goes through saveWorkoutSetup.
 */
import Image from "next/image";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown } from "lucide-react";
import { EquipmentTile } from "@/components/equipment/EquipmentTile";
import { WORKOUTMODES_MEDIA } from "@/data/workout-modes-media";
import { LIMITATION_OPTIONS, joinLimitations, splitLimitations } from "@/lib/domain/profile-options";
import { createClient } from "@/lib/supabase/client";
import { equipmentFor } from "@/lib/training/data";
import { DEMO_SETUP_NOTE, useDemoIndex } from "@/lib/training/use-demo-model";
import {
  DEMO_MODELS, DEMO_MODEL_LABELS, LOCATION_LABELS, MAX_DAYS, MIN_DAYS, WORKOUT_LOCATIONS, contextsFor, resolveDemoModel, saveWorkoutSetup,
  type DemoModel, type WorkoutLocation, type WorkoutSetup,
} from "@/lib/training/setup";
import { DEFAULT_GYM_EQUIPMENT, EQUIPMENT, LEVELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { cn } from "@/lib/utils";
import { setupSteps, type SetupStep } from "./setup-steps";
import styles from "./WorkoutSetup.module.css";

const LEVEL_TEXT: Record<Level, { label: string; detail: string }> = {
  beginner: { label: "New to it", detail: "Under 6 months" },
  intermediate: { label: "Regular", detail: "6 months to 2 years" },
  advanced: { label: "Experienced", detail: "Over 2 years" },
};
const STEP_TITLES: Record<SetupStep, string> = {
  where: "Where do you train?",
  home: "What do you have at home?",
  gym: "What does your gym have?",
  you: "About your training",
};
/** Common items first; the rest wait behind "More equipment" unless chosen. */
const FIRST: Record<TrainingContext, readonly string[]> = {
  home: ["dumbbell", "kettlebell", "resistance_band", "pull_up_bar", "bench", "box", "chair", "stability_ball", "medicine_ball", "jump_rope", "suspension_trainer"],
  gym: ["dumbbell", "barbell", "bench", "squat_rack", "cable_machine", "machine", "smith_machine", "kettlebell", "ez_bar", "pull_up_bar", "dip_station", "cardio_machine"],
};
const ORDER = EQUIPMENT.map((item) => item.key);
const SHORT: Record<string, string> = { barbell: "Barbell", resistance_band: "Bands", box: "Box or step", ez_bar: "EZ bar", squat_rack: "Squat rack", machine: "Machines", cardio_machine: "Cardio machines", suspension_trainer: "Suspension or rings", stability_ball: "Exercise ball", chair: "Chair", dip_station: "Dip bars", strongman_implements: "Strongman kit", specialty: "Other kit" };
const shortLabel = (key: string) => SHORT[key] ?? EQUIPMENT.find((item) => item.key === key)?.label ?? key;

export function WorkoutSetupFlow({ setup, userId, legacyWords, variant, onSaved, onLater }: {
  setup: WorkoutSetup;
  userId: string;
  /** user_preferences.equipment, for the starting home list. */
  legacyWords?: readonly string[] | null;
  variant: "inline" | "sheet";
  onSaved: (next: WorkoutSetup) => void;
  /** Inline only: hides the setup for now. In a sheet the sheet's own Close does this. */
  onLater?: () => void;
}) {
  const [location, setLocation] = useState<WorkoutLocation>(setup.location);
  const [lists, setLists] = useState<Record<TrainingContext, string[]>>(() => ({
    home: equipmentFor(setup.profiles, "home", legacyWords).keys,
    gym: setup.profiles.gym ?? [...DEFAULT_GYM_EQUIPMENT],
  }));
  const [level, setLevel] = useState<Level>(setup.level);
  const [days, setDays] = useState(setup.daysPerWeek);
  const initialLimits = useMemo(() => splitLimitations(setup.limitations), [setup.limitations]);
  const [limits, setLimits] = useState<string[]>(() => [...initialLimits.keys]);
  const [demoChoice, setDemoChoice] = useState<DemoModel | null>(setup.demoModel);
  const [stepIndex, setStepIndex] = useState(0);
  // 0 until the member moves: the first step appears without sliding in.
  const [direction, setDirection] = useState<1 | -1 | 0>(0);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const steps = setupSteps(location);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const last = stepIndex >= steps.length - 1;
  const demoShown = resolveDemoModel(demoChoice, setup.gender);
  // The index of FITX's AI demonstrations (one read per page); while it loads, or with none, the older note shows.
  const demoIndex = useDemoIndex();
  const demosAvailable = (demoIndex?.size ?? 0) > 0;

  const go = (delta: 1 | -1) => {
    setDirection(delta);
    setExpanded(false);
    setStepIndex((index) => Math.max(0, Math.min(steps.length - 1, index + delta)));
  };

  async function save() {
    const supabase = createClient();
    if (!supabase) { setProblem("FITX is not connected to Supabase in this environment."); return; }
    setSaving(true); setProblem("");
    const contexts = contextsFor(location);
    const withLists = setup.profiles.available;
    const answers = {
      location, level, daysPerWeek: days, demoModel: demoChoice,
      limitations: joinLimitations(limits, initialLimits.custom),
      home: withLists && contexts.includes("home") ? lists.home : null,
      gym: withLists && contexts.includes("gym") ? lists.gym : null,
    };
    const now = new Date();
    const outcome = await saveWorkoutSetup(supabase, userId, answers, now);
    setSaving(false);
    if (outcome.error) { setProblem("Your setup couldn’t be saved. Check your connection and try again."); return; }
    onSaved({
      ...setup, location, level, daysPerWeek: days, limitations: answers.limitations, demoModel: demoChoice,
      setupAt: outcome.storedSetupTime ? now.toISOString() : setup.setupAt,
      profiles: { ...setup.profiles, home: answers.home ?? setup.profiles.home, gym: answers.gym ?? setup.profiles.gym },
      stored: true, done: true,
    });
  }

  const toggleKey = (context: TrainingContext, key: string) => setLists((current) => {
    const next = new Set(current[context]);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...current, [context]: ORDER.filter((item) => next.has(item)) };
  });

  const equipmentStep = (context: TrainingContext) => {
    const chosen = new Set(lists[context]);
    const pool = context === "home" ? ORDER.filter((key) => key !== "sled" && key !== "strongman_implements") : ORDER.filter((key) => key !== "chair");
    const rest = pool.filter((key) => !FIRST[context].includes(key));
    const shown = [...FIRST[context], ...(expanded ? rest : rest.filter((key) => chosen.has(key)))];
    const hidden = rest.length - (shown.length - FIRST[context].length);
    return (
      <div className="grid gap-3">
        <div role="group" aria-label={context === "home" ? "Home equipment" : "Gym equipment"} className={styles.equipment}>
          {context === "home" && <EquipmentTile equipmentKey="none" label="No equipment" on={chosen.size === 0} onClick={() => setLists((current) => ({ ...current, home: [] }))} />}
          {shown.map((key) => <EquipmentTile key={key} equipmentKey={key} label={shortLabel(key)} on={chosen.has(key)} onClick={() => toggleKey(context, key)} />)}
        </div>
        {(hidden > 0 || expanded) && (
          <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start px-1 text-sm font-semibold text-fitx-primary-text">
            {expanded ? "Fewer items" : `More equipment (${hidden})`}<ChevronDown size={15} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          </button>
        )}
        {!setup.profiles.available && <p className="m-0 text-xs text-fitx-text-secondary">Equipment lists save with the next FITX update; your other answers save now.</p>}
      </div>
    );
  };

  const body = (() => {
    if (step === "where") return (
      <div role="group" aria-label="Where you train" className={styles.places}>
        {WORKOUT_LOCATIONS.map((value) => {
          const on = location === value;
          return (
            <button key={value} type="button" aria-pressed={on} onClick={() => setLocation(value)} className={cn(styles.place, on && styles.placeOn)}>
              <span className={styles.placeArt} aria-hidden="true">
                {value === "both" ? (
                  <>
                    <span className={styles.half}><Image src={WORKOUTMODES_MEDIA.home.src} alt="" fill sizes="(min-width: 768px) 120px, 16vw" className="object-cover" /></span>
                    <span className={cn(styles.half, styles.halfRight)}><Image src={WORKOUTMODES_MEDIA.gym.src} alt="" fill sizes="(min-width: 768px) 120px, 16vw" className="object-cover" /></span>
                  </>
                ) : (
                  <Image src={WORKOUTMODES_MEDIA[value].src} alt="" fill sizes="(min-width: 768px) 240px, 33vw" placeholder="blur" blurDataURL={WORKOUTMODES_MEDIA[value].blurDataURL} className="object-cover" />
                )}
              </span>
              <span className={styles.placeLabel}>{LOCATION_LABELS[value]}{on && <Check size={15} strokeWidth={3} aria-hidden="true" />}</span>
            </button>
          );
        })}
      </div>
    );
    if (step === "home" || step === "gym") return equipmentStep(step);
    return (
      <div className="grid gap-5">
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className={styles.legend}>Experience</legend>
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map((value) => (
              <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)} className={cn(styles.choice, level === value && styles.choiceOn)}>
                <span className="block text-sm font-semibold text-fitx-text">{LEVEL_TEXT[value].label}</span>
                <span className="block text-[11px] text-fitx-text-secondary">{LEVEL_TEXT[value].detail}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className={styles.legend}>Days a week</legend>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, index) => MIN_DAYS + index).map((value) => (
              <button key={value} type="button" aria-pressed={days === value} aria-label={`${value} day${value === 1 ? "" : "s"} a week`} onClick={() => setDays(value)}
                className={cn(styles.day, days === value && styles.choiceOn)}>{value}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className={styles.legend}>Go easy on <span className="font-normal normal-case tracking-normal">(optional)</span></legend>
          <div className="flex flex-wrap gap-2">
            {LIMITATION_OPTIONS.map((option) => {
              const on = limits.includes(option.value);
              return (
                <button key={option.value} type="button" aria-pressed={on} onClick={() => setLimits((current) => on ? current.filter((item) => item !== option.value) : [...current, option.value])}
                  className={cn(styles.chip, on && styles.choiceOn)}>{on && <Check size={13} strokeWidth={3} aria-hidden="true" />}{option.label}</button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className={styles.legend}>Demonstrations</legend>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_MODELS.map((value) => (
              <button key={value} type="button" aria-pressed={demoShown === value} onClick={() => setDemoChoice(value)} className={cn(styles.choice, demoShown === value && styles.choiceOn)}>
                <span className="block text-sm font-semibold text-fitx-text">{DEMO_MODEL_LABELS[value]} model</span>
              </button>
            ))}
          </div>
          <p className="m-0 text-xs text-fitx-text-secondary">{DEMO_SETUP_NOTE(demosAvailable)}</p>
        </fieldset>
      </div>
    );
  })();

  return (
    <section aria-labelledby="workout-setup-title" className={cn(styles.flow, variant === "inline" && styles.inline)}>
      <header className={styles.head}>
        <div className="min-w-0">
          <p className={styles.eyebrow}>{variant === "inline" ? `Personalise Workouts · ${stepIndex + 1} of ${steps.length}` : `Step ${stepIndex + 1} of ${steps.length}`}</p>
          <h2 id="workout-setup-title" className={styles.title}>{STEP_TITLES[step]}</h2>
        </div>
        {variant === "inline" && onLater && <button type="button" onClick={onLater} className="fitx-button fitx-button-quiet min-h-11 shrink-0 px-3 text-sm">Later</button>}
      </header>
      <div className={styles.progress} aria-hidden="true">
        {steps.map((name, index) => <span key={name} className={cn(styles.bar, index <= stepIndex && styles.barOn)} />)}
      </div>
      {/* The step slides in from the side; the stage clips it so the page never grows sideways mid-slide. */}
      <div className={styles.stage}>
        <div key={step} className={styles.step} data-direction={direction > 0 ? "next" : direction < 0 ? "previous" : "none"}>{body}</div>
      </div>
      {problem && <p role="alert" className="fitx-alert fitx-alert-danger m-0 px-3 py-2 text-sm">{problem}</p>}
      <footer className={styles.foot}>
        {stepIndex > 0
          ? <button type="button" onClick={() => go(-1)} className="fitx-button fitx-button-secondary min-h-11 px-4"><ArrowLeft size={16} aria-hidden="true" />Back</button>
          : <span />}
        {last
          ? <button type="button" onClick={() => { if (!saving) void save(); }} aria-disabled={saving || undefined} className="fitx-button min-h-11 px-5 aria-disabled:opacity-60">{saving ? "Saving…" : "Save setup"}<Check size={16} aria-hidden="true" /></button>
          : <button type="button" onClick={() => go(1)} className="fitx-button min-h-11 px-5">Next<ArrowRight size={16} aria-hidden="true" /></button>}
      </footer>
    </section>
  );
}
