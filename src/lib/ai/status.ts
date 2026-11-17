import "server-only";
import { hasAnyProvider, type AiConfig } from "./config";
import { buildCoachContext, loadContextSources, type CoachContext } from "./context";
import { describeAllergies, describeDiet } from "./diet-rules";
import { PROVIDER_LABELS, canSendMemberData, configuredProviders } from "./registry";
import * as store from "./store";
import type { CoachQuota, CoachThreadSummary, ProviderId } from "./types";

/**
 * Everything the coach page needs to open honestly: whether the coach is paused, set up and
 * available, whether the member has agreed, what would be shared, and the limits over the last 24 hours.
 */

export type CoachState = "paused" | "not_configured" | "not_available" | "consent" | "ready";

export type ProviderNotice = { id: ProviderId; name: string; dataUse: string };

export type CoachStatus = {
  state: CoachState;
  providers: ProviderNotice[];
  consent: { shareData: boolean; consentedAt: string } | null;
  minor: boolean;
  /** The profile has no age: "Use my FITX data" waits until the member adds one (data is shared only from 18). */
  ageMissing: boolean;
  /** What "Use my FITX data" shares, in the member's own terms, for the consent screen. */
  sharedSummary: string[];
  /**
   * false when every connected AI service may let people read prompts (Gemini's free tier) and the owner
   * has not allowed member data there (AI_GEMINI_WITH_MEMBER_DATA): only "Questions only" works then.
   */
  memberDataAvailable: boolean;
  quotas: CoachQuota[];
  threads: CoachThreadSummary[];
};

/** Each provider's data use, from its own terms as checked on 2026-11-16. The owner should re-check them. */
const DATA_USE: Record<ProviderId, string> = {
  gemini: "On Google's free tier, Google may use prompts and replies to improve its products, and people at Google may read them. FITX sends no name, email or account ID.",
  groq: "Groq says it does not keep prompts by default, except short-lived logs for abuse checks (up to 30 days).",
  openrouter: "OpenRouter passes the request to a free model. FITX asks it to use only providers that don't collect prompts.",
  ollama: "Runs on this computer for development. Nothing leaves the machine.",
};
/** Gemini while the owner keeps member data away from it (the default). */
const GEMINI_QUESTIONS_ONLY =
  "Gets only “Questions only” requests, never the summary of your FITX data or FITX's eating-disorder note: on Google's free tier, Google may use prompts and replies to improve its products, and people at Google may read them. FITX sends no name, email or account ID.";

export function providerNotices(config: AiConfig): ProviderNotice[] {
  return configuredProviders(config).map((id) => ({
    id,
    name: PROVIDER_LABELS[id],
    dataUse: id === "gemini" && !config.geminiWithMemberData ? GEMINI_QUESTIONS_ONLY : DATA_USE[id],
  }));
}

/**
 * "What the coach reads" on the consent screen: every part of the summary that "Use my FITX data"
 * sends (buildCoachContext), with the member's own values where they are short. Empty for under-18
 * accounts, whose data is never sent.
 */
export function sharedSummaryLines({ facts, summary }: CoachContext): string[] {
  if (facts.minor) return [];
  // Health details, named as the member entered them (summary.training_setup.limitations).
  const limitations = (summary.training_setup as { limitations?: unknown } | undefined)?.limitations;
  return [
    `Age, sex, height, weight trend and target weight${facts.age ? "" : " (age not set yet)"}`,
    `Goal (${facts.goal.replace(/_/g, " ")}), activity level, experience and training setup (${facts.location}, ${facts.equipment.slice(0, 4).join(", ")}${facts.equipment.length > 4 ? "…" : ""}; level, days a week, session length and split)`,
    `Injuries or limitations: ${typeof limitations === "string" && limitations ? limitations : "none added yet"}`,
    `Diet: ${describeDiet(facts.diet)}; allergies: ${describeAllergies(facts.allergies)}${facts.budget ? `; food budget: ${facts.budget}` : ""}; meals a day, cuisines and foods you avoid`,
    "The last 7 days of food you logged (daily totals and the foods you log most), your daily targets and the names of foods you saved",
    "The last 4 weeks of workouts, your personal records and active goals, and how many workouts and other planner items you have in the next 7 days",
  ];
}

export async function coachStatus(db: store.Db, userId: string, config: AiConfig, now = new Date()): Promise<CoachStatus> {
  const base: CoachStatus = {
    state: "ready",
    providers: providerNotices(config),
    consent: null,
    minor: false,
    ageMissing: false,
    sharedSummary: [],
    memberDataAvailable: canSendMemberData(config),
    quotas: [],
    threads: [],
  };
  if (!config.enabled) return { ...base, state: "paused", ...(await storedCoachData(db, userId, now)) };
  if (!hasAnyProvider(config)) return { ...base, state: "not_configured", ...(await storedCoachData(db, userId, now)) };

  const sources = await loadContextSources(db, userId, now, { full: false });
  const context = buildCoachContext(sources, now);
  const { facts } = context;
  const sharedSummary = sharedSummaryLines(context);
  const age = { minor: facts.minor, ageMissing: facts.age === null };

  try {
    const consent = await store.getConsent(db, userId);
    // Agreeing to "Use my FITX data" does not carry over once the profile says under 18 or loses its age: the
    // member sees the consent screen again, and agreeing there starts the history afresh.
    if (!consent || store.needsNewConsent(consent, facts.adult)) return { ...base, state: "consent", ...age, sharedSummary };
    const [quotas, threads] = await Promise.all([store.quotaStatus(db), store.listThreads(db, userId)]);
    return { ...base, state: "ready", consent: { shareData: consent.shareData, consentedAt: consent.consentedAt }, ...age, sharedSummary, quotas, threads };
  } catch (error) {
    if (error instanceof store.CoachStoreError && error.code === "not_available") return { ...base, state: "not_available", ...age };
    throw error;
  }
}

/**
 * While the coach is paused or not set up, a member who used it keeps their consent and conversations,
 * so the page still offers Coach settings: sharing and "Delete my coach data". Nothing here needs an AI
 * service. Any failure (the coach tables not there yet) just means there is nothing to show.
 */
async function storedCoachData(db: store.Db, userId: string, now: Date): Promise<Pick<CoachStatus, "consent" | "threads" | "minor" | "ageMissing">> {
  try {
    const [consent, threads] = await Promise.all([store.getConsent(db, userId), store.listThreads(db, userId)]);
    if (!consent && !threads.length) return { consent: null, threads: [], minor: false, ageMissing: false };
    const { facts } = buildCoachContext(await loadContextSources(db, userId, now, { full: false }), now);
    return { consent: consent ? { shareData: consent.shareData && facts.adult, consentedAt: consent.consentedAt } : null, threads, minor: facts.minor, ageMissing: facts.age === null };
  } catch {
    return { consent: null, threads: [], minor: false, ageMissing: false };
  }
}
