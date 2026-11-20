"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, PackageSearch, Plus, ScanBarcode, Search } from "lucide-react";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { DayOverview } from "@/components/nutrition/DayOverview";
import { CustomFoodForm, type CustomFoodPrefill } from "@/components/nutrition/CustomFoodForm";
import { EntryEditor, type EntryChange } from "@/components/nutrition/EntryEditor";
import { FoodDetail } from "@/components/nutrition/FoodDetail";
import { FoodResultCard } from "@/components/nutrition/FoodResultCard";
import { FrequentFoods } from "@/components/nutrition/FrequentFoods";
import { HouseholdMeasures } from "@/components/nutrition/HouseholdMeasures";
import { MealLog } from "@/components/nutrition/MealLog";
import { MyFoods } from "@/components/nutrition/MyFoods";
import { NameDialog } from "@/components/nutrition/NameDialog";
import { NutritionHistory } from "@/components/nutrition/NutritionHistory";
import type { AmountPrompt } from "@/components/nutrition/PortionPicker";
import { Routines } from "@/components/nutrition/Routines";
import { TargetsEditor } from "@/components/nutrition/TargetsEditor";
import ui from "@/components/nutrition/FoodUi.module.css";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { homePanel } from "@/config/routes";
import { useHydrated } from "@/components/ui/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { loadGoals } from "@/lib/data/goals";
import { dailyGoalFor, type GoalView } from "@/lib/domain/goals";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { profileAge } from "@/lib/domain/profile-options";
import { loadBirthDate } from "@/lib/domain/user-context";
import { amountAfterUnitChange, askForGramsMessage, describePortion, describeTypedAmount, extraPortions, formatAmount, parseFoodQuery, resolvePortion, type HouseholdMl } from "@/lib/domain/food-query";
import type { FoodPortion, ParsedFoodQuery } from "@/lib/domain/food-query";
import { checkSectionName, mealForTime, mealSections } from "@/lib/domain/meal-time";
import { estimateNutritionTargets, resolveDayTargets, resolveWaterTarget, scaleMacros, sumKnown } from "@/lib/domain/nutrition";
import { barcodeProblem, checkBarcode } from "@/lib/food/barcode";
import { dietFilterFor, hiddenByDiet, type DietFilter } from "@/lib/food/diet";
import { signedPhotoUrls, uploadFoodPhoto } from "@/lib/food/food-photos";
import { loadHousehold, saveHousehold } from "@/lib/food/household-storage";
import { unsourcedFor } from "@/lib/food/unsourced";
import {
  buildMealValues, sameMeal, clearTargets, customFoodResult, deleteTemplate, detectCapabilities, entryUpdate, foodFromEntry, frequentFromEntries, insertEntries, isEstimateSnapshot, loadCustomFoods,
  loadRecentFoods, loadRecentMeals, loadTargets, loadTemplates, MEAL_COLUMNS, removeCustomFood, removeCustomFoodPhoto, rowsFromItems, saveCustomFood,
  saveTargets, saveTemplate, usualAmount, withCurrentCustomFoods, type CustomFoodInput, type CustomFoodRow, type FrequentFood, type ManualTargets, type MealEntry,
  type MealTemplate, type NutritionCapabilities,
} from "@/lib/food/client-data";
import type { FoodResult, FoodSearchResponse, SourceStatus } from "@/lib/food/types";
import { nutritionDayLabels } from "./day-labels";
import styles from "./Nutrition.module.css";

type Profile = { age: number | null; gender: string | null; height: number | null; weight: number | null };
type Prefs = { activity_level: string; primary_goal: string; daily_water_goal_ml: number; dietary_preferences: string[] | null };
type Tab = "meals" | "foods" | "routines" | "history";
type LogMode = "search" | "barcode";
type NamePrompt = { kind: "meal"; slot: string; initial: string } | { kind: "day"; initial: string } | { kind: "section"; then: "log" | "sheet" | "none" };
type BarcodeMiss = { code: string; name: string | null; noLabel: boolean };

const EXAMPLES = ["3 idli", "2 roti", "150 g rice", "1 cup dal", "2 eggs"];
const NO_AMOUNT = parseFoodQuery("");
const NO_CAPABILITIES: NutritionCapabilities = { customFoodsV2: false, templates: false, targets: false, customExtra: false };
/** Search answers hold the user's own foods, so the browser must not answer from its cache. */
const SEARCH_FETCH: RequestInit = { cache: "no-store" };

function sourceText(source: SourceStatus) {
  if (source.status === "ok") return `${source.label} · ${source.count}`;
  if (source.status === "no_results") return `${source.label} · no match`;
  if (source.status === "timeout") return `${source.label} · timed out`;
  if (source.status === "rate_limited") return `${source.label} · busy`;
  if (source.status === "not_configured") return `${source.label} · not set up`;
  if (source.status === "not_set_up") return `${source.label} · needs database update`;
  return `${source.label} · unavailable`;
}

