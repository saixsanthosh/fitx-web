"use client";

import { useActionState, useId, useRef } from "react";
import { addModerator } from "@/app/(control)/explore/actions";
import { keepTyped } from "@/components/content/keep-typed";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import styles from "./explore.module.css";

/**
 * Add moderator, by Explore username. A refusal (no profile has that username, the member has not joined or is not an
 * adult, a failure) comes back beside the button with the username kept as typed (BUGS.md 63), marked and focused when
 * the refusal is about it; an appointment reloads the page with "Moderator added." at the top.
 */
export function AddModeratorForm({ communityId }: { communityId: string }) {
  const [state, action, pending] = useActionState(addModerator, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className="stack-form">
      <input type="hidden" name="communityId" value={communityId} />
      <div className={styles.inline}>
        <label>Explore username<input name="username" required autoComplete="off" placeholder="name.surname" {...fieldAria(state, "username", resultId)} /></label>
        <BusyButton pending={pending} className="quiet-button" pendingLabel="Adding…">Add moderator</BusyButton>
      </div>
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}
