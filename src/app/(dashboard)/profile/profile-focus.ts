/**
 * Where keyboard focus goes on Profile when the control it was on gives way (D5).
 *
 * Profile's busy buttons stay on the page and focusable while they work (aria-disabled, not disabled: Chrome drops
 * focus to the page from a disabled button), so focus moves only when a button itself is gone. That happens when Try
 * again brings the profile back, or finds the session has ended: the alert it sat in is replaced.
 *
 * No React here, so node tests cover it (tests/profile/busy-buttons.test.ts).
 */

/** Profile's page states (ProfileView). */
export type ProfileStatus = "loading" | "ready" | "signed_out" | "unavailable" | "error";

/**
 * What takes focus once Try again has finished, if focus was lost: "heading", the profile's heading (the member's name)
 * once the profile has loaded; "action", the alert's own control (Sign in for an ended session, or Try again when the
 * check went through loading and failed again); "wait" while Profile is still loading, so its next state decides;
 * "none" when the alert offers nothing to press.
 */
export type RetryFocus = "heading" | "action" | "wait" | "none";

export function focusAfterRetry(status: ProfileStatus): RetryFocus {
  if (status === "loading") return "wait";
  if (status === "ready") return "heading";
  return status === "unavailable" ? "none" : "action";
}
