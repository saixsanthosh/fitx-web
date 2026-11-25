/**
 * Decisions of the Log food sheet, kept out of the page so `node --test` can check them: the amount check shown next
 * to the amount (only while it is wrong), and the start view the sheet opens on and goes back to.
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
