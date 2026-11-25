"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Check, ChevronLeft, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { NUTRITION_MEDIA } from "@/data/nutrition-media";
import {
  ALLERGY_OPTIONS, DIET_OPTIONS, FOOD_RULE_OPTIONS, FOOD_SOURCE_OPTIONS, NUTRITION_FOCUS_OPTIONS,
  type AllergyKey, type DietType, type FoodRule,
} from "@/lib/domain/profile-options";
import { SETUP_DIETS, SETUP_STEPS, addTag, firstSetupProblem, setupProblem, type NutritionSetupAnswers } from "@/lib/food/setup";
import styles from "./NutritionSetup.module.css";

const DIET_IMAGES: Partial<Record<DietType, keyof typeof NUTRITION_MEDIA>> = {
  vegetarian: "diet-vegetarian",
  eggetarian: "diet-eggetarian",
  non_vegetarian: "diet-non-vegetarian",
  vegan: "diet-vegan",
};
const MEALS = [2, 3, 4, 5] as const;
const label = <V extends string>(options: ReadonlyArray<{ value: V; label: string }>, value: V) => options.find((option) => option.value === value)?.label ?? value;

export type SetupMode = "first" | "edit";

/**
 * The Nutrition first-time setup: how you eat, anything to avoid, your meals and your nutrition goal, in four
 * short steps of cards and chips. Only the diet is required. "Later" (first visit only) closes it for a few days on
 * this device; once saved it is never asked again and is edited from "Food preferences".
 */
export function NutritionSetup({ open, mode, initial, busy, error, onSave, onLater, onClose }: {
  open: boolean;
  mode: SetupMode;
  initial: NutritionSetupAnswers;
  busy: boolean;
  error: string;
  onSave: (answers: NutritionSetupAnswers) => void;
  onLater: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={mode === "first" ? onLater : onClose} title={mode === "first" ? "Set up Nutrition" : "Food preferences"}
      description={mode === "first" ? "Four quick questions so food search and targets fit you." : undefined} side="center">
      {/* Remounted per opening, so every opening starts from what is saved. */}
      {open ? <SetupSteps key={JSON.stringify(initial)} mode={mode} initial={initial} busy={busy} error={error} onSave={onSave} onLater={onLater} onClose={onClose} /> : null}
    </Sheet>
  );
}

