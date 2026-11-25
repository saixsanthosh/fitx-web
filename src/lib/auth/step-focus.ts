/**
 * Where keyboard focus goes when a sign-in or sign-up page changes step (bug 81). The code step takes focus itself when
 * it opens (its code field). Coming back from it ("Change email"), the button pressed is gone with the step, so focus
 * goes to the email field the member came back to change; it never fell to the page body again. Nothing moves on the
 * first render or when the step stays the same. Pure, so node:test covers it.
 */
export type SignInStep = "email" | "code" | "sent";

export function focusAfterStep(previous: SignInStep | null, current: SignInStep): "email" | null {
  return previous === "code" && current === "email" ? "email" : null;
}
