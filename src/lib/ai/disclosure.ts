import type { AiConfig } from "./config";

/**
 * The privacy page's sentences on where coach requests go. They follow the router (candidatesFor in registry.ts, with
 * the personalData flag coach.ts sets): requests that carry the member's FITX summary or the eating-disorder care note
 * skip the services whose free tier may read prompts (Gemini, Cerebras, Mistral), unless the owner opts in for that
 * service. An Ollama server (OLLAMA_BASE_URL) is tried last for every request, those included, so the sentence names it
 * whenever one is set. The page is rendered with the deployment's environment, so the two agree.
 */

type RoutingConfig = Pick<AiConfig, "geminiWithMemberData" | "ollama"> & Partial<Pick<AiConfig, "memberDataOptIn">>;

/** Every outside AI service the coach can use, as the privacy page names them. */
export const COACH_SERVICES = ["Google (the Gemini API)", "Groq", "Cloudflare Workers AI", "Cerebras", "Mistral AI", "OpenRouter"] as const;

const list = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);
const and = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function geminiRouting(config: RoutingConfig): string {
  const ollama = config.ollama ? ", or to the Ollama server run by FITX’s owner" : "";
  const cautious: Array<[string, boolean]> = [
    ["Google’s Gemini API", config.geminiWithMemberData],
    ["Cerebras", Boolean(config.memberDataOptIn?.cerebras)],
    ["Mistral AI", Boolean(config.memberDataOptIn?.mistral)],
  ];
  const allowed = cautious.filter(([, on]) => on).map(([name]) => name.replace("Google’s Gemini API", "Gemini"));
  const questionsOnly = cautious.filter(([, on]) => !on).map(([name]) => name);
  const full = list([...allowed, "Groq", "Cloudflare Workers AI", "OpenRouter"]);
  if (!questionsOnly.length) {
    return `Any coach request may go to any of these services: chats with your summary or that eating-disorder note, meal and workout plans and food swaps may go to ${full}${ollama}.`;
  }
  const verb = questionsOnly.length === 1 ? "only gets" : "only get";
  return `${and(questionsOnly)} ${verb} requests that carry neither a summary of your FITX data nor that eating-disorder note: those with “Use my FITX data” off and those from accounts of people under 18, outside those 30 days. Chats with your summary or that note, meal and workout plans and food swaps go to ${full}${ollama}.`;
}

/** The services sentence for the privacy page's AI coach section (replaces its hand-written list at integration). */
export function coachServicesSentence(): string {
  return `Your questions are answered by outside AI services: ${list(COACH_SERVICES)}, which passes the request to a free AI model. FITX uses only the ones its owner has connected, and moves to the next one when a service is busy.`;
}

/**
 * Voice conversation (CoachVoice): the browser's own speech recognition turns speech into text, and FITX gets only that
 * text. Where the audio goes depends on the browser, so the sentence says so instead of promising on-device processing.
 */
export const VOICE_PRIVACY =
  "Voice uses your browser’s own speech recognition while you hold the talk button. Your browser may send the recording to its maker’s speech service (Google in Chrome, Microsoft in Edge, Apple in Safari) to turn it into text; FITX receives only the text, which is sent like a typed message. Replies are read aloud with a voice on your device. FITX never records or stores audio.";
