/**
 * Decisions of the Log food sheet, kept out of the page so `node --test` can check them: the amount check shown next
 * to the amount (only while it is wrong), the start view the sheet opens on and goes back to, what a barcode lookup
 * that found no usable product says and offers, and where the focus goes when the panel and the list swap places.
 */
import { parseFoodQuery, type FoodPortion, type ParsedFoodQuery } from "@/lib/domain/food-query";
import type { FoodResult, FoodSearchResponse, SourceStatus } from "@/lib/food/types";

/** The amount's problem once Add to log was pressed, or null: it goes away as soon as the amount is right. */
export function amountProblem(grams: number): string | null {
  return Number.isFinite(grams) && grams >= 1 && grams <= 5000 ? null : "Enter an amount that comes to between 1 and 5,000 grams.";
}

/**
 * The measure a food opens on when nothing was typed, as an index into its measures (-1: 100 g). Its default piece or
 * serving first; else the serving its own data gives: a package label's, or the one you saved for a food of your own,
 * even when that is only a weight ("Digestive biscuits", 45 g, opens at 1 × 45 g, not 100 g). Such a weight is the
 * opening amount only: it never answers a bare count, so "3 digestive biscuits" still asks for grams.
 */
export function openingPortion(food: Pick<FoodResult, "kind">, portions: readonly FoodPortion[]): number {
  const usual = portions.findIndex((portion) => portion.countDefault);
  if (usual >= 0 || (food.kind !== "custom" && food.kind !== "packaged")) return usual;
  return portions.findIndex((portion) => portion.unit === "serving" && portion.estimate === false);
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

/**
 * Only the newest search's (or barcode lookup's) answer is used. `start()` numbers a new one and gives a check that is
 * true while it is still the newest; `drop()`, when the sheet goes back to its start view (closed, logged, a search
 * with no food name, Barcode left for Search), makes every answer still to come stale, so a late answer can't bring
 * back an old result, source counts, a barcode answer or a chosen food.
 */
export function answerGate(): { start: () => () => boolean; drop: () => void } {
  let latest = 0;
  return {
    start() {
      const mine = ++latest;
      return () => mine === latest;
    },
    drop() {
      latest += 1;
    },
  };
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

/** Where a food in the sheet's lists was picked from, so the same entry can take the focus again. */
export type FoodCardList = "frequent" | "recent" | "result";

/** The `data-food-card` of one entry of the sheet's lists: unique in the sheet, also for a food both Recent and the results list. */
export function foodCardKey(list: FoodCardList, id: string, source = ""): string {
  return list === "frequent" ? `frequent:${id}` : `${list}:${source}:${id}`;
}

/**
 * Where the focus goes when the Add to log panel and the list take each other's place in the open sheet (D5), as
 * selectors, the first one found taking it. The control pressed goes with what it was in (a food in the list, the
 * search box or example whose search picked a food, Back to results, a button the new answer no longer offers), so the
 * focus would fall to the page. With the panel open: the food's amount. Back on the list: the food just left, when it
 * was picked from the list (`from`, its data-food-card); else the search box; after a barcode lookup, the barcode box.
 * `escape` makes `from` safe inside the selector (CSS.escape in the page).
 */
export function swapFocusTargets(view: { panel: boolean; mode: "search" | "barcode"; from: string | null }, escape: (value: string) => string = (value) => value): string[] {
  if (view.panel) return ["#log-portion-amount"];
  if (view.mode === "barcode") return ["#barcode-number"];
  return [...(view.from ? [`[data-food-card="${escape(view.from)}"]`] : []), "#log-search"];
}

/**
 * Where the focus goes once Try again has its answer (an element id), or null when it may stay where it is: the
 * product was found (its amount takes the focus), or the new answer offers Try again too, so its button stays. Else
 * the button has gone: to the answer's Create a food, or to the barcode box when no answer is shown (an error).
 */
export function focusAfterRetry(answer: { found: boolean; miss: BarcodeMiss | null }): string | null {
  if (answer.found) return null;
  if (!answer.miss) return "barcode-number";
  return barcodeMissText(answer.miss).retry ? null : "log-barcode-create";
}
