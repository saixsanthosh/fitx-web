import "server-only";
import { hasAnyProvider, type AiConfig } from "./config";
import { buildCoachContext, loadContextSources, type CoachContext, type ContextSources } from "./context";
import { describeAllergies, describeDiet } from "./diet-rules";
import { buildQuickPrompts, loadPromptSignals, type QuickPrompt } from "./quick-prompts";
import { canSendMemberData, configuredProviders, consentCovers, memberDataAllowed, providerLabel } from "./registry";
import { CARE_DAYS } from "./safety";
import * as store from "./store";
import type { CoachQuota, CoachThreadSummary, ProviderId } from "./types";

/**
 * Everything the coach page needs to open honestly: whether the coach is paused, set up and
 * available, whether the member has agreed, what would be shared, and the limits over the last 24 hours.
 */

export type CoachState = "paused" | "not_configured" | "not_available" | "consent" | "ready";

/** A connected AI service as the member sees it: a name and its data use. Never a key, a URL or a model setting. */
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
  /** Starting points written from the member's own data; empty unless "Use my FITX data" is on (see quick-prompts.ts). */
  quickPrompts: QuickPrompt[];
};

/** Each provider's data use, from its own terms as checked on 2026-11-16. The owner should re-check them. */
const DATA_USE: Record<ProviderId, string> = {
  gemini: "On Google's free tier, Google may use prompts and replies to improve its products, and people at Google may read them. FITX sends no name, email or account ID.",
  groq: "Groq says it does not keep prompts by default, except short-lived logs for abuse checks (up to 30 days).",
  cloudflare: "Cloudflare says it does not use prompts or replies sent to Workers AI to train AI models. FITX sends no name, email or account ID.",
  cerebras: "FITX sends no name, email or account ID. Check Cerebras's own terms for how its free tier keeps prompts.",
  mistral: "On Mistral's free plan, prompts and replies may be used to train its models unless the FITX account opts out. FITX sends no name, email or account ID.",
  openrouter: "OpenRouter passes the request to a free model. FITX asks it to use only providers that don't collect prompts.",
  ollama: "Runs on this computer for development. Nothing leaves the machine.",
};
/** Ollama on an https server the owner runs (OLLAMA_BASE_URL). */
const OLLAMA_REMOTE = "Runs on a server the FITX owner runs, not an outside AI company. FITX sends no name, email or account ID.";
/** Gemini while the owner keeps member data away from it (the default). */
const GEMINI_QUESTIONS_ONLY =
  "Gets only “Questions only” requests, never the summary of your FITX data or FITX's eating-disorder note: on Google's free tier, Google may use prompts and replies to improve its products, and people at Google may read them. FITX sends no name, email or account ID.";

/**
 * A service added after the member agreed (registry.ts FIRST_CONSENT_VERSION): their consent screen did not name it, so
 * it gets none of their FITX data. Agreeing again (withdraw, then agree) would include it.
 */
const ADDED_AFTER_CONSENT = (terms: string) =>
  `Added after you agreed to how the coach uses your data, so it gets only “Questions only” requests, never the summary of your FITX data. ${terms}`;

/** Cerebras or Mistral while the owner keeps member data away from them (the default). */
const QUESTIONS_ONLY = (name: string) =>
  `Gets only “Questions only” requests, never the summary of your FITX data or FITX's eating-disorder note, because its free plan may keep or learn from prompts. ${name === "Mistral AI" ? "" : "FITX could not confirm its free tier's terms. "}FITX sends no name, email or account ID.`;

export function providerNotices(config: AiConfig, consentVersion?: number): ProviderNotice[] {
  return configuredProviders(config).map((id) => {
    const name = providerLabel(id, config);
    const questionsOnly = !memberDataAllowed(id, config);
    const dataUse =
      id === "gemini" && questionsOnly ? GEMINI_QUESTIONS_ONLY
        : questionsOnly ? QUESTIONS_ONLY(name)
          : consentVersion !== undefined && !consentCovers(id, consentVersion) ? ADDED_AFTER_CONSENT(DATA_USE[id])
          : id === "ollama" && config.ollama?.kind === "remote" ? OLLAMA_REMOTE
            : DATA_USE[id];
    return { id, name, dataUse };
  });
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
    `Diet: ${describeDiet(facts.diet)}; allergies: ${describeAllergies(facts.allergies)}${facts.budget ? `; food budget: ${facts.budget}` : ""}; meals a day, ${facts.foodHabitsShared ? "where your meals come from, your nutrition goal, " : ""}cuisines and foods you avoid`,
    "The last 7 days of food you logged (daily totals and the foods you log most), your daily targets and the names of foods you saved",
    "The last 4 weeks of workouts, your personal records and active goals, and how many workouts and other planner items you have in the next 7 days",
    "Your walks, runs, rides and other activities of the last 4 weeks: how many, distance, moving time and climb per sport (never your routes or locations)",
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
    quickPrompts: [],
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
    // Services added after this consent was given get none of the member's data (registry.ts), and Coach settings says so.
    const forConsent = { providers: providerNotices(config, consent.version), memberDataAvailable: canSendMemberData(config, consent.version) };
    const sharing = consent.shareData && facts.adult && forConsent.memberDataAvailable;
    const [quotas, threads, quickPrompts] = await Promise.all([
      store.quotaStatus(db),
      store.listThreads(db, userId),
      sharing ? personalPrompts(db, userId, sources, now) : Promise.resolve([]),
    ]);
    return { ...base, state: "ready", consent: { shareData: consent.shareData, consentedAt: consent.consentedAt }, ...age, sharedSummary, quotas, threads, quickPrompts, ...forConsent };
  } catch (error) {
    if (error instanceof store.CoachStoreError && error.code === "not_available") return { ...base, state: "not_available", ...age };
    throw error;
  }
}

/**
 * The quick prompts for a member who shares their data. The targets use the latest weigh-in, as Home and
 * Nutrition do. For 30 days after FITX's eating-disorder note they leave out food, calories and weight, as the
 * coach does (runCoachTurn). Any failure, that check's included, just means no personal prompts: the page then
 * offers general ones.
 */
async function personalPrompts(db: store.Db, userId: string, sources: ContextSources, now: Date): Promise<QuickPrompt[]> {
  try {
    const careMode = await store.hasRecentSafetyNote(db, userId, "eating_disorder", CARE_DAYS);
    const { data } = await db.from("body_metrics").select("date, weight").eq("user_id", userId).not("weight", "is", null)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1);
    const weighIns = Array.isArray(data) ? (data as ContextSources["weighIns"]) : [];
    const context = buildCoachContext({ ...sources, weighIns }, now);
    return buildQuickPrompts(context, await loadPromptSignals(db, userId, context, now), { plansAllowed: true, careMode });
  } catch {
    return [];
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
