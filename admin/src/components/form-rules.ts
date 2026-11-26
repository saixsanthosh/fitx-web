// Small decisions for Admin's forms that save through useActionState, kept apart from the components so tests can load
// them (tests/explore-forms.test.mjs). Type imports only.
import type { FormState } from "@/lib/content/form";

/**
 * What a live region that answers a submission shows: nothing while the next answer is on its way. Each answer is then
 * written in afresh and read out, also when it is the same as the last one (a second "Saved.", the same refusal again
 * while its field still has focus, where moving focus there reads nothing). Without the gap the text never changes, so
 * a screen reader hears nothing.
 */
export function answerText(message: string | null | undefined, pending: boolean): string {
  return pending || !message ? "" : message;
}

/** The words of a form's result line (FormResult, FormFooter): none before the first answer or while one is on its way. */
export function resultText(state: FormState, pending: boolean, fallback: { saved?: string; error?: string } = {}): string {
  if (state.status === "idle") return "";
  return answerText(state.message ?? (state.status === "saved" ? fallback.saved : fallback.error), pending);
}

/** aria-invalid and aria-describedby (the result line) for the field the last refusal named, by its input's name. */
export function fieldAria(state: FormState, name: string, resultId: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return state.status === "error" && state.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": resultId } : {};
}

/**
 * Empties a form's password fields. A refused form keeps what was typed (keepTyped), but never a password: after a
 * refusal it is typed again, as on the sign-in page. Only fields of type password are touched. True when one was emptied.
 */
export function clearPasswords(form: { querySelectorAll(selector: string): ArrayLike<unknown> } | null | undefined): boolean {
  let cleared = false;
  for (const element of Array.from(form?.querySelectorAll('input[type="password"]') ?? [])) {
    const field = element as { value?: unknown };
    if (typeof field.value === "string" && field.value !== "") {
      field.value = "";
      cleared = true;
    }
  }
  return cleared;
}

/**
 * A form's data with the pressed button's name and value, as the browser sends them on a submit: `new FormData(form)`
 * leaves the button out, and a form with one button per action (Explore's moderation) reads which one it was. Nothing
 * is added for a button without a name, or when no button was pressed.
 */
export function withSubmitter(data: FormData, submitter: unknown): FormData {
  const button = submitter as { name?: unknown; value?: unknown } | null | undefined;
  if (button && typeof button.name === "string" && button.name && typeof button.value === "string") data.append(button.name, button.value);
  return data;
}
