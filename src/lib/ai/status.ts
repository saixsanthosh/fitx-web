import "server-only";
import { hasAnyProvider, type AiConfig } from "./config";
import { buildCoachContext, loadContextSources } from "./context";
import { describeAllergies, describeDiet } from "./diet-rules";
import { PROVIDER_LABELS, configuredProviders } from "./registry";
import * as store from "./store";
import type { CoachQuota, CoachThreadSummary, ProviderId } from "./types";

/**
 * Everything the coach page needs to open honestly: whether the coach is paused, set up and
 * available, whether the member has agreed, what would be shared, and today's limits.
 */

export type CoachState = "paused" | "not_configured" | "not_available" | "consent" | "ready";

export type ProviderNotice = { id: ProviderId; name: string; dataUse: string };

export type CoachStatus = {
  state: CoachState;
  providers: ProviderNotice[];
  consent: { shareData: boolean; consentedAt: string } | null;
  minor: boolean;
  /** What "Use my FITX data" shares, in the member's own terms, for the consent screen. */
  sharedSummary: string[];
  quotas: CoachQuota[];
  threads: CoachThreadSummary[];
};

/** Each provider's data use, from its own terms as checked on 2026-11-16. The owner should re-check them. */
const DATA_USE: Record<ProviderId, string> = {
  gemini: "Google's free tier may use prompts and replies to improve Google's products. FITX sends no name, email or account ID.",
  groq: "Groq says it does not keep prompts by default, except short-lived logs for abuse checks (up to 30 days).",
  openrouter: "OpenRouter passes the request to a free model. FITX asks it to use only providers that don't collect prompts.",
  ollama: "Runs on this computer for development. Nothing leaves the machine.",
};

export function providerNotices(config: AiConfig): ProviderNotice[] {
  return configuredProviders(config).map((id) => ({ id, name: PROVIDER_LABELS[id], dataUse: DATA_USE[id] }));
}

export async function coachStatus(db: store.Db, userId: string, config: AiConfig, now = new Date()): Promise<CoachStatus> {
  const base: CoachStatus = { state: "ready", providers: providerNotices(config), consent: null, minor: false, sharedSummary: [], quotas: [], threads: [] };
  if (!config.enabled) return { ...base, state: "paused" };
  if (!hasAnyProvider(config)) return { ...base, state: "not_configured" };

  const sources = await loadContextSources(db, userId, now, { full: false });
  const { facts } = buildCoachContext(sources, now);
  const sharedSummary = facts.minor
    ? []
    : [
        `Age, sex, height and weight trend${facts.age ? "" : " (age not set yet)"}`,
        `Goal (${facts.goal.replace(/_/g, " ")}), activity level and training setup (${facts.location}, ${facts.equipment.slice(0, 4).join(", ")}${facts.equipment.length > 4 ? "…" : ""})`,
        `Diet: ${describeDiet(facts.diet)}; allergies: ${describeAllergies(facts.allergies)}${facts.budget ? `; food budget: ${facts.budget}` : ""}`,
        "The last 7 days of food you logged (daily totals and the foods you log most)",
        "The last 4 weeks of workouts, your personal records and your active goals",
      ];

  try {
    const consent = await store.getConsent(db, userId);
    if (!consent) return { ...base, state: "consent", minor: facts.minor, sharedSummary };
    const [quotas, threads] = await Promise.all([store.quotaStatus(db), store.listThreads(db, userId)]);
    return { ...base, state: "ready", consent, minor: facts.minor, sharedSummary, quotas, threads };
  } catch (error) {
    if (error instanceof store.CoachStoreError && error.code === "not_available") return { ...base, state: "not_available", minor: facts.minor };
    throw error;
  }
}
