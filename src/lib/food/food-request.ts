/**
 * Asking FITX's food search (/api/foods/search) from Log food, and what the member reads when that fails (fix round
 * 3c: a request that failed showed the browser's own words, "Failed to fetch", or a parser's). A request that never
 * reached FITX (offline, a dropped connection: fetch itself throws) asks the member to check their connection; an
 * answer that isn't FITX's own (an error page, a reply cut off, so no JSON) says it couldn't be done just now; FITX's
 * own refusal ("You’re searching quickly. Try again in 12 s.") is shown as it is. Never a browser's or parser's message.
 * Pure apart from the request itself, which a test passes in, so `node --test` can check it.
 */
import type { FoodSearchResponse } from "@/lib/food/types";

/** What was asked: a search by name (or of packaged products), the list of common foods, or one barcode. */
export type FoodRequest = { kind: "search" } | { kind: "browse" } | { kind: "barcode"; code: string };

/** FITX's answer, or the sentence to show instead. */
export type FoodAnswer = { ok: true; data: FoodSearchResponse } | { ok: false; message: string };

/** The request never reached FITX: offline, or the connection dropped. */
export function unreachedText(request: FoodRequest): string {
  if (request.kind === "barcode") return `FITX couldn't be reached, so ${request.code} couldn't be checked. Check your connection and try again.`;
  if (request.kind === "browse") return "FITX couldn't be reached, so the common foods didn't load. Check your connection and try again.";
  return "FITX couldn't be reached, so the search didn't run. Check your connection and try again.";
}

/** FITX was reached, but what came back isn't its answer (an error page, a reply cut off). */
export function unansweredText(request: FoodRequest): string {
  if (request.kind === "barcode") return `The barcode ${request.code} couldn't be checked just now. Try again in a moment.`;
  if (request.kind === "browse") return "The common foods couldn't be loaded just now. Try again in a moment.";
  return "Food search isn't working just now. Try again in a moment.";
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Asks the food search; never throws, and never hands on a browser's or parser's own message. */
export async function askFoodSearch(url: string, request: FoodRequest, init?: RequestInit, fetcher: Fetcher = (input, options) => fetch(input, options)): Promise<FoodAnswer> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    return { ok: false, message: unreachedText(request) };
  }
  let data: FoodSearchResponse | null = null;
  try {
    const body: unknown = await response.json();
    data = body && typeof body === "object" && !Array.isArray(body) ? (body as FoodSearchResponse) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // A refusal FITX words itself (signed out, the session check, the search limit) is said as it is.
    const own = typeof data?.error === "string" ? data.error.trim() : "";
    return { ok: false, message: own || unansweredText(request) };
  }
  return data ? { ok: true, data } : { ok: false, message: unansweredText(request) };
}
