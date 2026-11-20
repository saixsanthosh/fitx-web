import type { AiConfig } from "./config";

/**
 * The privacy page's sentences on which coach requests Google's Gemini API gets. They follow the router
 * (candidatesFor in registry.ts, with the personalData flag coach.ts sets): requests that carry the member's
 * FITX summary or the eating-disorder care note skip Gemini's free tier, unless the owner sets
 * AI_GEMINI_WITH_MEMBER_DATA. An Ollama server (OLLAMA_BASE_URL) is tried last for every request, those
 * included, so the sentence names it whenever one is set. The page is rendered with the deployment's
 * environment, so the two agree.
 */
export function geminiRouting(config: Pick<AiConfig, "geminiWithMemberData" | "ollama">): string {
  const ollama = config.ollama ? ", or to the Ollama server run by FITX’s owner" : "";
  return config.geminiWithMemberData
    ? `Google’s Gemini API may get any coach request: chats with your summary or that eating-disorder note, meal and workout plans and food swaps may go to Gemini, Groq or OpenRouter${ollama}.`
    : `Google’s Gemini API only gets requests that carry neither a summary of your FITX data nor that eating-disorder note: those with “Use my FITX data” off and those from accounts of people under 18, outside those 30 days. Chats with your summary or that note, meal and workout plans and food swaps go to Groq or OpenRouter${ollama}.`;
}
