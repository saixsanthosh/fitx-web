"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ListChecks, PackageSearch, Plus, ScanBarcode, Search } from "lucide-react";
import { progressGoals } from "@/config/routes";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
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
import { NutritionSetup, type SetupMode } from "@/components/nutrition/NutritionSetup";
import type { AmountPrompt } from "@/components/nutrition/PortionPicker";
import { Routines } from "@/components/nutrition/Routines";
import { TargetsEditor } from "@/components/nutrition/TargetsEditor";
import ui from "@/components/nutrition/FoodUi.module.css";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { useHydrated } from "@/components/ui/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { loadGoals } from "@/lib/data/goals";
import { dailyGoalFor, type GoalView } from "@/lib/domain/goals";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { legacyDietaryPreferences, profileAge } from "@/lib/domain/profile-options";
import { loadBirthDate, notifyUserContextChanged } from "@/lib/domain/user-context";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { amountAfterUnitChange, amountProblemMessage, askForGramsMessage, describePortion, extraPortions, formatAmount, parseFoodQuery, resolvePortion, type HouseholdMl } from "@/lib/domain/food-query";
import type { FoodPortion, ParsedFoodQuery } from "@/lib/domain/food-query";
import { checkSectionName, mealForOpen, mealSections } from "@/lib/domain/meal-time";
import { estimateNutritionTargets, resolveDayTargets, resolveWaterTarget, scaleMacros, sumKnown } from "@/lib/domain/nutrition";
import { dayLoadState } from "@/lib/domain/nutrition-day";
import { barcodeProblem, checkBarcode } from "@/lib/food/barcode";
import { dietFilterFor, hiddenByDiet, type DietFilter } from "@/lib/food/diet";
import { signedPhotoUrls, uploadFoodPhoto } from "@/lib/food/food-photos";
import { loadHousehold, saveHousehold } from "@/lib/food/household-storage";
import { searchOutcome } from "@/lib/food/search-outcome";
import { initialSetupAnswers, loadSetupState, readSnooze, saveSetup, snoozed, writeSnooze, type NutritionSetupAnswers } from "@/lib/food/setup";
import { unsourcedFor } from "@/lib/food/unsourced";
import {
  buildMealValues, sameMeal, clearTargets, customFoodResult, deleteTemplate, detectCapabilities, entryUpdate, foodFromEntry, frequentFromEntries, insertEntries, isEstimateSnapshot, loadCustomFoods,
  loadRecentFoods, loadRecentMeals, loadSavedFrom, loadTargets, loadTemplates, MEAL_COLUMNS, removeCustomFood, removeCustomFoodPhoto, rowsFromItems, saveCustomFood,
  saveTargets, saveTemplate, sourceOf, usualAmount, withCurrentCustomFoods, type CustomFoodInput, type CustomFoodRow, type FrequentFood, type ManualTargets, type MealEntry,
  type MealTemplate, type NutritionCapabilities, type SavedFrom,
} from "@/lib/food/client-data";
import { servingToSave } from "@/lib/food/saved-foods";
import { customFoodSaveProblem, type CustomFoodSaveProblem } from "@/lib/food/custom-food-form";
import { addedUndoRegistry, RESTORE_COLUMNS, restoreRow, undoAddedMessage, type RemovedEntry } from "@/lib/food/meal-undo";
import { amountProblem, barcodeMissFor, barcodeMissText, listedFoods, noSearchReason, startView, type BarcodeMiss, type BrowseList } from "@/lib/food/log-sheet";
import type { FoodResult, FoodSearchResponse, SourceStatus } from "@/lib/food/types";
import { copyDayMessages, dayActionLabels, nutritionDayLabels } from "./day-labels";
import styles from "./Nutrition.module.css";

type Profile = { age: number | null; gender: string | null; height: number | null; weight: number | null };
type Prefs = { activity_level: string; primary_goal: string; daily_water_goal_ml: number; dietary_preferences: string[] | null; nutrition_focus?: string | null };

const PREF_COLUMNS = "activity_level,primary_goal,daily_water_goal_ml,dietary_preferences";
/** The preferences Nutrition reads; the nutrition goal (onboarding v3, migration #41) only where the column exists. */
async function loadPrefs(supabase: NonNullable<ReturnType<typeof createClient>>, uid: string) {
  const newer = await supabase.from("user_preferences").select(`${PREF_COLUMNS},nutrition_focus`).eq("user_id", uid).maybeSingle();
  if (!newer.error || !isMissingColumnError(newer.error)) return newer;
  return supabase.from("user_preferences").select(PREF_COLUMNS).eq("user_id", uid).maybeSingle();
}
type Tab = "meals" | "foods" | "routines" | "history";
type LogMode = "search" | "barcode";
type NamePrompt = { kind: "meal"; slot: string; initial: string } | { kind: "day"; initial: string } | { kind: "section"; then: "sheet" | "none" };