function SetupSteps({ mode, initial, busy, error, onSave, onLater, onClose }: {
  mode: SetupMode;
  initial: NutritionSetupAnswers;
  busy: boolean;
  error: string;
  onSave: (answers: NutritionSetupAnswers) => void;
  onLater: () => void;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState(initial);
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState("");
  const [allergyDraft, setAllergyDraft] = useState("");
  const [dislikeDraft, setDislikeDraft] = useState("");
  const current = SETUP_STEPS[step];
  const last = step === SETUP_STEPS.length - 1;
  const change = (patch: Partial<NutritionSetupAnswers>) => { setAnswers((value) => ({ ...value, ...patch })); setProblem(""); };
  const diets = initial.diet && !SETUP_DIETS.includes(initial.diet) ? [...SETUP_DIETS, initial.diet] : SETUP_DIETS;

  function toggle<V extends string>(list: readonly V[], value: V): V[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function withDrafts(): NutritionSetupAnswers {
    return {
      ...answers,
      customAllergies: allergyDraft.trim() ? addTag(answers.customAllergies, allergyDraft, "allergy") : answers.customAllergies,
      dislikes: dislikeDraft.trim() ? addTag(answers.dislikes, dislikeDraft, "dislike") : answers.dislikes,
    };
  }

  function next(event: FormEvent) {
    event.preventDefault();
    // Saving: a second press does nothing, and the button keeps the focus (it is never disabled under it).
    if (busy) return;
    const stepProblem = setupProblem(current.id, answers);
    if (stepProblem) { setProblem(stepProblem); return; }
    if (!last) { setStep(step + 1); return; }
    const final = withDrafts();
    const any = firstSetupProblem(final);
    if (any) { setStep(SETUP_STEPS.findIndex((item) => item.id === any.step)); setProblem(any.message); return; }
    onSave(final);
  }

  return (
    <form className={styles.form} onSubmit={next} aria-label={current.title}>
      <ol className={styles.progress} aria-label={`Step ${step + 1} of ${SETUP_STEPS.length}`}>
        {SETUP_STEPS.map((item, index) => <li key={item.id} data-state={index < step ? "done" : index === step ? "current" : "next"} aria-current={index === step ? "step" : undefined}><span className="sr-only">{item.title}</span></li>)}
      </ol>
      <h3 className={styles.title}>{current.title}</h3>

      <div className={styles.body} key={current.id}>
        {current.id === "diet" ? (
          <fieldset className={styles.dietGrid}>
            <legend className="sr-only">Diet</legend>
            {diets.map((diet) => {
              const image = DIET_IMAGES[diet] ? NUTRITION_MEDIA[DIET_IMAGES[diet]!] : null;
              const option = DIET_OPTIONS.find((item) => item.value === diet)!;
              return (
                <label key={diet} className={styles.dietCard} data-checked={answers.diet === diet ? "" : undefined}>
                  <input type="radio" name="diet" value={diet} checked={answers.diet === diet} onChange={() => change({ diet })} className="sr-only" />
                  {image ? <Image src={image.src} alt="" width={image.width} height={image.height} placeholder="blur" blurDataURL={image.blurDataURL} sizes="(min-width: 768px) 180px, 45vw" className={styles.dietImage} /> : <span className={styles.dietImage} aria-hidden="true" />}
                  <span className={styles.dietText}><strong>{option.label}</strong><small>{option.hint}</small></span>
                  <span className={styles.tick} aria-hidden="true"><Check size={14} /></span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {current.id === "avoid" ? (
          <>
            <fieldset className={styles.group}>
              <legend>Allergies</legend>
              <div className={styles.chips}>
                {ALLERGY_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.chip}>
                    <input type="checkbox" checked={answers.allergies.includes(option.value)} onChange={() => change({ allergies: toggle<AllergyKey>(answers.allergies, option.value) })} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <TagInput label="Another allergy" values={answers.customAllergies} draft={allergyDraft} onDraft={setAllergyDraft}
                onAdd={() => { change({ customAllergies: addTag(answers.customAllergies, allergyDraft, "allergy") }); setAllergyDraft(""); }}
                onRemove={(value) => change({ customAllergies: answers.customAllergies.filter((item) => item !== value) })} />
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Food rules</legend>
              <div className={styles.chips}>
                {FOOD_RULE_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.chip}>
                    <input type="checkbox" checked={answers.foodRules.includes(option.value)} onChange={() => change({ foodRules: toggle<FoodRule>(answers.foodRules, option.value) })} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Foods you&apos;d rather not see</legend>
              <TagInput label="A food you dislike" values={answers.dislikes} draft={dislikeDraft} onDraft={setDislikeDraft}
                onAdd={() => { change({ dislikes: addTag(answers.dislikes, dislikeDraft, "dislike") }); setDislikeDraft(""); }}
                onRemove={(value) => change({ dislikes: answers.dislikes.filter((item) => item !== value) })} />
            </fieldset>
          </>
        ) : null}

        {current.id === "routine" ? (
          <>
            <fieldset className={styles.group}>
              <legend>Meals a day</legend>
              <div className={styles.meals}>
                {MEALS.map((count) => (
                  <label key={count} className={styles.mealChoice}>
                    <input type="radio" name="meals" checked={answers.meals === count} onChange={() => change({ meals: count })} className="sr-only" />
                    <span>{count === 5 ? "5+" : count}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Where your food comes from</legend>
              <div className={styles.chips}>
                {FOOD_SOURCE_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.chip}>
                    <input type="radio" name="source" checked={answers.foodSource === option.value} onChange={() => change({ foodSource: option.value })} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}

        {current.id === "goal" ? (
          <fieldset className={styles.group}>
            <legend className="sr-only">Nutrition goal</legend>
            <div className={styles.goals}>
              {NUTRITION_FOCUS_OPTIONS.map((option) => (
                <label key={option.value} className={styles.goal}>
                  <input type="radio" name="focus" checked={answers.nutritionFocus === option.value} onChange={() => change({ nutritionFocus: option.value })} className="sr-only" />
                  <span>{option.label}</span>
                  <i aria-hidden="true"><Check size={14} /></i>
                </label>
              ))}
            </div>
            {answers.diet ? <p className={styles.summary}>{label(DIET_OPTIONS, answers.diet)} · {answers.meals === 5 ? "5+" : answers.meals} meals a day{answers.allergies.length + answers.customAllergies.length ? ` · avoids ${answers.allergies.length + answers.customAllergies.length}` : ""}</p> : null}
          </fieldset>
        ) : null}
      </div>

      {problem || error ? <p role="alert" className="fitx-alert fitx-alert-danger">{problem || error}</p> : null}

      <div className={styles.actions}>
        {step > 0
          ? <button type="button" className={styles.back} onClick={() => { setStep(step - 1); setProblem(""); }}><ChevronLeft size={16} aria-hidden="true" />Back</button>
          : mode === "first"
            ? <button type="button" className={styles.back} onClick={onLater}>Later</button>
            : <button type="button" className={styles.back} onClick={onClose}>Cancel</button>}
        <button type="submit" className="fitx-button" aria-disabled={busy || undefined}>{last ? (busy ? "Saving…" : "Save") : "Next"}</button>
      </div>
    </form>
  );
}

function TagInput({ label: name, values, draft, onDraft, onAdd, onRemove }: {
  label: string;
  values: readonly string[];
  draft: string;
  onDraft: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className={styles.tags}>
      {values.length ? (
        <ul className={styles.tagList}>
          {values.map((value) => (
            <li key={value}>{value}<button type="button" onClick={() => onRemove(value)} aria-label={`Remove ${value}`}><X size={13} aria-hidden="true" /></button></li>
          ))}
        </ul>
      ) : null}
      <div className={styles.tagRow}>
        <input className="fitx-field" value={draft} onChange={(event) => onDraft(event.target.value)} aria-label={name} placeholder={name}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (draft.trim()) onAdd(); } }} />
        <button type="button" className="fitx-button fitx-button-secondary" disabled={!draft.trim()} onClick={onAdd}>Add</button>
      </div>
    </div>
  );
}
