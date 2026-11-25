/**
 * Decisions of the Log food sheet, kept out of the page so `node --test` can check them: the amount check shown next
 * to the amount (only while it is wrong), the start view the sheet opens on and goes back to, and what a barcode
 * lookup that found no usable product says and offers.
 */
import { parseFoodQuery, type ParsedFoodQuery } from "@/lib/domain/food-query";
import type { FoodResult, FoodSearchResponse, SourceStatus } from "@/lib/food/types";

/** The amount's problem once Add to log was pressed, or null: it goes away as soon as the amount is right. */
export function amountProblem(grams: number): string | null {
  return Number.isFinite(grams) && grams >= 1 && grams <= 5000 ? null : "Enter an amount that comes to between 1 and 5,000 grams.";
}

/** What the sheet lists before anything is searched: the staples (with Frequent and Recent above them). */
export interface BrowseList {
  foods: FoodResult[];
  sources: SourceStatus[];
}

/** The sheet's search state. */
export interface SearchView {
  results: FoodResult[];
  sources: SourceStatus[];
  searchMode: FoodSearchResponse["mode"];
  lastSearch: string;
  lastQuery: ParsedFoodQuery;
}

/**
 * The start view: nothing left of an earlier search or barcode lookup (no old results, counts, messages or barcode
 * answer); the sheet lists the browse list instead (listedFoods). Log food opens on it after it was closed, and a
 * search with no food name goes back to it.
 */
export function startView(): SearchView {
  return { results: [], sources: [], searchMode: "browse", lastSearch: "", lastQuery: parseFoodQuery("") };
}

/** The foods the sheet lists: the browse list on the start view, else what the search or lookup found. */
export function listedFoods(view: Pick<SearchView, "searchMode" | "results">, browse: BrowseList | null): FoodResult[] {
  return view.searchMode === "browse" ? browse?.foods ?? [] : view.results;
}

/** What a search box text without a food name gets instead of a search, or null when it names a food. */
export function noSearchReason(typed: ParsedFoodQuery, raw: string): { message: string; kind: "error" | "notice" } | null {
  if (typed.text.length >= 2) return null;
  if (!raw.trim()) return null;
  if (typed.amount !== null || typed.problem) return { kind: "error", message: "Add a food name after the amount, for example “150 g rice”." };
  return { kind: "notice", message: "Search by a food's name, for example “2 roti”." };
}

/** A barcode lookup that found nothing usable, and why: the product is unknown, has no label, or couldn't be checked. */
export interface BarcodeMiss {
  code: string;
  name: string | null;
  kind: "not_found" | "no_label" | "busy" | "unavailable";
}

/** The miss a lookup's answer describes, or null when it found a product or the number itself is wrong. */
export function barcodeMissFor(status: FoodSearchResponse["barcodeStatus"], code: string, productName: string | null | undefined): BarcodeMiss | null {
  if (status === "found" || status === "invalid") return null;
  const kind = status === "no_label" ? "no_label" : status === "rate_limited" ? "busy" : status === "timeout" || status === "unavailable" ? "unavailable" : "not_found";
  return { code, name: productName ?? null, kind };
}

/**
 * What the sheet says about a miss and what it offers: every miss offers "Create a food" with the barcode filled in;
 * one that couldn't be checked also offers "Try again"; only a product Open Food Facts doesn't know (or has no label
 * for) offers adding it there.
 */
export function barcodeMissText(miss: BarcodeMiss): { text: string; retry: boolean; addToOpenFoodFacts: boolean } {
  if (miss.kind === "busy") {
    return { text: `Open Food Facts is busy right now (it limits how often FITX can ask), so ${miss.code} couldn't be checked. Try again in a minute, or add the product yourself.`, retry: true, addToOpenFoodFacts: false };
  }
  if (miss.kind === "unavailable") {
    return { text: `Open Food Facts didn't answer, so ${miss.code} couldn't be checked. Try again shortly, or add the product yourself.`, retry: true, addToOpenFoodFacts: false };
  }
  const text = miss.kind === "no_label"
    ? `Open Food Facts knows ${miss.code}${miss.name ? ` (“${miss.name}”)` : ""} but has no nutrition label for it. Nothing was guessed.`
    : `No product with barcode ${miss.code} on Open Food Facts. Nothing was guessed.`;
  return { text, retry: false, addToOpenFoodFacts: true };
}
