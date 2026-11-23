/**
 * The floating AI Coach contract (BRIEF 3.2). brand-nav's launcher dispatches COACH_OPEN_EVENT on `window`, cancelable;
 * CoachPanelHost calls preventDefault() and opens the panel. When nothing handles it (no host mounted, or the host is
 * on /ai-coach), the dispatcher navigates to /ai-coach instead. The panel dispatches COACH_CLOSE_EVENT once it has
 * closed, so the control that opened it can take focus back.
 */

export const COACH_OPEN_EVENT = "fitx:coach-open";
export const COACH_CLOSE_EVENT = "fitx:coach-close";

/** source: who asked ("launcher", "activity-detail", …). prompt: text put in the message box, never sent on its own. */
export type CoachOpenDetail = { source: string; prompt?: string };

/** Longest prompt another page may put in the box; the coach's own limit is checked again on send. */
export const MAX_OPEN_PROMPT = 600;

/**
 * Asks the mounted panel to open. Returns true when a host took it; false means the caller should navigate to
 * /ai-coach itself (openCoachOrNavigate does that).
 */
export function requestCoachOpen(detail: CoachOpenDetail, target: Pick<Window, "dispatchEvent"> = window): boolean {
  const event = new CustomEvent<CoachOpenDetail>(COACH_OPEN_EVENT, { cancelable: true, detail });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** The prompt from an open event, trimmed and capped, or undefined. */
export function openPrompt(detail: unknown): string | undefined {
  const prompt = detail && typeof detail === "object" ? (detail as { prompt?: unknown }).prompt : undefined;
  if (typeof prompt !== "string") return undefined;
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_OPEN_PROMPT);
  return clean || undefined;
}
