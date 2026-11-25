"use client";

import { useActionState, useId, useRef } from "react";
import { saveChallenge, saveTemplate } from "@/app/(control)/explore/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE, type FormState } from "@/lib/content/form";
import { CHALLENGE_METRICS, CHALLENGE_SPORTS, METRIC_LABELS, SPORT_LABELS, type ChallengeKind, type ChallengeMetric } from "@/lib/explore-rules";

// The challenge and template forms. A refusal comes back from the server beside the Save button and every field keeps
// what was typed (keepTyped: React would otherwise reset the form after its action); the field the refusal is about is
// marked and focused. A save reloads the page with the result at the top.

type Common = { kind: ChallengeKind; title: string; metric: ChallengeMetric; sport: string | null; target: number | null };
export type ChallengeDefaults = Common & { id: string; day: string; communityId: string | null };
export type TemplateDefaults = Common & { id: string; active: boolean };

/** The fields a challenge and a template share. */
function CommonFields({ row, state, resultId }: { row?: Common; state: FormState; resultId: string }) {
  const aria = (name: string) => fieldAria(state, name, resultId);
  return (
    <>
      <label>Title<input name="title" required maxLength={80} defaultValue={row?.title ?? ""} placeholder="Five workouts this week" {...aria("title")} /></label>
      <div className="form-row">
        <label>Runs<select name="kind" defaultValue={row?.kind ?? "weekly"} {...aria("kind")}><option value="weekly">Weekly (Monday to Monday)</option><option value="monthly">Monthly (1st to 1st)</option></select></label>
        <label>Counts<select name="metric" defaultValue={row?.metric ?? "workouts"} {...aria("metric")}>{CHALLENGE_METRICS.map((metric) => <option key={metric} value={metric}>{METRIC_LABELS[metric].label}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Sport (distance and active minutes only)<select name="sport" defaultValue={row?.sport ?? ""} {...aria("sport")}><option value="">Any</option>{CHALLENGE_SPORTS.map((sport) => <option key={sport} value={sport}>{SPORT_LABELS[sport]}</option>)}</select></label>
        <label>Target (optional)<input name="target" inputMode="decimal" defaultValue={row?.target ?? ""} placeholder="5" {...aria("target")} /></label>
      </div>
    </>
  );
}

/** A new challenge, or an open one's edit form. `day` is today in India time, from the server. */
export function ChallengeForm({ row, day, communities }: { row?: ChallengeDefaults; day: string; communities: ReadonlyArray<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(saveChallenge, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="stack-form">
      {row && <input type="hidden" name="id" value={row.id} />}
      <CommonFields row={row} state={state} resultId={resultId} />
      <div className="form-row">
        <label>In the week or month of<input type="date" name="day" required defaultValue={row?.day ?? day} {...fieldAria(state, "day", resultId)} /></label>
        <label>Community (optional)<select name="community" defaultValue={row?.communityId ?? ""} {...fieldAria(state, "community", resultId)}><option value="">All of Explore</option>{communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <BusyButton pending={pending} className="primary-button" pendingLabel="Saving…">Save challenge</BusyButton>
      <FormResult id={resultId} state={state} formRef={formRef} />
    </form>
  );
}

/** A new template, or a template's edit form. The "open a new challenge" box keeps its tick after a refusal too. */
export function TemplateForm({ row }: { row?: TemplateDefaults }) {
  const [state, action, pending] = useActionState(saveTemplate, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="stack-form">
      {row && <input type="hidden" name="id" value={row.id} />}
      <CommonFields row={row} state={state} resultId={resultId} />
      <label className="check-label"><input type="checkbox" name="active" defaultChecked={row?.active ?? true} />Open a new challenge from it every week or month</label>
      <BusyButton pending={pending} className="quiet-button" pendingLabel="Saving…">Save template</BusyButton>
      <FormResult id={resultId} state={state} formRef={formRef} />
    </form>
  );
}