export default function NutritionPage() {
  const [date, setDate] = useState(() => new Date());
  // The page is prerendered at build time, so the chosen day is named only after hydration (nutritionDayLabels).
  const hydrated = useHydrated();
  const [userId, setUserId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<NutritionCapabilities>(NO_CAPABILITIES);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [customRows, setCustomRows] = useState<CustomFoodRow[]>([]);
  /** Signed links to the user's own food photos, by storage path. */
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(() => new Map());
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [recentFoods, setRecentFoods] = useState<FoodResult[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  /** The member's own daily water target in ml, or null when they have not set one (FITX assumes none). */
  const [waterGoal, setWaterGoal] = useState<number | null>(null);
  const [estimated, setEstimated] = useState<ReturnType<typeof estimateNutritionTargets>>(null);
  const [manualTargets, setManualTargets] = useState<ManualTargets | null>(null);
  const [dailyGoals, setDailyGoals] = useState<GoalView[] | null>(null);
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState<ParsedFoodQuery>(NO_AMOUNT);
  const [lastSearch, setLastSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<FoodResult[]>([]);
  const [searchMode, setSearchMode] = useState<FoodSearchResponse["mode"]>("browse");
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [searchingFoods, setSearchingFoods] = useState(true);
  const [dietFilter, setDietFilter] = useState<DietFilter>({ nonVeg: false, egg: false });
  /** The diet filter starts from the user's diet once; after that it is whatever the user ticked. */
  const dietFilterSet = useRef(false);
  /** A log or water entry being saved, so a second tap before the button disables can't add it twice. */
  const loggingFood = useRef(false);
  const loggingWater = useRef(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [amount, setAmount] = useState("100");
  const [unitKey, setUnitKey] = useState("g");
  /** A volume weight worked out from another USDA measure, such as 1 fl oz from the cup. */
  const [derived, setDerived] = useState<FoodPortion | null>(null);
  const [amountPrompt, setAmountPrompt] = useState<AmountPrompt | null>(null);
  const [barcodeMiss, setBarcodeMiss] = useState<BarcodeMiss | null>(null);
  const [meal, setMeal] = useState<string>("Breakfast");
  /** Once the member picks a meal, the time of day stops choosing it for them. */
  const mealPicked = useRef(false);
  const [recentMeals, setRecentMeals] = useState<MealEntry[]>([]);
  const [frequent, setFrequent] = useState<FrequentFood[]>([]);
  /** Meal sections added on this page that no entry uses yet. */
  const [addedSections, setAddedSections] = useState<string[]>([]);
  const [household, setHousehold] = useState<HouseholdMl>({});
  const [householdOpen, setHouseholdOpen] = useState(false);
  /** The Log food sheet: search (with recent and frequent foods) or a barcode; the chosen food's amount in it. */
  const [logOpen, setLogOpen] = useState(false);
  const [logMode, setLogMode] = useState<LogMode>("search");
  const [scannerOpen, setScannerOpen] = useState(false);
  /** Bumped by "Type the number": once the scanner has closed, the barcode field takes the focus. */
  const [typeRequest, setTypeRequest] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const barcodeInput = useRef<HTMLInputElement>(null);
  /** Another dialog was opened from the Log food sheet, so the sheet comes back when that one closes. */
  const reopenLog = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** "Tap the one you mean": a typed amount matched more than one food. */
  const [pickHint, setPickHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("meals");
  // Home's "Scan a barcode" link: open Log food on Barcode with the camera, then put the address back to /nutrition.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scan") !== "1") return;
    void Promise.resolve().then(() => {
      setLogMode("barcode");
      setLogOpen(true);
      setScannerOpen(true);
      window.history.replaceState(null, "", "/nutrition");
    });
  }, []);
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null);
  const [foodForm, setFoodForm] = useState<{ editing: CustomFoodRow | null; prefill: CustomFoodPrefill | null } | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const dateKey = localDateKey(date);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    if (!supabase) { setError("Nutrition tracking is not connected to Supabase."); setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sign in to track food and water."); setLoading(false); return; }
    const uid = auth.user.id;
    setUserId(uid);
    const caps = await detectCapabilities(supabase);
    setCapabilities(caps);
    const [mealResult, waterResult, profileResult, prefsResult, custom, targets, savedTemplates, goalViews, birthDate] = await Promise.all([
      supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", uid).eq("date", dateKey).order("created_at", { ascending: true }),
      supabase.from("water_logs").select("amount_ml").eq("user_id", uid).eq("local_date", dateKey),
      supabase.from("profiles").select("age,gender,height,weight").eq("id", uid).maybeSingle(),
      supabase.from("user_preferences").select("activity_level,primary_goal,daily_water_goal_ml,dietary_preferences").eq("user_id", uid).maybeSingle(),
      loadCustomFoods(supabase, uid, caps.customFoodsV2),
      caps.targets ? loadTargets(supabase, uid) : Promise.resolve(null),
      caps.templates ? loadTemplates(supabase, uid) : Promise.resolve([]),
      // Daily calorie and protein goals come first, as on Home, so both pages show the same "kcal left".
      loadGoals(supabase, uid, dateKey).then((result) => result.goals).catch(() => null),
      // The stored age is only refreshed when the profile is saved; the birth date keeps it right after a birthday.
      loadBirthDate(supabase, uid),
    ]);
    const failure = [mealResult.error, waterResult.error, profileResult.error, prefsResult.error].find(Boolean) ?? (custom.error ? new Error("custom foods") : null);
    if (failure) setError("Your nutrition data could not be loaded. Please try again.");
    else {
      setEntries((mealResult.data || []) as MealEntry[]);
      setWaterMl(((waterResult.data || []) as Array<{ amount_ml: number }>).reduce((sum: number, row) => sum + Number(row.amount_ml || 0), 0));
      const prefs = prefsResult.data as Prefs | null;
      setWaterGoal(prefs?.daily_water_goal_ml && prefs.daily_water_goal_ml > 0 ? prefs.daily_water_goal_ml : null);
      const profile = (profileResult.data || {}) as Profile;
      setEstimated(estimateNutritionTargets({ ...profile, age: profileAge({ age: profile.age, date_of_birth: birthDate }) }, prefs?.activity_level, prefs?.primary_goal));
      if (!dietFilterSet.current) { dietFilterSet.current = true; setDietFilter(dietFilterFor(prefs?.dietary_preferences)); }
      setCustomRows(custom.rows);
      if (caps.customFoodsV2) setPhotoUrls(await signedPhotoUrls(supabase, custom.rows.map((row) => row.image_path ?? "")));
      setManualTargets(targets);
      setDailyGoals(goalViews);
      setTemplates(savedTemplates);
      setError("");
    }
    setLoading(false);
  }, [dateKey]);

  const refreshRecent = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const [foods, meals] = await Promise.all([loadRecentFoods(supabase, auth.user.id), loadRecentMeals(supabase, auth.user.id, new Date())]);
    setRecentFoods(foods);
    setRecentMeals(meals);
    setFrequent(frequentFromEntries(meals));
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { void Promise.resolve().then(refreshRecent); }, [refreshRecent]);
  // The meal that suits the time of day and the member's own measures, read once in the browser (never on the server).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!mealPicked.current) setMeal(mealForTime(new Date()));
      setHousehold(loadHousehold());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const totals = useMemo(() => sumKnown(entries), [entries]);
  // Same order as Home (todayTargets): a daily calorie or protein goal for this day, then the targets the
  // member set, then the estimate from the profile. A daily goal counts on its own too.
  const dayTargets = resolveDayTargets(
    { calories: dailyGoalFor(dailyGoals, "calories_kcal", dateKey)?.targetValue, protein: dailyGoalFor(dailyGoals, "protein_g", dateKey)?.targetValue },
    manualTargets, estimated,
  );
  const target = dayTargets?.targets ?? null;
  const targetSourceText = dayTargets?.source ?? "";
  // Water as on Home: a daily water goal for this day, then the member's saved setting.
  const waterTarget = resolveWaterTarget(dailyGoalFor(dailyGoals, "water_ml", dateKey)?.targetValue, waterGoal);
  /** The food's own portions, then ml, cups and katori worked out for it, then any weight worked out from typing. */
  const portionOptions = useMemo(
    () => (selected ? [...selected.portions, ...extraPortions(selected.portions, selected.name, household), ...(derived ? [derived] : [])] : []),
    [selected, derived, household],
  );
  const sections = useMemo(() => mealSections([...recentMeals, ...entries].map((entry) => entry.meal), addedSections), [recentMeals, entries, addedSections]);
  const chosenPortion = unitKey.startsWith("portion:") ? portionOptions[Number(unitKey.slice("portion:".length))] ?? null : null;
  const amountNumber = amount.trim() ? Number(amount) : Number.NaN;
  const grams = Number.isFinite(amountNumber) ? Math.round(amountNumber * (chosenPortion ? chosenPortion.grams : 1) * 10) / 10 : Number.NaN;
  const selectedMacros = selected && grams > 0 ? scaleMacros(selected, grams) : null;
  const filtering = dietFilter.nonVeg || dietFilter.egg;
  const shownResults = results.filter((food) => !hiddenByDiet(food.dietType, dietFilter));
  const hiddenCount = results.length - shownResults.length;

  const photoFor = useCallback((row: CustomFoodRow | undefined) => (row?.image_path ? photoUrls.get(row.image_path) ?? null : null), [photoUrls]);
  /** Recent foods, with your own foods as saved now (edits apply, deleted ones drop out), through the diet filter. */
  const shownRecent = useMemo(
    () => withCurrentCustomFoods(recentFoods, customRows, photoFor).filter((food) => !hiddenByDiet(food.dietType, dietFilter)),
    [recentFoods, customRows, photoFor, dietFilter],
  );
  function changeDietFilter(change: Partial<DietFilter>) {
    dietFilterSet.current = true;
    setDietFilter((current) => ({ ...current, ...change }));
  }
  /** Search results carry no photo links for your own foods; add the ones this page signed. */
  const withPhoto = useCallback((food: FoodResult): FoodResult => {
    if (food.kind !== "custom") return food;
    const url = photoFor(customRows.find((row) => row.id === food.id));
    return url ? { ...food, image: url, imageCredit: "Your photo" } : food;
  }, [customRows, photoFor]);

  function shiftDate(offset: number) {
    setDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset));
  }

  /**
   * Another unit for the same food (amountAfterUnitChange): two sizes of the same piece keep the count (2 large
   * samosas become 2 small ones); grams and other measures keep the weight, so "100" g does not become 100
   * servings. After a question about the amount, a measure of the kind typed gets the typed count.
   */
  function changeUnit(next: string) {
    const portion = next.startsWith("portion:") ? portionOptions[Number(next.slice("portion:".length))] ?? null : null;
    setAmount(formatAmount(amountAfterUnitChange(amountNumber, chosenPortion, portion, amountPrompt?.typed ?? null)));
    setUnitKey(next);
    setAmountPrompt(null);
  }

  /** Selects a food and fills the amount from what was typed: "3 idli" becomes 3 x USDA's 38 g idli. */
  const chooseFood = useCallback((food: FoodResult, typed: ParsedFoodQuery = NO_AMOUNT) => {
    // Its own portions, then ml, cups and katori worked out from its USDA volume measure (when it has one).
    const own = food.portions ?? [];
    const portions = [...own, ...extraPortions(own, food.name, household)];
    const resolution = resolvePortion(typed, portions);
    setSelected(food);
    setDerived(null);
    setAmountPrompt(null);
    setNotice("");
    setPickHint("");
    setBarcodeMiss(null);
    if (resolution.kind === "grams") {
      setAmount(formatAmount(resolution.grams));
      setUnitKey("g");
    } else if (resolution.kind === "portion") {
      const index = portions.indexOf(resolution.portion);
      if (index >= 0 || resolution.derivedFrom) {
        if (index < 0 && resolution.derivedFrom) setDerived({ ...resolution.portion, derivedFrom: { label: resolution.derivedFrom.label, grams: resolution.derivedFrom.grams } });
        setUnitKey(`portion:${index >= 0 ? index : portions.length}`);
        setAmount(formatAmount(resolution.count));
      } else {
        setAmount(formatAmount(resolution.grams));
        setUnitKey("g");
      }
    } else if (resolution.kind === "ask") {
      setAmount("");
      setUnitKey("g");
      const actions: AmountPrompt["actions"] = [];
      // "150 rice" probably means 150 g, so offer that; a count of pieces or a missing size does not.
      if (resolution.reason === "no-count-weight" && resolution.unit === null && resolution.amount >= 10) {
        const offered = resolution.amount;
        actions.push({ label: `Use ${formatAmount(offered)} g`, run: () => { setAmount(formatAmount(offered)); setUnitKey("g"); setAmountPrompt(null); } });
      }
      // "1 spoon ghee": let the user say which spoon, then work it out from the food's own measures.
      if (resolution.unit === "spoon") {
        for (const spoon of ["tsp", "tbsp"] as const) {
          const retry = resolvePortion({ amount: resolution.amount, unit: spoon, size: null }, portions);
          if (retry.kind !== "portion") continue;
          actions.push({
            label: `${formatAmount(resolution.amount)} ${spoon === "tsp" ? "teaspoon" : "tablespoon"} (${formatAmount(retry.grams)} g)`,
            run: () => {
              const at = portions.indexOf(retry.portion);
              if (at < 0 && retry.derivedFrom) setDerived({ ...retry.portion, derivedFrom: { label: retry.derivedFrom.label, grams: retry.derivedFrom.grams } });
              setUnitKey(`portion:${at >= 0 ? at : portions.length}`);
              setAmount(formatAmount(retry.count));
              setAmountPrompt(null);
            },
          });
        }
      }
      const measures = portions.length && resolution.reason !== "no-size-weight" && resolution.unit !== "spoon" ? " You can also pick one of this food's measures under Unit." : "";
      setAmountPrompt({ message: `${askForGramsMessage(food.name, resolution)}${measures}`, actions, typed: { amount: resolution.amount, unit: resolution.unit } });
    } else {
      // Nothing typed: one of the food's own pieces or servings when it has one, otherwise 100 g.
      // The label's own serving is the default for a scanned product.
      const index = portions.findIndex((portion) => portion.countDefault || (food.kind === "packaged" && portion.unit === "serving" && portion.estimate === false));
      setAmount(index >= 0 ? "1" : "100");
      setUnitKey(index >= 0 ? `portion:${index}` : "g");
    }
  }, [household]);

  const lookupBarcode = useCallback(async (value: string) => {
    const checked = checkBarcode(value);
    if (!checked.ok) { setError(barcodeProblem(checked.reason)); return; }
    setBusy(true); setError(""); setNotice(""); setBarcodeMiss(null);
    try {
      const response = await fetch(`/api/foods/search?barcode=${encodeURIComponent(checked.code)}`, SEARCH_FETCH);
      const data = (await response.json()) as FoodSearchResponse;
      if (!response.ok) throw new Error(data.error || "Barcode lookup failed.");
      setResults(data.foods || []);
      setSources(data.sources || []);
      setSearchMode("barcode");
      setLastQuery(NO_AMOUNT);
      if (data.foods?.length) chooseFood(data.foods[0]);
      else if (data.barcodeStatus === "invalid") setError(data.error || barcodeProblem("check-digit"));
      else if (data.barcodeStatus === "rate_limited") setError("Open Food Facts is busy right now (it limits how often FITX can ask). Try again in a minute, or add the product yourself.");
      else if (data.barcodeStatus === "timeout" || data.barcodeStatus === "unavailable") setError("Open Food Facts didn't answer, so the barcode couldn't be checked. Try again shortly, or add the product yourself.");
      else { setSelected(null); setBarcodeMiss({ code: checked.code, name: data.productName ?? null, noLabel: data.barcodeStatus === "no_label" }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Barcode lookup failed."); }
    finally { setBusy(false); }
  }, [chooseFood]);

  const onBarcodeDetected = useCallback((value: string) => {
    setBarcode(value);
    void lookupBarcode(value);
  }, [lookupBarcode]);

  async function findBarcode(event: FormEvent) {
    event.preventDefault();
    await lookupBarcode(barcode);
  }

  const browseFoods = useCallback(async () => {
    setSearchingFoods(true);
    try {
      const response = await fetch("/api/foods/search?browse=1", SEARCH_FETCH);
      const data = (await response.json()) as FoodSearchResponse;
      if (!response.ok) throw new Error(data.error || "Food search failed.");
      setResults(data.foods || []);
      setSources(data.sources || []);
      setSearchMode("browse");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void browseFoods(); }, 0);
    return () => window.clearTimeout(timer);
  }, [browseFoods]);

  async function runFoodSearch(value: string, packaged = false) {
    setQuery(value);
    const typed = parseFoodQuery(value);
    if (typed.text.length < 2) {
      if (!value.trim()) { void browseFoods(); setLastSearch(""); setLastQuery(NO_AMOUNT); return; }
      setResults([]);
      if (typed.amount !== null) setError("Add a food name after the amount, for example “150 g rice”.");
      return;
    }
    setSearchingFoods(true); setError(""); setNotice(""); setPickHint(""); setBarcodeMiss(null);
    try {
      const response = await fetch(`/api/foods/search?q=${encodeURIComponent(value.trim())}${packaged ? "&packaged=1" : ""}`, SEARCH_FETCH);
      const data = (await response.json()) as FoodSearchResponse;
      if (!response.ok) throw new Error(data.error || "Food search failed.");
      const found = (data.foods || []).map(withPhoto);
      setResults(found);
      setSources(data.sources || []);
      setSearchMode(data.mode);
      setLastQuery(typed);
      setLastSearch(value.trim());
      if (!found.length) {
        const off = (data.sources || []).find((source) => source.id === "open-food-facts");
        setError(packaged
          ? off && (off.status === "rate_limited" || off.status === "error" || off.status === "timeout")
            ? "Open Food Facts didn't answer just now. Try again in a minute, or scan the product's barcode."
            : "No packaged product matched. Try other words, or scan the barcode."
          : "No matching food was found. Try other words, search packaged products, or add your own food.");
      } else if (typed.amount !== null && !packaged) {
        // Select a food only when it is clearly the one meant (its whole name or alias is what was typed); otherwise
        // the user taps one, and the typed amount is applied to it.
        const pick = data.pick ? found.find((food) => food.source === data.pick?.source && food.id === data.pick?.id) ?? null : null;
        // The diet filter hides a food, so it is never selected behind the user's back either.
        const hiddenPick = pick && hiddenByDiet(pick.dietType, dietFilter) ? pick : null;
        const visible = found.filter((food) => !hiddenByDiet(food.dietType, dietFilter));
        if (pick && !hiddenPick) chooseFood(pick, typed);
        else {
          setSelected(null);
          setDerived(null);
          setAmountPrompt(null);
          const amountText = describeTypedAmount(typed);
          setPickHint(hiddenPick
            ? `“${hiddenPick.name}” is marked ${hiddenPick.dietType === "egg" ? "egg" : "non-veg"}, so it is hidden. Turn off “Hide ${hiddenPick.dietType === "egg" ? "egg" : "non-veg"}” to log it.`
            : visible.length === 1
              ? `Is it “${visible[0].name}”? Tap it to keep ${amountText}.`
              : visible.length
                ? `Tap the “${typed.text}” you mean to keep ${amountText}.`
                : `Every food that matches “${typed.text}” is hidden by the diet filter.`);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }

  async function searchFoods(event: FormEvent) {
    event.preventDefault();
    await runFoodSearch(query);
  }

  async function logFood(food: FoodResult) {
    if (!Number.isFinite(grams) || grams < 1 || grams > 5000) { setError("Enter an amount that comes to between 1 and 5,000 grams."); return; }
    if (loggingFood.current) return;
    loggingFood.current = true;
    try {
      await insertLoggedFood(food);
    } finally {
      loggingFood.current = false;
      setBusy(false);
    }
  }

  /** Takes back rows just added (the Undo button of the toast): deletes them by id, for this member only. */
  async function undoAdded(ids: string[], label: string) {
    const supabase = createClient();
    if (!supabase || !userId || !ids.length) return;
    const result = await supabase.from("meals").delete().in("id", ids).eq("user_id", userId);
    if (result.error) { toast.error("That could not be undone. Remove it from the Meals tab."); return; }
    toast(`Removed ${label}.`);
    await load();
    void refreshRecent();
  }

  /** Tells the member what was added, with an Undo that removes exactly those rows. */
  function announceAdded(ids: string[], label: string, mealName: string) {
    toast.success(`Added ${label} to ${mealName}.`, { action: ids.length ? { label: "Undo", onClick: () => void undoAdded(ids, label) } : undefined, duration: 8000 });
  }

  async function insertLoggedFood(food: FoodResult) {
    const supabase = createClient();
    if (!supabase) return setError("Nutrition tracking is not connected to Supabase.");
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to log food.");
    setError(""); setNotice("");
    // Unknown protein, carbs or fat are NULL in the entry and listed in the snapshot, never logged as 0 g.
    const values = buildMealValues(food, grams);
    const portion = chosenPortion;
    const inserted = await supabase.from("meals").insert({
      user_id: auth.user.id, date: dateKey, meal, food_name: food.name, brand: food.brand,
      barcode: food.barcode, provider_id: food.id,
      source: food.source, serving_size: portion ? describePortion(amountNumber, portion, grams) : `${formatAmount(grams)} g`,
      servings: grams / 100, quantity_grams: grams,
      calories: values.calories, protein: values.protein, carbs: values.carbs, fat: values.fat,
      nutrition_snapshot: {
        ...values.snapshot,
        source: food.source,
        kind: food.kind,
        value_basis: food.valueBasis,
        ...(food.dietType ? { diet_type: food.dietType } : {}),
        ...(food.dataType ? { data_type: food.dataType } : {}),
        ...(food.basis ? { basis: food.basis } : {}),
        ...(portion ? {
          portion: {
            count: amountNumber, label: portion.label, unit: portion.unit, grams_each: portion.grams, estimate: portion.estimate !== false,
            ...(portion.derivedFrom ? { converted_from: { label: portion.derivedFrom.label, grams: portion.derivedFrom.grams } } : {}),
            ...(portion.vessel ? { vessel_ml: portion.vessel.ml, vessel_set_by_you: portion.vessel.custom } : {}),
          },
        } : {}),
      },
    }).select("id");
    if (inserted.error) { setError("That food could not be logged. Please try again."); return; }
    // Back to the day, which now shows it; the toast can take it back.
    setSelected(null); setLogOpen(false); setQuery(""); setLastSearch(""); setLastQuery(NO_AMOUNT);
    const ids = ((inserted.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    announceAdded(ids, food.name, meal);
    void browseFoods();
    await load(); void refreshRecent();
  }

  /** One tap on a frequent food: logs a copy of the entry that carries the amount the member usually has. */
  async function addUsual(item: FrequentFood) {
    if (loggingFood.current) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    loggingFood.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      // Straight from the member's last 30 days, into the meal shown (the one that suits the time of day unless they picked another).
      const target = meal;
      const inserted = await insertEntries(supabase, rowsFromItems(userId, dateKey, [item.entry], target));
      if (inserted.error) { setError("That could not be added. Please try again."); return; }
      announceAdded(((inserted.data ?? []) as Array<{ id: string }>).map((row) => row.id), item.name, target);
      await load(); void refreshRecent();
    } finally {
      loggingFood.current = false;
      setBusy(false);
    }
  }

  /** Tapping a frequent food's name chooses it at the amount the member usually has, not an amount typed in an earlier search. */
  function chooseFrequent(item: FrequentFood) {
    const food = foodFromEntry(item.entry);
    if (!food) return;
    chooseFood(food);
    const usual = usualAmount(item.entry);
    if (usual) { setAmount(formatAmount(usual.amount)); setUnitKey(usual.unitKey); }
  }

  function pickMeal(next: string) {
    mealPicked.current = true;
    setMeal(next);
  }

  /** Opens Log food, optionally on a meal (a meal's + in the diary) or on Barcode. */
  function openLog(options: { meal?: string; mode?: LogMode; quiet?: boolean } = {}) {
    if (options.meal) pickMeal(options.meal);
    setLogMode(options.mode ?? "search");
    setError(""); setNotice("");
    setLogOpen(true);
    // Straight into the search box (the sheet's content mounts with it), as the reference apps do.
    if ((options.mode ?? "search") === "search" && !options.quiet) window.setTimeout(() => searchInput.current?.focus({ preventScroll: true }), 60);
  }

  /** The member closed Log food: the next one starts fresh. */
  function closeLog() {
    setLogOpen(false);
    setSelected(null); setAmountPrompt(null); setBarcodeMiss(null); setPickHint(""); setError("");
    reopenLog.current = false;
  }

  /** Steps out of Log food for another dialog (measures, a meal name, a new food) and remembers to come back. */
  function hideLog() {
    reopenLog.current = logOpen;
    setLogOpen(false);
  }

  function restoreLog() {
    if (!reopenLog.current) return;
    reopenLog.current = false;
    setLogOpen(true);
  }

  /** "Type the number" from the scanner: the barcode field, ready to type in. */
  function typeBarcode() {
    setScannerOpen(false);
    setLogMode("barcode");
    setLogOpen(true);
    setTypeRequest((count) => count + 1);
  }
  // After the scanner's dialog has closed (and the browser has put the focus back where it was), move it to the field.
  useEffect(() => {
    if (!typeRequest || scannerOpen) return;
    const timer = window.setTimeout(() => barcodeInput.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [typeRequest, scannerOpen]);

  /** The search box under the overview opens Log food with the search running. */
  async function quickSearch(event: FormEvent) {
    event.preventDefault();
    openLog({ quiet: true });
    await runFoodSearch(query);
  }

  async function addWater(amountMl: number) {
    if (loggingWater.current) return;
    loggingWater.current = true;
    try {
      const supabase = createClient();
      if (!supabase) return setError("Water tracking is not connected to Supabase.");
      setBusy(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setError("Sign in to log water.");
      const result = await supabase.from("water_logs").insert({ user_id: auth.user.id, amount_ml: amountMl, local_date: dateKey });
      if (result.error) setError("Water could not be logged."); else setWaterMl((current) => current + amountMl);
    } finally {
      loggingWater.current = false;
      setBusy(false);
    }
  }

  async function removeMeal(entry: MealEntry) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    const result = await supabase.from("meals").delete().eq("id", entry.id).eq("user_id", userId);
    if (result.error) setError("That food could not be removed."); else await load();
  }

  async function saveEntry(entry: MealEntry, change: EntryChange) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true); setError("");
    const result = await supabase.from("meals").update(entryUpdate(entry, change)).eq("id", entry.id).eq("user_id", userId);
    setBusy(false);
    if (result.error) { setError("That entry could not be changed. Please try again."); return; }
    setEditingEntry(null);
    setNotice(change.date !== entry.date ? `Moved ${entry.food_name} to ${readableDate(new Date(`${change.date}T00:00:00`))}.` : `Updated ${entry.food_name}.`);
    await load();
  }

  /** Saves a food to My foods only; logging it is a separate step. */
  async function saveFood(input: CustomFoodInput, photo: File | null, removePhoto: boolean) {
    const supabase = createClient();
    if (!supabase || !userId) return setError("Sign in to save your own foods.");
    const editing = foodForm?.editing ?? null;
    setBusy(true); setError("");
    const { row, error: saveError } = await saveCustomFood(supabase, userId, input, capabilities.customFoodsV2, editing?.id);
    if (saveError || !row) {
      setBusy(false);
      const duplicate = (saveError as { code?: string } | null)?.code === "23505";
      setError(duplicate ? "One of your foods already has that barcode." : "Your food could not be saved. Please try again.");
      return;
    }
    let photoProblem = "";
    let photoUrl: string | null = null;
    if (removePhoto && !photo && editing && capabilities.customFoodsV2) {
      const removed = await removeCustomFoodPhoto(supabase, userId, editing);
      if (removed.error) photoProblem = " The photo could not be removed. Please try again.";
    }
    if (photo && capabilities.customFoodsV2) {
      try {
        const path = await uploadFoodPhoto(supabase, userId, row.id, photo, row.image_path ?? null);
        const updated = await supabase.from("custom_foods").update({ image_path: path }).eq("id", row.id).eq("user_id", userId);
        if (updated.error) throw new Error("not saved");
        photoUrl = (await signedPhotoUrls(supabase, [path])).get(path) ?? null;
      } catch (cause) {
        photoProblem = ` The photo was not saved: ${cause instanceof Error ? cause.message : "please try again"}`;
      }
    }
    setBusy(false);
    setFoodForm(null);
    await load();
    reopenLog.current = false;
    if (editing) { setNotice(`Saved changes to “${row.name}”.${photoProblem}`); return; }
    // Saved, not logged: the toast offers to log it now.
    const saved = customFoodResult(row, photoUrl);
    toast.success(`Saved “${row.name}” to My foods.${photoProblem}`, { action: { label: "Log it", onClick: () => { chooseFood(saved); setLogMode("search"); setLogOpen(true); } }, duration: 8000 });
  }

  async function removeFood(row: CustomFoodRow) {
    if (!window.confirm(`Delete “${row.name}” from My foods${row.image_path ? ", with its photo" : ""}? Past logs keep their values. This can't be undone.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true);
    const result = await removeCustomFood(supabase, userId, row);
    setBusy(false);
    if (result.error) setError("That food could not be deleted. Please try again.");
    else { setNotice(`Deleted “${row.name}”.`); await load(); }
  }

  /** Adds a named meal section to the lists. It is stored with the first entry logged in it (the meal's name is the entry's meal text). */
  function addSection(name: string, then: "log" | "sheet" | "none") {
    const checked = checkSectionName(name);
    if (!checked.ok) return;
    const existing = sections.find((item) => item.toLowerCase() === checked.name.toLowerCase());
    const chosen = existing ?? checked.name;
    if (!existing) setAddedSections((old) => [...old, chosen]);
    pickMeal(chosen);
    setNamePrompt(null);
    setNotice(existing ? `“${chosen}” is selected.` : `Added “${chosen}”. It stays once you log something in it.`);
    if (then === "sheet") restoreLog();
  }

  async function saveNamed(name: string) {
    const prompt = namePrompt;
    const supabase = createClient();
    if (prompt?.kind === "section") { addSection(name, prompt.then); return; }
    if (!prompt || !supabase || !userId) return;
    const items = prompt.kind === "meal" ? entries.filter((entry) => sameMeal(entry.meal, prompt.slot)) : entries;
    setBusy(true); setError("");
    const result = await saveTemplate(supabase, userId, name, prompt.kind, items, prompt.kind === "meal" ? prompt.slot : null);
    setBusy(false);
    if (result.error) { setError("That could not be saved. Please try again."); return; }
    setNamePrompt(null);
    setNotice(prompt.kind === "meal" ? `Saved “${name}”. Add it to any day from Routines.` : `Saved “${name}” as a routine. Add it to any day from Routines.`);
    await load();
  }

  async function applyTemplate(template: MealTemplate, slot: string | null) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true); setError("");
    const result = await insertEntries(supabase, rowsFromItems(userId, dateKey, template.items, slot));
    setBusy(false);
    if (result.error) { setError("That could not be added. Please try again."); return; }
    setNotice(`Added ${template.items.length} ${template.items.length === 1 ? "food" : "foods"} from “${template.name}” to ${readableDate(date)}${slot ? ` (${slot})` : ""}.`);
    await load();
  }

  async function removeTemplate(template: MealTemplate) {
    if (!window.confirm(`Delete “${template.name}”? Days you already added it to keep their entries.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true);
    const result = await deleteTemplate(supabase, userId, template.id);
    setBusy(false);
    if (result.error) setError("That could not be deleted. Please try again."); else await load();
  }

  async function copyYesterday() {
    const supabase = createClient();
    if (!supabase || !userId) return;
    const yesterday = localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
    setBusy(true); setError("");
    const { data, error: readError } = await supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", userId).eq("date", yesterday).order("created_at", { ascending: true });
    if (readError) { setBusy(false); setError("Yesterday's meals could not be read. Please try again."); return; }
    const rows = (data ?? []) as MealEntry[];
    if (!rows.length) { setBusy(false); setNotice("Nothing was logged the day before."); return; }
    if (entries.length && !window.confirm(`This day already has ${entries.length} ${entries.length === 1 ? "entry" : "entries"}. Add the day before's ${rows.length} too?`)) { setBusy(false); return; }
    const result = await insertEntries(supabase, rowsFromItems(userId, dateKey, rows, null));
    setBusy(false);
    if (result.error) { setError("Yesterday's meals could not be copied. Please try again."); return; }
    setNotice(`Copied ${rows.length} ${rows.length === 1 ? "food" : "foods"} from the day before.`);
    await load();
  }

  async function updateTargets(next: ManualTargets | null) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true); setError("");
    const result = next ? await saveTargets(supabase, userId, next) : await clearTargets(supabase, userId);
    setBusy(false);
    if (result.error) { setError("Your targets could not be saved. Please try again."); return; }
    setTargetsOpen(false);
    setNotice(next ? "Saved your daily targets." : "Using the estimate from your profile again.");
    await load();
  }

  /**
   * Opens the new-food form from the chosen food: a package's label or a catalogue food copied as it is, so it can be
   * re-logged from My foods. The values keep where they came from (USDA lab analysis, a typical recipe, a package label),
   * and the weight of the chosen serving, when it is not an estimate, becomes the saved serving.
   */
  function saveSelectedAsFood(food: FoodResult) {
    const serving = food.portions.find((portion) => portion.unit === "serving");
    hideLog();
    setFoodForm({
      editing: null,
      prefill: {
        name: food.name, brand: food.brand, barcode: food.barcode,
        servingLabel: serving ? serving.label.replace(/^1 serving \((.*)\)$/, "$1") : "",
        servingGrams: serving?.grams ?? 100,
        per100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
        missing: food.missing,
        imageUrl: food.image, imageAttribution: food.imageCredit,
        origin: food.barcode ? "barcode" : "user",
        sourceRef: food.barcode ?? (food.kind === "catalog" && /^\d+$/.test(food.id) ? food.id : null),
        valueBasis: food.valueBasis,
      },
    });
  }

  const visibleSources = sources.filter((source) => source.status !== "not_used");
  const estimateCount = entries.filter(isEstimateSnapshot).length;
  const showBrowse = searchMode === "browse";
  const tabs: Array<[Tab, string]> = [["meals", "Meals"], ["foods", "My foods"], ["routines", "Routines"], ["history", "History"]];
  const dayLabels = nutritionDayLabels(hydrated ? date : null);
  const unsourced = lastSearch && searchMode !== "packaged" && !searchingFoods ? unsourcedFor(lastSearch, results) : null;
  /** A typed amount matched more than one food: the Add to log panel asks which one, and keeps the amount. */
  const choosing = !selected && Boolean(pickHint);

  /** The chosen food's amount and meal, in the Add to log panel of the sheet. */
  function detailFor(food: FoodResult) {
    return <FoodDetail food={food} amount={amount} unitKey={unitKey} options={portionOptions} chosen={chosenPortion} grams={grams} macros={selectedMacros}
      prompt={amountPrompt} onAmount={(value) => { setAmount(value); setAmountPrompt(null); }} onUnit={changeUnit}
      onMeasures={() => { hideLog(); setHouseholdOpen(true); }}
      sections={sections} meal={meal} onMeal={pickMeal} onAddSection={() => { hideLog(); setNamePrompt({ kind: "section", then: "sheet" }); }}
      mealControl="select" idPrefix="log-portion"/>;
  }

  const messages = <>
    {error && <p role="alert" className={styles.alert}>{error}</p>}
    {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
  </>;

  const foodList = (
    <div aria-live="polite" className={styles.foodResults}>
      {searchingFoods ? <p className={styles.loading}>Loading foods…</p> : <>
        {unsourced && <div className={ui.callout}>
          <p><strong>{unsourced.label}</strong> has no sourced values in FITX yet, so nothing is guessed.{shownResults.length > 0 ? " These only contain the word." : ""}</p>
          <div className={ui.toolbar}>
            <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" onClick={() => void runFoodSearch(lastSearch, true)}>Search packaged</button>
            <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" onClick={() => { hideLog(); setFoodForm({ editing: null, prefill: { name: parseFoodQuery(lastSearch).text.replace(/^./, (letter) => letter.toUpperCase()) } }); }}>Create a food</button>
          </div>
        </div>}
        {showBrowse && frequent.length > 0 && <FrequentFoods items={frequent} meal={meal} busy={busy} onAdd={(item) => void addUsual(item)} onChoose={chooseFrequent}/>}
        {showBrowse && shownRecent.length > 0 && <>
          <p className={styles.listLabel}>Recent</p>
          {shownRecent.map((food, index) => <div key={`recent-${food.source}-${food.id}`} className={styles.listItem} style={{ "--i": Math.min(index, 10) } as CSSProperties}>
            <FoodResultCard food={food} active={false} dietUnchecked={filtering && !food.dietType} onSelect={(chosen) => chooseFood(chosen, lastQuery)}/>
          </div>)}
        </>}
        {showBrowse && <p className={styles.listLabel}>Common foods</p>}
        {searchMode === "packaged" && <p className={ui.muted}>Packaged products from Open Food Facts, entered from labels by its community.</p>}
        {shownResults.some((food) => food.suggestion) && <p className={ui.muted}>No exact match. Closest spellings:</p>}
        {shownResults.map((food, index) => <div key={`${food.source}-${food.id}`} className={styles.listItem} style={{ "--i": Math.min(index, 10) } as CSSProperties}>
          <FoodResultCard food={food} active={false} dietUnchecked={filtering && !food.dietType} onSelect={(chosen) => chooseFood(chosen, lastQuery)}/>
        </div>)}
        {hiddenCount > 0 && <p className={ui.muted}>{hiddenCount} {hiddenCount === 1 ? "food" : "foods"} marked {dietFilter.nonVeg && dietFilter.egg ? "non-veg or egg" : dietFilter.egg ? "egg" : "non-veg"} {hiddenCount === 1 ? "is" : "are"} hidden.</p>}
        {filtering && shownResults.some((food) => !food.dietType) && <p className={ui.muted}>Foods without a diet label stay visible, marked “Diet not checked”.</p>}
      </>}
    </div>
  );

  return (
    <div className={styles.page}>
      <PageHeader title="Nutrition" actions={<>
        <div className={styles.day} role="group" aria-label="Day">
          <button type="button" onClick={() => shiftDate(-1)} aria-label="Previous day" className={styles.dayButton}><ArrowLeft size={16} aria-hidden="true"/></button>
          <span className={styles.dayLabel}>{dayLabels.picker}</span>
          <button type="button" onClick={() => shiftDate(1)} aria-label="Next day" className={styles.dayButton}><ArrowRight size={16} aria-hidden="true"/></button>
        </div>
        <button type="button" onClick={() => openLog()} className={`fitx-button ${styles.logButton}`}><Plus size={17} aria-hidden="true"/>Log food</button>
      </>}/>

      <DayOverview summaryLabel={dayLabels.summary} heading={dayLabels.heading} totals={totals} target={target} targetSource={targetSourceText}
        hasOwnTargets={Boolean(manualTargets)} estimateCount={estimateCount} onTargets={() => setTargetsOpen(true)}
        water={{ ml: waterMl, target: waterTarget, busy, goalHref: homePanel("goals", { new: "water_day" }), onAdd: (ml) => void addWater(ml) }}/>

      {!logOpen && <form onSubmit={(event) => void quickSearch(event)} className={styles.quick} role="search" aria-label="Quick add">
        <Search size={18} aria-hidden="true" className={styles.quickIcon}/>
        <input className={styles.quickInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search food, e.g. 3 idli" aria-label="Search foods" enterKeyHint="search"/>
        <button type="submit" className={styles.quickGo} aria-label="Search food"><ArrowRight size={17} aria-hidden="true"/></button>
        <button type="button" className={styles.quickScan} onClick={() => { openLog({ mode: "barcode" }); setScannerOpen(true); }} aria-label="Scan a barcode"><ScanBarcode size={18} aria-hidden="true"/></button>
      </form>}

      <nav aria-label="Nutrition sections" className={styles.tabs}>
        {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined} className={styles.tab}>{label}</button>)}
      </nav>
      {!logOpen && messages}

      <div className={styles.panel}>
        {tab === "meals" && <MealLog entries={entries} title={dayLabels.diary} loading={loading} busy={busy} templatesReady={capabilities.templates} sections={sections}
          onEdit={setEditingEntry} onDelete={(entry) => void removeMeal(entry)} onLogFood={() => openLog()} onAddTo={(slot) => openLog({ meal: slot })} onCopyYesterday={() => void copyYesterday()}
          onAddSection={() => setNamePrompt({ kind: "section", then: "none" })}
          onSaveMeal={(slot) => setNamePrompt({ kind: "meal", slot, initial: `My ${slot.toLowerCase()}` })}
          onSaveDay={() => setNamePrompt({ kind: "day", initial: `${readableDate(date, { weekday: "long" })} routine` })}/>}
        {tab === "foods" && <MyFoods rows={customRows} loading={loading} busy={busy}
          photoFor={photoFor} onUse={(row) => { chooseFood(customFoodResult(row, photoFor(row))); openLog({ quiet: true }); }} onAdd={() => setFoodForm({ editing: null, prefill: null })}
          onEdit={(row) => setFoodForm({ editing: row, prefill: null })} onRemove={(row) => void removeFood(row)}/>}
        {tab === "routines" && <Routines templates={templates} ready={capabilities.templates} loading={loading} busy={busy} sections={sections} dateLabel={readableDate(date, { month: "short", day: "numeric" })}
          onApply={(template, slot) => void applyTemplate(template, slot)} onDelete={(template) => void removeTemplate(template)}/>}
        {tab === "history" && <NutritionHistory targets={target ? { calories: target.calories, protein: target.protein } : null} targetSource={`${targetSourceText}.`}
          onOpenDay={(key) => { const [year, month, day] = key.split("-").map(Number); setDate(new Date(year, month - 1, day)); setTab("meals"); }}/>}
      </div>

      <Sheet open={logOpen} onClose={closeLog} title="Log food" description={<>To <strong className="font-semibold text-fitx-text">{meal}</strong> · {dayLabels.picker}</>}>
        <div className={styles.sheet}>
          {messages}
          {selected ? (
            <section className={styles.addPanel} aria-labelledby="add-title">
              <div className={styles.addHead}>
                <button type="button" onClick={() => { setSelected(null); setAmountPrompt(null); }} className={styles.back} aria-label="Back to results"><ChevronLeft size={18} aria-hidden="true"/></button>
                <h3 id="add-title" className={styles.addTitle}>Add to log</h3>
              </div>
              {detailFor(selected)}
              <div className={styles.addActions}>
                <button type="button" onClick={() => void logFood(selected)} disabled={busy} className="fitx-button w-full">{busy ? "Saving…" : "Add to log"}</button>
                {selected.kind !== "custom" && <button type="button" onClick={() => saveSelectedAsFood(selected)} className={ui.textButton}>Save to My foods</button>}
              </div>
            </section>
          ) : <>
            <Segmented<LogMode> label="Log by" block value={logMode} onChange={(next) => { setLogMode(next); setError(""); }}
              options={[{ value: "search", label: "Search", icon: <Search size={15} aria-hidden="true"/> }, { value: "barcode", label: "Barcode", icon: <ScanBarcode size={15} aria-hidden="true"/> }]}/>
            {logMode === "search" ? <>
              <form onSubmit={searchFoods} className={styles.search} role="search">
                <Search size={17} aria-hidden="true" className={styles.searchIcon}/>
                <input ref={searchInput} className={styles.searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Food and amount, e.g. 3 idli" aria-label="Search foods" enterKeyHint="search"/>
                <button className={styles.searchGo} disabled={searchingFoods} aria-label="Search food"><ArrowRight size={17} aria-hidden="true"/></button>
              </form>
              {!lastSearch && <div className={styles.suggestions} aria-label="Examples">
                {EXAMPLES.map((term) => <button key={term} type="button" onClick={() => void runFoodSearch(term)} className={styles.suggestion}>{term}</button>)}
              </div>}
              <div className={styles.filters}>
                <label className={styles.filter}><input type="checkbox" checked={dietFilter.nonVeg} onChange={(event) => changeDietFilter({ nonVeg: event.target.checked })}/>Hide non-veg</label>
                <label className={styles.filter}><input type="checkbox" checked={dietFilter.egg} onChange={(event) => changeDietFilter({ egg: event.target.checked })}/>Hide egg</label>
                {lastSearch && searchMode !== "packaged" && <button type="button" className={ui.textButton} disabled={searchingFoods} onClick={() => void runFoodSearch(lastSearch, true)}><PackageSearch size={13} className="mr-1 inline" aria-hidden="true"/>Packaged</button>}
              </div>
              {choosing && <section className={styles.choose} aria-labelledby="choose-title">
                <h3 id="choose-title" className="sr-only">Add to log</h3>
                <p className={styles.chooseTitle}>Choose a food</p>
                <p className={styles.chooseText}>{pickHint}</p>
              </section>}
              {foodList}
              {visibleSources.length > 0 && !showBrowse && <p className={styles.sources} aria-label="Sources for these results">{visibleSources.map((source) => <span key={source.id} className={source.status === "ok" || source.status === "no_results" ? styles.sourceChip : styles.sourceChipDown}>{sourceText(source)}</span>)}</p>}
              <div className={styles.sheetFoot}>
                <button type="button" onClick={() => { hideLog(); setFoodForm({ editing: null, prefill: null }); }} className={ui.textButton}><Plus size={13} className="mr-1 inline" aria-hidden="true"/>Add your own food</button>
                <Link href="/nutrition/sources" className={ui.textButton}><BookOpen size={13} className="mr-1 inline" aria-hidden="true"/>Sources</Link>
              </div>
            </> : <div className={styles.barcode}>
              <button type="button" className={styles.camera} onClick={() => setScannerOpen(true)}>
                <span className={styles.cameraArt} aria-hidden="true"><ScanBarcode size={30}/></span>
                <span className={styles.cameraText}><strong>Scan with camera</strong><small>Rear camera, autofocus, torch</small></span>
              </button>
              <form onSubmit={findBarcode} className={styles.manual}>
                <label htmlFor="barcode-number" className={styles.manualLabel}>Or type the number under the bars</label>
                <div className={styles.manualRow}>
                  <input id="barcode-number" ref={barcodeInput} className="fitx-field" value={barcode} onChange={(event) => setBarcode(event.target.value.replace(/[^\d\s-]/g, ""))} placeholder="e.g. 8901063010031" aria-label="Barcode number" inputMode="numeric" autoComplete="off"/>
                  <button className="fitx-button shrink-0 px-4" disabled={busy || !barcode.trim()} aria-label="Find barcode">{busy ? "Finding…" : "Find"}</button>
                </div>
              </form>
              {barcodeMiss && <div className={ui.callout}>
                <p>{barcodeMiss.noLabel
                  ? `Open Food Facts knows ${barcodeMiss.code}${barcodeMiss.name ? ` (“${barcodeMiss.name}”)` : ""} but has no nutrition label for it.`
                  : `No product with barcode ${barcodeMiss.code} on Open Food Facts.`} Nothing was guessed.</p>
                <div className={ui.toolbar}>
                  <button type="button" className="fitx-button min-h-11 px-3 text-xs" onClick={() => { hideLog(); setFoodForm({ editing: null, prefill: { barcode: barcodeMiss.code, name: barcodeMiss.name ?? "", origin: "barcode", sourceRef: barcodeMiss.code } }); }}>Create a food</button>
                  <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" onClick={() => { setBarcodeMiss(null); setLogMode("search"); window.setTimeout(() => searchInput.current?.focus(), 60); }}>Search by name</button>
                  <a className={ui.textButton} href={`https://world.openfoodfacts.org/product/${barcodeMiss.code}`} target="_blank" rel="noopener noreferrer">Add to Open Food Facts</a>
                </div>
              </div>}
            </div>}
          </>}
        </div>
      </Sheet>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={onBarcodeDetected} onManual={typeBarcode}/>

      {editingEntry && <EntryEditor entry={editingEntry} busy={busy} sections={sections} onCancel={() => setEditingEntry(null)} onSave={(change) => void saveEntry(editingEntry, change)}/>}
      {foodForm && <CustomFoodForm editing={foodForm.editing} prefill={foodForm.prefill} photoUrl={photoFor(foodForm.editing ?? undefined)} v2={capabilities.customFoodsV2} busy={busy} onCancel={() => { setFoodForm(null); restoreLog(); }} onSave={(input, photo, removePhoto) => void saveFood(input, photo, removePhoto)}/>}
      {namePrompt && <NameDialog title={namePrompt.kind === "section" ? "Add a meal" : namePrompt.kind === "meal" ? `Save ${namePrompt.slot.toLowerCase()} as a meal` : "Save this day as a routine"}
        description={namePrompt.kind === "section" ? "Such as Pre-workout or Evening tea." : namePrompt.kind === "meal" ? "Its foods and amounts are copied for any day." : "Every meal of this day, to add again in one tap."}
        label={namePrompt.kind === "section" ? "Meal name" : "Name"} maxLength={namePrompt.kind === "section" ? 40 : 80}
        validate={namePrompt.kind === "section" ? (value) => { const checked = checkSectionName(value); return checked.ok ? null : checked.reason; } : undefined}
        initial={namePrompt.kind === "section" ? "" : namePrompt.initial} busy={busy} onCancel={() => { setNamePrompt(null); restoreLog(); }} onSave={(name) => void saveNamed(name)}/>}
      {householdOpen && <HouseholdMeasures sizes={household} onCancel={() => { setHouseholdOpen(false); restoreLog(); }}
        onSave={(sizes) => { saveHousehold(sizes); setHousehold(sizes); setHouseholdOpen(false); restoreLog(); }}/>}
      {targetsOpen && <TargetsEditor estimated={estimated} manual={manualTargets} ready={capabilities.targets} busy={busy} onClose={() => setTargetsOpen(false)}
        onSave={(next) => void updateTargets(next)} onReset={() => void updateTargets(null)}/>}
    </div>
  );
}