const EXAMPLES = ["3 idli", "2 roti", "150 g rice", "1 cup dal", "2 eggs"];
const NO_AMOUNT = parseFoodQuery("");
const NO_CAPABILITIES: NutritionCapabilities = { customFoodsV2: false, templates: false, targets: false, customExtra: false };
/** Search answers hold the user's own foods, so the browser must not answer from its cache. */
const SEARCH_FETCH: RequestInit = { cache: "no-store" };
/** Where Nutrition's "Set a water goal" goes: the goal editor on Progress, on the daily water template. */
const WATER_GOAL_HREF = progressGoals({ new: "water_day" });

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
  /** The catalogue foods the member's own foods were copied from: their measures and diet labels still apply. */
  const [savedFrom, setSavedFrom] = useState<SavedFrom>(() => new Map());
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
  /** The browse list, kept so the sheet can go back to its start view without asking again. */
  const [browse, setBrowse] = useState<BrowseList | null>(null);
  /** Add to log was pressed with an amount that can't be logged: its problem shows next to the amount while it lasts. */
  const [amountTried, setAmountTried] = useState(false);
  /** The meal the open Log food adds to; set each time it opens (mealForOpen). */
  const [meal, setMeal] = useState<string>("Breakfast");
  /** A meal just added from the Meals tab ("Add a meal"): the next Log food opens on it, that once. */
  const pendingMeal = useRef<string | null>(null);
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
  /** The control in Log food that opened that dialog (its id), and, once the sheet is back, the one to focus again. */
  const returnFocus = useRef<string | null>(null);
  const [logFocus, setLogFocus] = useState<string | null>(null);
  /** Where focus goes once the day has reloaded, when the control that had it was replaced or removed: the first found. */
  const pendingFocus = useRef<string[] | null>(null);
  /** Foods removed from the day, each with an Undo in its place; and which "Added …" toast can still take back what. */
  const [removed, setRemoved] = useState<RemovedEntry[]>([]);
  const addedUndo = useRef(addedUndoRegistry());
  /** What opened Log food, and the Log food button: where the focus goes back when the sheet closes. */
  const logOpener = useRef<HTMLElement | null>(null);
  const logButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** "Tap the one you mean": a typed amount matched more than one food. */
  const [pickHint, setPickHint] = useState("");
  const [loading, setLoading] = useState(true);
  /** Each load's number, so a load that a newer one replaced sets nothing (load). */
  const loadSeq = useRef(0);
  /** The day whose meals, water and targets the page holds, and the day whose last load failed (dayLoadState). */
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("meals");
  // Home's "Scan a barcode" link: open Log food on Barcode with the camera, then put the address back to /nutrition.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scan") !== "1") return;
    void Promise.resolve().then(() => {
      setLogMode("barcode");
      setMeal(mealForOpen(null, null, new Date()));
      setLogOpen(true);
      setScannerOpen(true);
      window.history.replaceState(null, "", "/nutrition");
    });
  }, []);
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null);
  /** The food form: editing one of the member's foods, or a new one (`source`: the catalogue food it copies). */
  const [foodForm, setFoodForm] = useState<{ editing: CustomFoodRow | null; prefill: CustomFoodPrefill | null; source?: FoodResult | null } | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const context = useOptionalUserContext()?.data ?? null;
  /** The first-time setup (or its later edit): asked once, when no answer is saved and "Later" is not in force. */
  const [setup, setSetup] = useState<{ open: boolean; mode: SetupMode }>({ open: false, mode: "first" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const setupChecked = useRef(false);
  const dateKey = localDateKey(date);

  const load = useCallback(async () => {
    // A newer load (another day, or a reload after a save) replaces this one: a replaced load sets nothing.
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    const fail = (message: string) => {
      if (!current()) return;
      setError(message);
      setFailedKey(dateKey);
      setLoading(false);
    };
    setLoading(true);
    const supabase = createClient();
    if (!supabase) return fail("Nutrition tracking is not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!current()) return;
    if (!auth.user) return fail("Sign in to track food and water.");
    const uid = auth.user.id;
    setUserId(uid);
    // Once per page view: a member who has not answered the food questions (and did not choose Later on this
    // device in the last few days) gets the setup. A read that fails never asks again by mistake.
    if (!setupChecked.current) {
      setupChecked.current = true;
      void loadSetupState(supabase, uid).then((state) => {
        if (!state.done && !snoozed(readSnooze(uid), localDateKey())) setSetup({ open: true, mode: "first" });
      }, () => undefined);
    }
    // Every read at once (one round trip): which v2 features exist only decides what the editors and routines offer.
    const [caps, mealResult, waterResult, profileResult, prefsResult, custom, targets, savedTemplates, goalViews, birthDate] = await Promise.all([
      detectCapabilities(supabase),
      supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", uid).eq("date", dateKey).order("created_at", { ascending: true }),
      supabase.from("water_logs").select("amount_ml").eq("user_id", uid).eq("local_date", dateKey),
      supabase.from("profiles").select("age,gender,height,weight").eq("id", uid).maybeSingle(),
      loadPrefs(supabase, uid),
      loadCustomFoods(supabase, uid).then(async (rows) => ({ ...rows, savedFrom: await loadSavedFrom(supabase, rows.rows) })),
      // Both read nothing (null, []) when their table is missing.
      loadTargets(supabase, uid),
      loadTemplates(supabase, uid),
      // Daily calorie and protein goals come first, as on Home, so both pages show the same "kcal left".
      loadGoals(supabase, uid, dateKey).then((result) => result.goals).catch(() => null),
      // The stored age is only refreshed when the profile is saved; the birth date keeps it right after a birthday.
      loadBirthDate(supabase, uid),
    ]);
    if (!current()) return;
    setCapabilities(caps);
    const failure = [mealResult.error, waterResult.error, profileResult.error, prefsResult.error].find(Boolean) ?? (custom.error ? new Error("custom foods") : null);
    if (failure) return fail("Your nutrition data could not be loaded. Please try again.");
    setEntries((mealResult.data || []) as MealEntry[]);
    setWaterMl(((waterResult.data || []) as Array<{ amount_ml: number }>).reduce((sum: number, row) => sum + Number(row.amount_ml || 0), 0));
    const prefs = prefsResult.data as Prefs | null;
    setWaterGoal(prefs?.daily_water_goal_ml && prefs.daily_water_goal_ml > 0 ? prefs.daily_water_goal_ml : null);
    const profile = (profileResult.data || {}) as Profile;
    setEstimated(estimateNutritionTargets({ ...profile, age: profileAge({ age: profile.age, date_of_birth: birthDate }) }, prefs?.activity_level, prefs?.primary_goal, prefs?.nutrition_focus ?? null));
    if (!dietFilterSet.current) { dietFilterSet.current = true; setDietFilter(dietFilterFor(prefs?.dietary_preferences)); }
    setCustomRows(custom.rows);
    setSavedFrom(custom.savedFrom);
    setManualTargets(caps.targets ? targets : null);
    setDailyGoals(goalViews);
    setTemplates(caps.templates ? savedTemplates : []);
    // This day's figures are in: the overview and meals may show them now.
    setShownKey(dateKey);
    setFailedKey(null);
    setError("");
    setLoading(false);
    // Photo links don't hold up the day: signed afterwards.
    if (caps.customFoodsV2) {
      void signedPhotoUrls(supabase, custom.rows.map((row) => row.image_path ?? "")).then((urls) => { if (current()) setPhotoUrls(urls); }, () => undefined);
    }
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
  // The member's own katori and bowl sizes, read once in the browser (never on the server).
  useEffect(() => {
    const timer = window.setTimeout(() => setHousehold(loadHousehold()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  /** Whether the day shown at the top has its own figures yet; until then the overview and meals say they are loading. */
  const dayState = dayLoadState(shownKey, failedKey, dateKey);
  /** This day's entries: none until they have loaded, so another day's never show under this day's date. */
  const dayEntries = useMemo(() => (dayState === "ready" ? entries : []), [dayState, entries]);
  const totals = useMemo(() => sumKnown(dayEntries), [dayEntries]);
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
  /** What the sheet lists: the browse list on its start view, else what the search or barcode lookup found. */
  const listed = listedFoods({ searchMode, results }, browse);
  const shownResults = listed.filter((food) => !hiddenByDiet(food.dietType, dietFilter));
  const hiddenCount = listed.length - shownResults.length;

  const photoFor = useCallback((row: CustomFoodRow | undefined) => (row?.image_path ? photoUrls.get(row.image_path) ?? null : null), [photoUrls]);
  /** One of the member's own foods as the Log food sheet uses it: with its photo and what it keeps from the catalogue. */
  const savedFood = useCallback((row: CustomFoodRow) => customFoodResult(row, photoFor(row), sourceOf(row, savedFrom)), [photoFor, savedFrom]);
  /** Recent foods, with your own foods as saved now (edits apply, deleted ones drop out), through the diet filter. */
  const shownRecent = useMemo(
    () => withCurrentCustomFoods(recentFoods, customRows, photoFor, savedFrom).filter((food) => !hiddenByDiet(food.dietType, dietFilter)),
    [recentFoods, customRows, photoFor, savedFrom, dietFilter],
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
    // Undo for a removed food, and what the last action said, last until the member moves on to another day.
    setRemoved([]);
    setNotice("");
    setError("");
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
    setAmountTried(false);
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
      setUnitKey(index >= 0 ? `portion:${index}` : "g");
      if (typed.problem) {
        // "0 idli" or "-2 idli": no amount is assumed; the panel says why and waits for one.
        setAmount("");
        setAmountPrompt({ message: amountProblemMessage(typed.problem, false), actions: [] });
      } else setAmount(index >= 0 ? "1" : "100");
    }
  }, [household]);

  const lookupBarcode = useCallback(async (value: string) => {
    const checked = checkBarcode(value);
    if (!checked.ok) { setError(barcodeProblem(checked.reason)); return; }
    // Trying the same barcode again keeps its answer on screen (and its Try again button under the focus) until the new one.
    setBusy(true); setError(""); setNotice(""); setBarcodeMiss((miss) => (miss?.code === checked.code ? miss : null));
    try {
      const response = await fetch(`/api/foods/search?barcode=${encodeURIComponent(checked.code)}`, SEARCH_FETCH);
      const data = (await response.json()) as FoodSearchResponse;
      if (!response.ok) throw new Error(data.error || "Barcode lookup failed.");
      setResults(data.foods || []);
      setSources(data.sources || []);
      setSearchMode("barcode");
      setLastQuery(NO_AMOUNT);
      if (data.foods?.length) {
        chooseFood(data.foods[0]);
        // The barcode controls make way for the product: its amount takes the focus.
        window.setTimeout(() => document.getElementById("log-portion-amount")?.focus({ preventScroll: true }), 60);
      } else if (data.barcodeStatus === "invalid") { setBarcodeMiss(null); setError(data.error || barcodeProblem("check-digit")); }
      // Unknown, no label, or not checked (busy, no answer): each says why and offers to add the product with this barcode.
      else { setSelected(null); setBarcodeMiss(barcodeMissFor(data.barcodeStatus, checked.code, data.productName)); }
    } catch (cause) { setBarcodeMiss(null); setError(cause instanceof Error ? cause.message : "Barcode lookup failed."); }
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
      // Listed whenever the sheet shows its start view (listedFoods), never over a search typed meanwhile.
      setBrowse({ foods: data.foods || [], sources: data.sources || [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }, []);

  /**
   * Back to the start view (Frequent, Recent and the browse list), with nothing left of an earlier search or barcode
   * lookup: no old results, source counts, choice or barcode answer.
   */
  function showStart() {
    const view = startView();
    setResults(view.results);
    setSources(view.sources);
    setSearchMode(view.searchMode);
    setLastSearch(view.lastSearch);
    setLastQuery(view.lastQuery);
    setSelected(null); setDerived(null); setAmountPrompt(null); setAmountTried(false); setPickHint(""); setBarcodeMiss(null);
    if (!browse) void browseFoods();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void browseFoods(); }, 0);
    return () => window.clearTimeout(timer);
  }, [browseFoods]);

  async function runFoodSearch(value: string, packaged = false) {
    setQuery(value);
    const typed = parseFoodQuery(value);
    if (typed.text.length < 2) {
      // Nothing to search for ("", "???", "150 g"): the start view, never an earlier search's results or messages.
      showStart();
      setError(""); setNotice("");
      const reason = noSearchReason(typed, value);
      if (reason?.kind === "error") setError(reason.message);
      else if (reason) setNotice(reason.message);
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
      }
      // Select the food that is clearly meant, or ask which one (keeping the amount, or saying why it can't be used).
      const outcome = searchOutcome(typed, found, data.pick, dietFilter, packaged, data.passedOver);
      if (outcome.kind === "pick") {
        chooseFood(outcome.food, typed);
        // The member's own food of that name couldn't weigh the amount typed: say which food is selected instead.
        if (outcome.note) setNotice(outcome.note);
      } else if (outcome.kind === "choose") {
        setSelected(null);
        setDerived(null);
        setAmountPrompt(null);
        setPickHint(outcome.hint);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }

  async function searchFoods(event: FormEvent) {
    event.preventDefault();
    await runFoodSearch(query);
  }

  async function logFood(food: FoodResult) {
    if (amountProblem(grams)) {
      // Said next to the amount, and only while it is wrong; the amount takes the focus.
      setAmountTried(true);
      window.setTimeout(() => document.getElementById("log-portion-amount")?.focus(), 0);
      return;
    }
    if (loggingFood.current) return;
    loggingFood.current = true;
    try {
      await insertLoggedFood(food);
    } finally {
      loggingFood.current = false;
      setBusy(false);
    }
  }

  /**
   * Takes back rows just added (the Undo button of the toast): deletes them by id, for this member only. Never an entry
   * the member has removed since (or a copy of it put back): those are forgotten, and their toast closed, when removed.
   */
  async function undoAdded(ids: string[], label: string) {
    const supabase = createClient();
    if (!supabase || !userId || !ids.length) return;
    if (!addedUndo.current.canUndo(ids)) { toast(undoAddedMessage(0, label)); return; }
    for (const id of ids) addedUndo.current.forget(id);
    const result = await supabase.from("meals").delete().in("id", ids).eq("user_id", userId).select("id");
    if (result.error) { toast.error("That could not be undone. Remove it from the Meals tab."); return; }
    toast(undoAddedMessage((result.data ?? []).length, label));
    await load();
    void refreshRecent();
  }

  /** Tells the member what was added, with an Undo that removes exactly those rows. */
  function announceAdded(ids: string[], label: string, mealName: string) {
    const toastId = toast.success(`Added ${label} to ${mealName}.`, { action: ids.length ? { label: "Undo", onClick: () => void undoAdded(ids, label) } : undefined, duration: 8000 });
    if (ids.length) addedUndo.current.remember(ids, toastId);
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
    setLogOpen(false); setQuery(""); showStart();
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

  /** A meal chosen in the open sheet: it lasts for this Log food only. */
  function pickMeal(next: string) {
    setMeal(next);
  }

  /**
   * Opens Log food, optionally on a meal (a meal's + in the diary) or on Barcode. Each time it opens it is on that meal,
   * or one just added from the Meals tab, or the one that suits the time of day now: an earlier + never sticks.
   */
  function openLog(options: { meal?: string; mode?: LogMode; quiet?: boolean } = {}) {
    if (!logOpen && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) logOpener.current = document.activeElement;
    if (!logOpen) {
      setMeal(mealForOpen(options.meal, pendingMeal.current, new Date()));
      pendingMeal.current = null;
    } else if (options.meal) setMeal(options.meal);
    setLogMode(options.mode ?? "search");
    setError(""); setNotice("");
    setLogOpen(true);
    // Straight into the search box (the sheet's content mounts with it), as the reference apps do.
    if ((options.mode ?? "search") === "search" && !options.quiet) window.setTimeout(() => searchInput.current?.focus({ preventScroll: true }), 60);
  }

  /** The member closed Log food: the next one starts fresh. */
  function closeLog() {
    setLogOpen(false);
    // The sheet gives the focus back to what opened it; if that is gone (a toast's button) or was the sheet's own
    // way back from another dialog, the control that opened Log food, else the Log food button, takes it.
    const back = logOpener.current;
    window.setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      for (const target of [back, logButton.current]) {
        if (!target?.isConnected) continue;
        target.focus();
        if (document.activeElement === target) return;
      }
    }, 0);
    // The next Log food opens on the start view with an empty search box, not on this search or barcode answer.
    showStart();
    setQuery(""); setBarcode(""); setError(""); setNotice("");
    reopenLog.current = false;
  }

  /**
   * Steps out of Log food for another dialog (measures, a meal name, a new food) and remembers to come back, with the
   * focus on `returnTo`, the control that opened it (the sheet's content is new when it comes back).
   */
  function hideLog(returnTo: string | null = null) {
    reopenLog.current = logOpen;
    returnFocus.current = logOpen ? returnTo : null;
    setLogOpen(false);
  }

  function restoreLog() {
    if (!reopenLog.current) return;
    reopenLog.current = false;
    setLogOpen(true);
    setLogFocus(returnFocus.current);
    returnFocus.current = null;
  }
  // Once the sheet is open again (and has put the focus on its first control), back to the control that stepped out.
  useEffect(() => {
    if (!logOpen || !logFocus) return;
    const timer = window.setTimeout(() => { document.getElementById(logFocus)?.focus(); setLogFocus(null); }, 80);
    return () => window.clearTimeout(timer);
  }, [logOpen, logFocus]);
  // After the day reloads, focus what replaced the control that had it (an entry moved to another meal is a new row,
  // a removed one leaves its Undo), or the next choice when that is not there.
  useEffect(() => {
    const selectors = pendingFocus.current;
    if (!selectors) return;
    pendingFocus.current = null;
    for (const selector of selectors) {
      const target = document.querySelector<HTMLElement>(selector);
      if (target) { target.focus(); return; }
    }
  }, [entries]);

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
    // Only once the day's water total is known, so a total read before the tap can't hide it.
    if (loggingWater.current || dayState !== "ready") return;
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

  /**
   * Removes a logged food. Its row is replaced by "Removed …" with an Undo that puts the same entry back, and the focus
   * moves to that Undo. Its "Added …" toast, if still open, closes: it can no longer take the entry back.
   */
  async function removeMeal(entry: MealEntry) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setError("");
    const result = await supabase.from("meals").delete().eq("id", entry.id).eq("user_id", userId).select(RESTORE_COLUMNS);
    if (result.error) { setError("That food could not be removed. Please try again."); return; }
    const toastId = addedUndo.current.forget(entry.id);
    if (toastId !== undefined) toast.dismiss(toastId);
    const row = ((result.data ?? []) as unknown as Array<Record<string, unknown>>)[0];
    if (row) setRemoved((list) => [...list.filter((item) => item.id !== entry.id), { id: entry.id, date: entry.date, meal: entry.meal, name: entry.food_name, row }]);
    // Its Undo; failing that, its meal's add button, or the day's heading.
    const section = sections.find((slot) => sameMeal(slot, entry.meal)) ?? entry.meal;
    pendingFocus.current = [`[data-undo="${entry.id}"]`, `[data-meal-add="${CSS.escape(section)}"]`, "#meals-title"];
    await load();
    void refreshRecent();
  }

  /** Puts a removed food back exactly as it was (its id and time too), then focuses it. */
  async function undoRemove(item: RemovedEntry) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    const result = await supabase.from("meals").insert(restoreRow(item, userId));
    // 23505: it is back already (a second press): nothing to undo.
    if (result.error && result.error.code !== "23505") {
      setRemoved((list) => list.map((entry) => (entry.id === item.id ? { ...entry, failed: true } : entry)));
      return;
    }
    pendingFocus.current = [`[data-entry-edit="${item.id}"]`, "#meals-title"];
    await load();
    setRemoved((list) => list.filter((entry) => entry.id !== item.id));
    void refreshRecent();
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
    // Its pencil again (a new one when it moved to another meal), or the day's heading when it left this day.
    pendingFocus.current = change.date === entry.date ? [`[data-entry-edit="${entry.id}"]`, "#meals-title"] : ["#meals-title"];
    await load();
  }

  /**
   * Saves a food to My foods only; logging it is a separate step. A refusal is returned to the form, which stays open
   * and shows it there (the page's own messages are behind the dialog).
   */
  async function saveFood(input: CustomFoodInput, photo: File | null, removePhoto: boolean): Promise<CustomFoodSaveProblem | null> {
    const supabase = createClient();
    if (!supabase || !userId) return { field: null, message: "Sign in to save your own foods." };
    const editing = foodForm?.editing ?? null;
    setBusy(true); setError("");
    const { row, error: saveError } = await saveCustomFood(supabase, userId, input, capabilities.customFoodsV2, editing?.id);
    if (saveError || !row) {
      setBusy(false);
      return customFoodSaveProblem(saveError);
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
    if (editing) { setNotice(`Saved changes to “${row.name}”.${photoProblem}`); return null; }
    // Saved, not logged: the toast offers to log it now.
    const saved = customFoodResult(row, photoUrl, sourceOf(row, savedFrom) ?? foodForm?.source ?? null);
    toast.success(`Saved “${row.name}” to My foods.${photoProblem}`, { action: { label: "Log it", onClick: () => { logOpener.current = null; chooseFood(saved); setLogMode("search"); setMeal(mealForOpen(null, null, new Date())); setLogOpen(true); } }, duration: 8000 });
    return null;
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
  function addSection(name: string, then: "sheet" | "none") {
    const checked = checkSectionName(name);
    if (!checked.ok) return;
    const existing = sections.find((item) => item.toLowerCase() === checked.name.toLowerCase());
    const chosen = existing ?? checked.name;
    if (!existing) setAddedSections((old) => [...old, chosen]);
    setNamePrompt(null);
    if (then === "sheet") {
      // Chosen in the open Log food: for this log.
      pickMeal(chosen);
      setNotice(existing ? `“${chosen}” is selected.` : `Added “${chosen}”. It stays once you log something in it.`);
      restoreLog();
      return;
    }
    // From the Meals tab: the next Log food opens on it, that once.
    pendingMeal.current = chosen;
    setNotice(existing ? `The next food you log goes to “${chosen}”.` : `Added “${chosen}”. The next food you log goes to it, and it stays once you log something in it.`);
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

  /** Copies the meals of the day before the day viewed (yesterday, when that is today), naming that day in what it says. */
  async function copyYesterday() {
    const supabase = createClient();
    if (!supabase || !userId) return;
    const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    const says = copyDayMessages(previous, isToday);
    setBusy(true); setError(""); setNotice("");
    const { data, error: readError } = await supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", userId).eq("date", localDateKey(previous)).order("created_at", { ascending: true });
    if (readError) { setBusy(false); setError(says.readFailed); return; }
    const rows = (data ?? []) as MealEntry[];
    if (!rows.length) { setBusy(false); setNotice(says.nothing); return; }
    if (entries.length && !window.confirm(says.confirm(entries.length, rows.length))) { setBusy(false); return; }
    const result = await insertEntries(supabase, rowsFromItems(userId, dateKey, rows, null));
    setBusy(false);
    if (result.error) { setError(says.copyFailed); return; }
    setNotice(says.copied(rows.length));
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
   * re-logged from My foods. The values keep where they came from (USDA lab analysis, a typical recipe, a package label).
   */
  function saveSelectedAsFood(food: FoodResult) {
    // The measure in use (3 idli: "1 item", 38 g) becomes the saved serving; the copy remembers the catalogue food it
    // came from (source_ref), so it keeps that food's other measures and diet label while its values are unchanged.
    const serving = servingToSave(food, chosenPortion);
    hideLog("log-save-food");
    setFoodForm({
      editing: null,
      source: food,
      prefill: {
        name: food.name, brand: food.brand, barcode: food.barcode,
        servingLabel: serving.label,
        servingGrams: serving.grams,
        per100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
        missing: food.missing,
        imageUrl: food.image, imageAttribution: food.imageCredit,
        origin: food.barcode ? "barcode" : "user",
        sourceRef: food.barcode ?? (food.kind === "catalog" && (/^\d+$/.test(food.id) || food.id.startsWith("fitx-recipe-")) ? food.id : null),
        valueBasis: food.valueBasis,
      },
    });
  }

  /** Saves the setup answers; the diet filter in Log food follows the new diet. */
  async function finishSetup(answers: NutritionSetupAnswers) {
    const supabase = createClient();
    if (!supabase || !userId) return;
    setSetupBusy(true); setSetupError("");
    try {
      const saved = await saveSetup(supabase, userId, answers, {
        schema: context?.schema ?? { preferencesV2: true, onboardingV3: true },
        legacyDiet: context?.legacy.dietaryPreferences ?? [],
      });
      if (saved.error) { setSetupError("Your answers could not be saved. Please try again."); return; }
      writeSnooze(userId, null);
      setSetup((current) => ({ ...current, open: false }));
      notifyUserContextChanged();
      if (answers.diet) { dietFilterSet.current = true; setDietFilter(dietFilterFor(legacyDietaryPreferences(answers.diet, []))); }
      toast.success(setup.mode === "first" ? "Nutrition is set up." : "Saved your food preferences.");
    } catch {
      setSetupError("Your answers could not be saved. Please try again.");
    } finally {
      setSetupBusy(false);
    }
  }

  /** "Later": closes the setup on this device for a few days; Food preferences still opens it. */
  function laterSetup() {
    if (userId) writeSnooze(userId, localDateKey());
    setSetup((current) => ({ ...current, open: false }));
  }

  const visibleSources = sources.filter((source) => source.status !== "not_used");
  const estimateCount = dayEntries.filter(isEstimateSnapshot).length;
  const showBrowse = searchMode === "browse";
  const tabs: Array<[Tab, string]> = [["meals", "Meals"], ["foods", "My foods"], ["routines", "Routines"], ["history", "History"]];
  const dayLabels = nutritionDayLabels(hydrated ? date : null);
  /** Whether the day viewed is today: its buttons copy "yesterday" and save "today"; other days' copy "the day before". */
  const isToday = hydrated && dateKey === localDateKey(new Date());
  const actionLabels = dayActionLabels(isToday);
  const unsourced = lastSearch && searchMode !== "packaged" && !searchingFoods ? unsourcedFor(lastSearch, results) : null;
  /** A typed amount matched more than one food: the Add to log panel asks which one, and keeps the amount. */
  const choosing = !selected && Boolean(pickHint);

  /** The chosen food's amount and meal, in the Add to log panel of the sheet. */
  function detailFor(food: FoodResult) {
    return <FoodDetail food={food} amount={amount} unitKey={unitKey} options={portionOptions} chosen={chosenPortion} grams={grams} macros={selectedMacros}
      prompt={amountPrompt} onAmount={(value) => { setAmount(value); setAmountPrompt(null); }} onUnit={changeUnit}
      onMeasures={() => { hideLog("log-portion-measures"); setHouseholdOpen(true); }}
      sections={sections} meal={meal} onMeal={pickMeal} onAddSection={() => { hideLog("log-portion-meal"); setNamePrompt({ kind: "section", then: "sheet" }); }}
      mealControl="select" idPrefix="log-portion" amountProblem={amountTried ? amountProblem(grams) : null}/>;
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
            <button type="button" id="log-create-food" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" onClick={() => { hideLog("log-create-food"); setFoodForm({ editing: null, prefill: { name: parseFoodQuery(lastSearch).text.replace(/^./, (letter) => letter.toUpperCase()) } }); }}>Create a food</button>
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
      <PageHeader title="Nutrition" actions={
        <div className={styles.day} role="group" aria-label="Day">
          <button type="button" onClick={() => shiftDate(-1)} aria-label="Previous day" className={styles.dayButton}><ArrowLeft size={16} aria-hidden="true"/></button>
          <span className={styles.dayLabel}>{dayLabels.picker}</span>
          <button type="button" onClick={() => shiftDate(1)} aria-label="Next day" className={styles.dayButton}><ArrowRight size={16} aria-hidden="true"/></button>
        </div>
      }/>

      <div className={styles.top}>
        <DayOverview summaryLabel={dayLabels.summary} heading={dayLabels.heading} state={dayState} totals={totals} target={target} targetSource={targetSourceText}
          hasOwnTargets={Boolean(manualTargets)} estimateCount={estimateCount} onTargets={() => setTargetsOpen(true)}
          water={{ ml: waterMl, target: waterTarget, busy, goalHref: WATER_GOAL_HREF, onAdd: (ml) => void addWater(ml) }}/>

        <div className={styles.actions}>
          <button ref={logButton} type="button" onClick={() => openLog()} className={`fitx-button ${styles.logButton}`}><Plus size={19} aria-hidden="true"/>Log food</button>
          {/* Hidden, not removed, while Log food is open: it opened the sheet, so the focus can come back to it. */}
          <form hidden={logOpen} onSubmit={(event) => void quickSearch(event)} className={styles.quick} role="search" aria-label="Quick add">
            <Search size={18} aria-hidden="true" className={styles.quickIcon}/>
            <input className={styles.quickInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="3 idli, 150 g rice, 200 ml milk" aria-label="Search foods" enterKeyHint="search"/>
            <button type="submit" className={styles.quickGo} aria-label="Search food"><ArrowRight size={17} aria-hidden="true"/></button>
          </form>
          <div className={styles.shortcuts}>
            <button type="button" className={styles.shortcut} onClick={() => { openLog({ mode: "barcode" }); setScannerOpen(true); }} aria-label="Scan a barcode"><ScanBarcode size={18} aria-hidden="true"/><span>Scan</span></button>
            <button type="button" className={styles.shortcut} onClick={() => openLog({ quiet: true })}><BookOpen size={18} aria-hidden="true"/><span>Food database</span></button>
            <button type="button" className={styles.shortcut} onClick={() => { setSetupError(""); setSetup({ open: true, mode: "edit" }); }}><ListChecks size={18} aria-hidden="true"/><span>Food preferences</span></button>
          </div>
        </div>
      </div>

      <nav aria-label="Nutrition sections" className={styles.tabs}>
        {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined} className={styles.tab}>{label}</button>)}
      </nav>
      {!logOpen && messages}

      <div className={styles.panel}>
        {tab === "meals" && <MealLog entries={dayEntries} title={dayLabels.diary} labels={actionLabels} state={dayState} busy={busy} templatesReady={capabilities.templates} sections={sections}
          onEdit={setEditingEntry} onDelete={(entry) => void removeMeal(entry)} removed={removed.filter((item) => item.date === dateKey)} onUndoRemove={(item) => void undoRemove(item)} onLogFood={() => openLog()} onAddTo={(slot) => openLog({ meal: slot })} onCopyYesterday={() => void copyYesterday()}
          onAddSection={() => setNamePrompt({ kind: "section", then: "none" })}
          onSaveMeal={(slot) => setNamePrompt({ kind: "meal", slot, initial: `My ${slot.toLowerCase()}` })}
          onSaveDay={() => setNamePrompt({ kind: "day", initial: `${readableDate(date, { weekday: "long" })} routine` })}/>}
        {tab === "foods" && <MyFoods rows={customRows} loading={loading} busy={busy}
          photoFor={photoFor} onUse={(row) => { chooseFood(savedFood(row)); openLog({ quiet: true }); }} onAdd={() => setFoodForm({ editing: null, prefill: null })}
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
                <button type="button" onClick={() => { setSelected(null); setAmountPrompt(null); setAmountTried(false); setNotice(""); }} className={styles.back} aria-label="Back to results"><ChevronLeft size={18} aria-hidden="true"/></button>
                <h3 id="add-title" className={styles.addTitle}>Add to log</h3>
              </div>
              {detailFor(selected)}
              <div className={styles.addActions}>
                <button type="button" onClick={() => void logFood(selected)} disabled={busy} className="fitx-button w-full">{busy ? "Saving…" : "Add to log"}</button>
                {selected.kind !== "custom" && <button type="button" id="log-save-food" onClick={() => saveSelectedAsFood(selected)} className={ui.textButton}>Save to My foods</button>}
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
                <p role="status" className={styles.chooseText}>{pickHint}</p>
              </section>}
              {foodList}
              {visibleSources.length > 0 && !showBrowse && <p className={styles.sources} aria-label="Sources for these results">{visibleSources.map((source) => <span key={source.id} className={source.status === "ok" || source.status === "no_results" ? styles.sourceChip : styles.sourceChipDown}>{sourceText(source)}</span>)}</p>}
              <div className={styles.sheetFoot}>
                <button type="button" id="log-add-food" onClick={() => { hideLog("log-add-food"); setFoodForm({ editing: null, prefill: barcodeMiss ? { barcode: barcodeMiss.code, name: barcodeMiss.name ?? "", origin: "barcode", sourceRef: barcodeMiss.code } : null }); }} className={ui.textButton}><Plus size={13} className="mr-1 inline" aria-hidden="true"/>Add your own food</button>
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
              {barcodeMiss && (() => {
                // Every miss (unknown, no label, or not checked because Open Food Facts was busy or didn't answer) offers
                // to add the product with this barcode filled in; one not checked also offers to try again.
                const said = barcodeMissText(barcodeMiss);
                return <div className={ui.callout}>
                  <p role="status">{said.text}</p>
                  <div className={ui.toolbar}>
                    <button type="button" id="log-barcode-create" className="fitx-button min-h-11 px-3 text-xs" onClick={() => { hideLog("log-barcode-create"); setFoodForm({ editing: null, prefill: { barcode: barcodeMiss.code, name: barcodeMiss.name ?? "", origin: "barcode", sourceRef: barcodeMiss.code } }); }}>Create a food</button>
                    {said.retry && <button type="button" className={`fitx-button fitx-button-secondary min-h-11 px-3 text-xs ${ui.actionBusy}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) void lookupBarcode(barcodeMiss.code); }}>{busy ? "Checking…" : "Try again"}</button>}
                    <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-3 text-xs" onClick={() => { setBarcodeMiss(null); setLogMode("search"); window.setTimeout(() => searchInput.current?.focus(), 60); }}>Search by name</button>
                    {said.addToOpenFoodFacts && <a className={ui.textButton} href={`https://world.openfoodfacts.org/product/${barcodeMiss.code}`} target="_blank" rel="noopener noreferrer">Add to Open Food Facts</a>}
                  </div>
                </div>;
              })()}
            </div>}
          </>}
        </div>
      </Sheet>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={onBarcodeDetected} onManual={typeBarcode}/>

      {editingEntry && <EntryEditor entry={editingEntry} busy={busy} sections={sections} onCancel={() => setEditingEntry(null)} onSave={(change) => void saveEntry(editingEntry, change)}/>}
      {foodForm && <CustomFoodForm editing={foodForm.editing} prefill={foodForm.prefill} photoUrl={photoFor(foodForm.editing ?? undefined)} v2={capabilities.customFoodsV2} busy={busy} onCancel={() => { setFoodForm(null); restoreLog(); }} onSave={saveFood}/>}
      {namePrompt && <NameDialog title={namePrompt.kind === "section" ? "Add a meal" : namePrompt.kind === "meal" ? `Save ${namePrompt.slot.toLowerCase()} as a meal` : "Save this day as a routine"}
        description={namePrompt.kind === "section" ? "Such as Pre-workout or Evening tea." : namePrompt.kind === "meal" ? "Its foods and amounts are copied for any day." : "Every meal of this day, to add again in one tap."}
        label={namePrompt.kind === "section" ? "Meal name" : "Name"} maxLength={namePrompt.kind === "section" ? 40 : 80}
        validate={namePrompt.kind === "section" ? (value) => { const checked = checkSectionName(value); return checked.ok ? null : checked.reason; } : undefined}
        initial={namePrompt.kind === "section" ? "" : namePrompt.initial} busy={busy} onCancel={() => { setNamePrompt(null); restoreLog(); }} onSave={(name) => void saveNamed(name)}/>}
      {householdOpen && <HouseholdMeasures sizes={household} onCancel={() => { setHouseholdOpen(false); restoreLog(); }}
        onSave={(sizes) => { saveHousehold(sizes); setHousehold(sizes); setHouseholdOpen(false); restoreLog(); }}/>}
      <NutritionSetup open={setup.open} mode={setup.mode} busy={setupBusy} error={setupError}
        initial={initialSetupAnswers(context?.hasPreferences ? context.preferences : null)}
        onSave={(answers) => void finishSetup(answers)} onLater={laterSetup} onClose={() => setSetup((current) => ({ ...current, open: false }))}/>
      {targetsOpen && <TargetsEditor estimated={estimated} manual={manualTargets} ready={capabilities.targets} busy={busy} onClose={() => setTargetsOpen(false)}
        onSave={(next) => void updateTargets(next)} onReset={() => void updateTargets(null)}/>}
    </div>
  );
}
