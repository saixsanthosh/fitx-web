// Small decisions for Admin's forms that save through useActionState, kept apart from the components so tests can load
// them (tests/explore-forms.test.mjs). Type imports only.
import type { FormState } from "@/lib/content/form";

/** aria-invalid and aria-describedby (the result line) for the field the last refusal named, by its input's name. */
export function fieldAria(state: FormState, name: string, resultId: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return state.status === "error" && state.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": resultId } : {};
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
