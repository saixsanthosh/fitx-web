// Small decisions for Admin's forms that save through useActionState, kept apart from the components so tests can load
// them (tests/explore-forms.test.mjs). Type imports only.
import type { FormState } from "@/lib/content/form";

/** aria-invalid and aria-describedby (the result line) for the field the last refusal named, by its input's name. */
export function fieldAria(state: FormState, name: string, resultId: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return state.status === "error" && state.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": resultId } : {};
}
