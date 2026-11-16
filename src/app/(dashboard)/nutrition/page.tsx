"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Barcode, BookOpen, Droplets, PackageSearch, Search, Target, X } from "lucide-react";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { CustomFoodForm, type CustomFoodPrefill } from "@/components/nutrition/CustomFoodForm";
import { EntryEditor, type EntryChange } from "@/components/nutrition/EntryEditor";
import { BasisBadge, DietBadge, StateTag } from "@/components/nutrition/FoodBadges";
import { FoodResultCard } from "@/components/nutrition/FoodResultCard";
import { isEstimateEntry, MealLog } from "@/components/nutrition/MealLog";
import { MyFoods } from "@/components/nutrition/MyFoods";
import { NameDialog } from "@/components/nutrition/NameDialog";
import { PortionPicker, type AmountPrompt } from "@/components/nutrition/PortionPicker";
import { Routines } from "@/components/nutrition/Routines";
import { TargetsEditor } from "@/components/nutrition/TargetsEditor";
import ui from "@/components/nutrition/FoodUi.module.css";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { amountAfterUnitChange, askForGramsMessage, describePortion, describeTypedAmount, formatAmount, parseFoodQuery, resolvePortion } from "@/lib/domain/food-query";
import type { FoodPortion, ParsedFoodQuery } from "@/lib/domain/food-query";
import { estimateNutritionTargets, goalPercent, goalProgress, scaleMacros, sumMacros } from "@/lib/domain/nutrition";
import { barcodeProblem, checkBarcode } from "@/lib/food/barcode";
import { signedPhotoUrls, uploadFoodPhoto } from "@/lib/food/food-photos";
import {
  clearTargets, customFoodResult, deleteTemplate, detectCapabilities, entryUpdate, insertEntries, loadCustomFoods,
  loadRecentFoods, loadTargets, loadTemplates, MEAL_COLUMNS, MEAL_SLOTS, removeCustomFood, rowsFromItems, saveCustomFood, saveTargets,
  saveTemplate, type CustomFoodInput, type CustomFoodRow, type ManualTargets, type MealEntry, type MealSlot, type MealTemplate,
  type NutritionCapabilities,
} from "@/lib/food/client-data";
import type { FoodResult, FoodSearchResponse, SourceStatus } from "@/lib/food/types";
import styles from "./Nutrition.module.css";

type Profile = { age: number | null; gender: string | null; height: number | null; weight: number | null };
type Prefs = { activity_level: string; primary_goal: string; daily_water_goal_ml: number; dietary_preferences: string[] | null };
/** A volume weight worked out from another USDA measure, such as 1 teaspoon from the tablespoon. */
type DerivedPortion = { portion: FoodPortion; from: FoodPortion };
type Tab = "log" | "meals" | "foods" | "routines" | "insights";
type NamePrompt = { kind: "meal"; slot: MealSlot; initial: string } | { kind: "day"; initial: string };
type BarcodeMiss = { code: string; name: string | null; noLabel: boolean };

const EXAMPLES = ["3 idli", "150 g rice", "2 roti", "1 cup dal", "2 eggs"];
const NO_AMOUNT = parseFoodQuery("");
const NO_CAPABILITIES: NutritionCapabilities = { customFoodsV2: false, templates: false, targets: false };

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
  const [userId, setUserId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<NutritionCapabilities>(NO_CAPABILITIES);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [customRows, setCustomRows] = useState<CustomFoodRow[]>([]);
  /** Signed links to the user's own food photos, by storage path. */
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(() => new Map());
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [recentFoods, setRecentFoods] = useState<FoodResult[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(2500);
  const [estimated, setEstimated] = useState<ReturnType<typeof estimateNutritionTargets>>(null);
  const [manualTargets, setManualTargets] = useState<ManualTargets | null>(null);
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState<ParsedFoodQuery>(NO_AMOUNT);
  const [lastSearch, setLastSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<FoodResult[]>([]);
  const [searchMode, setSearchMode] = useState<FoodSearchResponse["mode"]>("browse");
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [searchingFoods, setSearchingFoods] = useState(true);
  const [hideNonVeg, setHideNonVeg] = useState(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [amount, setAmount] = useState("100");
  const [unitKey, setUnitKey] = useState("g");
  const [derived, setDerived] = useState<DerivedPortion | null>(null);
  const [amountPrompt, setAmountPrompt] = useState<AmountPrompt | null>(null);
  const [barcodeMiss, setBarcodeMiss] = useState<BarcodeMiss | null>(null);
  const [meal, setMeal] = useState<MealSlot>("Breakfast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("log");
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
    const [mealResult, waterResult, profileResult, prefsResult, custom, targets, savedTemplates] = await Promise.all([
      supabase.from("meals").select(MEAL_COLUMNS).eq("user_id", uid).eq("date", dateKey).order("created_at", { ascending: true }),
      supabase.from("water_logs").select("amount_ml").eq("user_id", uid).eq("local_date", dateKey),
      supabase.from("profiles").select("age,gender,height,weight").eq("id", uid).maybeSingle(),
      supabase.from("user_preferences").select("activity_level,primary_goal,daily_water_goal_ml,dietary_preferences").eq("user_id", uid).maybeSingle(),
      loadCustomFoods(supabase, uid, caps.customFoodsV2),
      caps.targets ? loadTargets(supabase, uid) : Promise.resolve(null),
      caps.templates ? loadTemplates(supabase, uid) : Promise.resolve([]),
    ]);
    const failure = [mealResult.error, waterResult.error, profileResult.error, prefsResult.error].find(Boolean) ?? (custom.error ? new Error("custom foods") : null);
    if (failure) setError("Your nutrition data could not be loaded. Please try again.");
    else {
      setEntries((mealResult.data || []) as MealEntry[]);
      setWaterMl(((waterResult.data || []) as Array<{ amount_ml: number }>).reduce((sum: number, row) => sum + Number(row.amount_ml || 0), 0));
      const prefs = prefsResult.data as Prefs | null;
      setWaterGoal(prefs?.daily_water_goal_ml || 2500);
      setEstimated(estimateNutritionTargets((profileResult.data || {}) as Profile, prefs?.activity_level, prefs?.primary_goal));
      setHideNonVeg((current) => current || (prefs?.dietary_preferences ?? []).some((diet) => /^(veg|vegetarian|vegan|eggetarian)$/i.test(String(diet))));
      setCustomRows(custom.rows);
      if (caps.customFoodsV2) setPhotoUrls(await signedPhotoUrls(supabase, custom.rows.map((row) => row.image_path ?? "")));
      setManualTargets(targets);
      setTemplates(savedTemplates);
      setError("");
    }
    setLoading(false);
  }, [dateKey]);

  const refreshRecent = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) setRecentFoods(await loadRecentFoods(supabase, auth.user.id));
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { void Promise.resolve().then(refreshRecent); }, [refreshRecent]);

  const totals = useMemo(() => sumMacros(entries), [entries]);
  const target = manualTargets ?? estimated;
  const portionOptions = useMemo(() => [...(selected?.portions ?? []), ...(derived ? [derived.portion] : [])], [selected, derived]);
  const chosenPortion = unitKey.startsWith("portion:") ? portionOptions[Number(unitKey.slice("portion:".length))] ?? null : null;
  const amountNumber = amount.trim() ? Number(amount) : Number.NaN;
  const grams = Number.isFinite(amountNumber) ? Math.round(amountNumber * (chosenPortion ? chosenPortion.grams : 1) * 10) / 10 : Number.NaN;
  const selectedMacros = selected && grams > 0 ? scaleMacros(selected, grams) : null;
  const calorieGoal = target ? goalProgress(totals.calories, target.calories) : null;
  const shownResults = hideNonVeg ? results.filter((food) => food.dietType !== "non_veg") : results;
  const hiddenCount = results.length - shownResults.length;

  const photoFor = useCallback((row: CustomFoodRow | undefined) => (row?.image_path ? photoUrls.get(row.image_path) ?? null : null), [photoUrls]);
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
    const portions = food.portions ?? [];
    const resolution = resolvePortion(typed, portions);
    setSelected(food);
    setDerived(null);
    setAmountPrompt(null);
    setNotice("");
    setBarcodeMiss(null);
    if (resolution.kind === "grams") {
      setAmount(formatAmount(resolution.grams));
      setUnitKey("g");
    } else if (resolution.kind === "portion") {
      const index = portions.indexOf(resolution.portion);
      if (index >= 0 || resolution.derivedFrom) {
        if (index < 0 && resolution.derivedFrom) setDerived({ portion: resolution.portion, from: resolution.derivedFrom });
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
              if (at < 0 && retry.derivedFrom) setDerived({ portion: retry.portion, from: retry.derivedFrom });
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
      const index = portions.findIndex((portion) => portion.countDefault);
      setAmount(index >= 0 ? "1" : "100");
      setUnitKey(index >= 0 ? `portion:${index}` : "g");
    }
  }, []);

  const lookupBarcode = useCallback(async (value: string) => {
    const checked = checkBarcode(value);
    if (!checked.ok) { setError(barcodeProblem(checked.reason)); return; }
    setBusy(true); setError(""); setNotice(""); setBarcodeMiss(null);
    try {
      const response = await fetch(`/api/foods/search?barcode=${encodeURIComponent(checked.code)}`);
      const data = (await response.json()) as FoodSearchResponse;
      if (!response.ok) throw new Error(data.error || "Barcode lookup failed.");
      setResults(data.foods || []);
      setSources(data.sources || []);
      setSearchMode("barcode");
      setLastQuery(NO_AMOUNT);
      setTab("log");
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
      const response = await fetch("/api/foods/search?browse=1");
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
      if (!value.trim()) { void browseFoods(); setLastSearch(""); return; }
      setResults([]);
      if (typed.amount !== null) setError("Add a food name after the amount, for example “150 g rice”.");
      return;
    }
    setSearchingFoods(true); setError(""); setNotice(""); setBarcodeMiss(null);
    try {
      const response = await fetch(`/api/foods/search?q=${encodeURIComponent(value.trim())}${packaged ? "&packaged=1" : ""}`);
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
        if (pick) chooseFood(pick, typed);
        else {
          setSelected(null);
          setDerived(null);
          setAmountPrompt(null);
          const amountText = describeTypedAmount(typed);
          setNotice(found.length === 1
            ? `Is “${found[0].name}” the food you mean? Tap it and FITX keeps your amount (${amountText}).`
            : `More than one food matches “${typed.text}”. Tap the one you mean and FITX keeps your amount (${amountText}).`);
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
    const supabase = createClient();
    if (!supabase) return setError("Nutrition tracking is not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to log food.");
    setBusy(true); setError(""); setNotice("");
    const scaled = scaleMacros(food, grams);
    const portion = chosenPortion;
    const convertedFrom = derived && portion === derived.portion ? derived.from : null;
    const inserted = await supabase.from("meals").insert({
      user_id: auth.user.id, date: dateKey, meal, food_name: food.name, brand: food.brand,
      barcode: food.barcode, provider_id: food.id,
      source: food.source, serving_size: portion ? describePortion(amountNumber, portion, grams) : `${formatAmount(grams)} g`,
      servings: grams / 100, quantity_grams: grams,
      calories: scaled.calories, protein: scaled.protein, carbs: scaled.carbs, fat: scaled.fat,
      nutrition_snapshot: {
        per_100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
        source: food.source,
        kind: food.kind,
        value_basis: food.valueBasis,
        ...(food.dataType ? { data_type: food.dataType } : {}),
        ...(food.basis ? { basis: food.basis } : {}),
        ...(portion ? {
          portion: {
            count: amountNumber, label: portion.label, unit: portion.unit, grams_each: portion.grams, estimate: portion.estimate !== false,
            ...(convertedFrom ? { converted_from: { label: convertedFrom.label, grams: convertedFrom.grams } } : {}),
          },
        } : {}),
      },
    });
    if (inserted.error) setError("That food could not be logged. Please try again.");
    else { setSelected(null); setQuery(""); setNotice(`Added ${food.name} to ${meal}.`); await load(); void refreshRecent(); }
    setBusy(false);
  }

  async function addWater(amountMl: number) {
    const supabase = createClient();
    if (!supabase) return setError("Water tracking is not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to log water.");
    setBusy(true);
    const result = await supabase.from("water_logs").insert({ user_id: auth.user.id, amount_ml: amountMl, local_date: dateKey });
    if (result.error) setError("Water could not be logged."); else setWaterMl((current) => current + amountMl);
    setBusy(false);
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
  async function saveFood(input: CustomFoodInput, photo: File | null) {
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
    if (editing) { setNotice(`Saved changes to “${row.name}”.${photoProblem}`); return; }
    chooseFood(customFoodResult(row, photoUrl));
    setTab("log");
    setNotice(`Saved “${row.name}” to My foods. It is not in today's log; choose an amount and add it when you eat it.${photoProblem}`);
  }

  async function removeFood(row: CustomFoodRow) {
    const v2 = capabilities.customFoodsV2;
    if (!window.confirm(v2 ? `Archive “${row.name}”? It disappears from My foods and search; past logs keep their values.` : `Delete “${row.name}” from My foods? Past logs keep their values. This can't be undone.`)) return;
    const supabase = createClient();
    if (!supabase || !userId) return;
    setBusy(true);
    const result = await removeCustomFood(supabase, userId, row.id, v2);
    setBusy(false);
    if (result.error) setError("That food could not be removed. Please try again.");
    else { setNotice(v2 ? `Archived “${row.name}”.` : `Deleted “${row.name}”.`); await load(); }
  }

  async function saveNamed(name: string) {
    const prompt = namePrompt;
    const supabase = createClient();
    if (!prompt || !supabase || !userId) return;
    const items = prompt.kind === "meal" ? entries.filter((entry) => entry.meal === prompt.slot) : entries;
    setBusy(true); setError("");
    const result = await saveTemplate(supabase, userId, name, prompt.kind, items, prompt.kind === "meal" ? prompt.slot : null);
    setBusy(false);
    if (result.error) { setError("That could not be saved. Please try again."); return; }
    setNamePrompt(null);
    setNotice(prompt.kind === "meal" ? `Saved “${name}”. Add it to any day from Routines.` : `Saved “${name}” as a routine. Add it to any day from Routines.`);
    await load();
  }

  async function applyTemplate(template: MealTemplate, slot: MealSlot | null) {
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

  function saveSelectedAsFood(food: FoodResult) {
    const serving = food.portions.find((portion) => portion.unit === "serving");
    setFoodForm({
      editing: null,
      prefill: {
        name: food.name, brand: food.brand, barcode: food.barcode,
        servingLabel: serving ? serving.label.replace(/^1 serving \((.*)\)$/, "$1") : "",
        servingGrams: serving?.grams ?? 100,
        per100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
        imageUrl: food.image, imageAttribution: food.imageCredit, origin: food.barcode ? "barcode" : "user", sourceRef: food.barcode ?? food.id,
      },
    });
  }

  const macroRows = ([["Protein", totals.protein, target?.protein], ["Carbs", totals.carbs, target?.carbs], ["Fat", totals.fat, target?.fat]] as const)
    .map(([label, value, goal]) => ({ label, value, goal, progress: goal ? goalProgress(value, goal) : null }));
  const calorieLabel = `${Math.round(totals.calories)} calories logged${target ? ` of ${target.calories} calorie target` : ""}${calorieGoal?.isOver ? `, ${calorieGoal.over} over` : ""}`;
  const visibleSources = sources.filter((source) => source.status !== "not_used");
  const estimateCount = entries.filter(isEstimateEntry).length;
  const showBrowse = searchMode === "browse";
  const tabs: Array<[Tab, string]> = [["log", "Log food"], ["meals", "Meals"], ["foods", "My foods"], ["routines", "Routines"], ["insights", "Insights"]];

  return (
    <div className={`${styles.page} space-y-5`}>
      <PageHeading title="Track your nutrition" description="Search a food, choose a portion, and keep a clear log of meals and water." actions={
        <div className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-2 py-1">
          <button onClick={() => shiftDate(-1)} aria-label="Previous day" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover"><ArrowLeft size={16}/></button>
          <span className="min-w-32 text-center text-xs text-fitx-text-secondary">{readableDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          <button onClick={() => shiftDate(1)} aria-label="Next day" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover"><ArrowRight size={16}/></button>
        </div>
      }/>
      <section className={styles.overview} aria-label={`Nutrition summary for ${readableDate(date)}`}>
        <div className={styles.overviewHeader}>
          <div><p className={styles.eyebrow}>Daily nutrition</p><h2>{readableDate(date, { weekday: "long", month: "long", day: "numeric" })}</h2></div>
          <button type="button" onClick={() => setTargetsOpen(true)} className={styles.targetButton}><Target size={14}/>{manualTargets ? "Your targets" : "Edit targets"}</button>
        </div>
        <div className={styles.overviewBody}>
          <div className={styles.calorieColumn}>
            <div className={`${styles.calorieRing} ${calorieGoal?.isOver ? styles.isOver : ""}`} role="img" aria-label={calorieLabel} style={{ "--ring-percent": `${calorieGoal?.percent ?? 0}%` } as CSSProperties}>
              <div><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>{target ? `/ ${target.calories} kcal` : "kcal logged"}</span></div>
            </div>
            <div className={styles.calorieNotes}>
              {calorieGoal?.isOver && <p className={styles.overNote}>Over target by {calorieGoal.over.toLocaleString()} kcal</p>}
              {target && <p className={styles.targetHint}>{manualTargets ? "Targets you set" : "Estimated daily target from your profile"}</p>}
              {estimateCount > 0 && <p className={styles.targetHint}>Includes {estimateCount} estimated {estimateCount === 1 ? "item" : "items"}</p>}
            </div>
          </div>
          <div className={styles.macroGrid}>
            {macroRows.map(({ label, value, goal, progress }) => (
              <div key={label} className={styles.macro}>
                <div className={styles.macroTop}><span>{label}</span><strong>{Math.round(value)} <small>g</small></strong></div>
                {goal && progress ? <>
                  <span className={styles.macroGoal}>of {goal} g{progress.isOver && <span className={styles.macroOver}> · {progress.over} g over</span>}</span>
                  <div className={`${styles.macroTrack} ${progress.isOver ? styles.isOver : ""}`}><span style={{ width: `${progress.percent}%` }}/></div>
                </> : <span className={styles.macroGoal}>logged today</span>}
              </div>
            ))}
          </div>
        </div>
      </section>
      <nav aria-label="Nutrition sections" className={`${styles.tabs} flex gap-5 overflow-x-auto border-b border-fitx-divider text-sm`}>
        {tabs.map(([value, label]) => <button key={value} onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-1 pb-3 ${tab === value ? "border-fitx-primary text-fitx-primary-text" : "border-transparent text-fitx-text-secondary hover:text-fitx-text"}`}>{label}</button>)}
      </nav>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
      {tab === "log" && <div className={`${styles.logGrid} grid items-start gap-4`}>
        <section className={`${styles.searchPanel} fitx-panel p-4 sm:p-5`}>
          <h2 className="mb-3 flex items-center gap-2 font-medium"><Search size={17} className="text-fitx-primary"/>Search food</h2>
          <form onSubmit={searchFoods} className="flex gap-2">
            <input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Food and amount, e.g. 3 idli or 150 g rice" aria-label="Search foods"/>
            <button className="fitx-button fitx-button-secondary shrink-0 px-3" disabled={searchingFoods} aria-label="Search food"><Search size={17}/></button>
          </form>
          <div className={styles.suggestions}>
            <span className="mr-1 text-[11px] text-fitx-text-disabled">Try</span>
            {EXAMPLES.map((term) => <button key={term} type="button" onClick={() => void runFoodSearch(term)} className={styles.suggestion}>{term}</button>)}
          </div>
          <form onSubmit={findBarcode} className="mt-3 flex gap-2">
            <input className="fitx-field" value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Barcode number" aria-label="Barcode number" inputMode="numeric"/>
            <button className="fitx-button fitx-button-secondary shrink-0 px-3" disabled={busy} aria-label="Find barcode"><Barcode size={17}/></button>
          </form>
          <BarcodeScanner onDetected={onBarcodeDetected}/>
          <div className={styles.searchTools}>
            {lastSearch && searchMode !== "packaged" && <button type="button" className={ui.textButton} disabled={searchingFoods} onClick={() => void runFoodSearch(lastSearch, true)}><PackageSearch size={13} className="mr-1 inline"/>Search packaged products for “{parseFoodQuery(lastSearch).text}”</button>}
            <label className={styles.filter}><input type="checkbox" checked={hideNonVeg} onChange={(event) => setHideNonVeg(event.target.checked)}/>Hide non-veg</label>
            <Link href="/nutrition/sources" className={ui.textButton}><BookOpen size={13} className="mr-1 inline"/>Sources</Link>
          </div>
          {visibleSources.length > 0 && <p className={styles.sources} aria-label="Sources for these results">{visibleSources.map((source) => <span key={source.id} className={source.status === "ok" || source.status === "no_results" ? styles.sourceChip : styles.sourceChipDown}>{sourceText(source)}</span>)}</p>}
          <div aria-live="polite" className={styles.foodResults}>
            {searchingFoods ? <p className="py-5 text-center text-xs text-fitx-text-secondary">Loading foods…</p> : <>
              {showBrowse && recentFoods.length > 0 && <>
                <p className={styles.listLabel}>Recent</p>
                {recentFoods.filter((food) => !hideNonVeg || food.dietType !== "non_veg").map((food) => <FoodResultCard key={`recent-${food.source}-${food.id}`} food={food} active={selected?.id === food.id && selected?.source === food.source} onSelect={(chosen) => chooseFood(chosen, lastQuery)}/>)}
                <p className={styles.listLabel}>Common foods</p>
              </>}
              {searchMode === "packaged" && <p className={ui.muted}>Packaged products from Open Food Facts, entered by its community from package labels.</p>}
              {shownResults.some((food) => food.suggestion) && <p className={ui.muted}>Nothing matched every word, so these are the closest spellings.</p>}
              {shownResults.map((food) => <FoodResultCard key={`${food.source}-${food.id}`} food={food} active={selected?.id === food.id && selected?.source === food.source} onSelect={(chosen) => chooseFood(chosen, lastQuery)}/>)}
              {hiddenCount > 0 && <p className={ui.muted}>{hiddenCount} non-veg {hiddenCount === 1 ? "food is" : "foods are"} hidden.</p>}
            </>}
          </div>
        </section>
        <section className={`${styles.addPanel} fitx-panel p-4 sm:p-5`}>
          <h2 className="mb-4 font-medium">Add to log</h2>
          {barcodeMiss && !selected && <div className={ui.callout}>
            <p>{barcodeMiss.noLabel
              ? `Open Food Facts knows barcode ${barcodeMiss.code}${barcodeMiss.name ? ` (“${barcodeMiss.name}”)` : ""}, but has no usable nutrition label for it.`
              : `No product with barcode ${barcodeMiss.code} was found on Open Food Facts.`} You can add it from the package yourself.</p>
            <div className={ui.toolbar}>
              <button type="button" className="fitx-button min-h-10 px-3 text-xs" onClick={() => setFoodForm({ editing: null, prefill: { barcode: barcodeMiss.code, name: barcodeMiss.name ?? "", origin: "barcode", sourceRef: barcodeMiss.code } })}>Add it as my food</button>
              <a className={ui.textButton} href={`https://world.openfoodfacts.org/product/${barcodeMiss.code}`} target="_blank" rel="noopener noreferrer">Add it to Open Food Facts</a>
            </div>
          </div>}
          {selected ? <>
            <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3">
              {selected.image && <div className={ui.photo}>
                <Image src={selected.image} alt={`${selected.name} package`} width={72} height={72} unoptimized/>
                <p className={ui.credit}>{selected.imageCredit}{selected.sourceUrl && <> · <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">product page</a></>}</p>
              </div>}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="mt-1 text-xs text-fitx-text-secondary">{selected.brand ? `${selected.brand} · ` : ""}{selected.basis}</p>
                  <p className="mt-1.5 flex flex-wrap gap-1"><BasisBadge basis={selected.valueBasis}/><StateTag state={selected.state}/><DietBadge diet={selected.dietType}/></p>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Clear selected food" className="text-fitx-text-disabled hover:text-fitx-text"><X size={16}/></button>
              </div>
              <PortionPicker food={selected} amount={amount} unitKey={unitKey} options={portionOptions} derived={derived} chosen={chosenPortion} grams={grams} macros={selectedMacros}
                prompt={amountPrompt} onAmount={(value) => { setAmount(value); setAmountPrompt(null); }} onUnit={changeUnit} idPrefix="log-portion"/>
            </div>
            <label className="mt-3 block text-xs text-fitx-text-secondary">Meal<select className="fitx-field mt-1.5" value={meal} onChange={(event) => setMeal(event.target.value as MealSlot)}>{MEAL_SLOTS.map((name) => <option key={name}>{name}</option>)}</select></label>
            <button onClick={() => void logFood(selected)} disabled={busy} className="fitx-button mt-4 w-full">{busy ? "Saving…" : "Add to log"}</button>
            {selected.kind === "packaged" && <button type="button" onClick={() => saveSelectedAsFood(selected)} className={`${ui.textButton} mt-2`}>Save to My foods</button>}
          </> : !barcodeMiss && <EmptyState title="Choose a food" description="Search the database or look up a product barcode to see its serving nutrition here."/>}
          <button type="button" onClick={() => setFoodForm({ editing: null, prefill: null })} className={`${ui.textButton} mt-4`}>Add your own food</button>
        </section>
        <aside className={styles.nutritionAside}>
          <section className="fitx-panel p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 font-medium"><Droplets size={17} className="text-fitx-info"/>Water intake</h2>
            <p className="mb-3 text-sm text-fitx-text-secondary">{(waterMl / 1000).toFixed(1)} L <span className="text-fitx-text-disabled">/ {(waterGoal / 1000).toFixed(1)} L</span></p>
            <div className="fitx-progress-track mb-3 h-2"><div className="h-full rounded-full bg-fitx-info" style={{ width: `${goalPercent(waterMl, waterGoal)}%` }}/></div>
            <div className="flex gap-2">{[250, 500].map((ml) => <button key={ml} disabled={busy} onClick={() => void addWater(ml)} className="fitx-button fitx-button-secondary flex-1">+{ml} ml</button>)}</div>
          </section>
        </aside>
      </div>}
      {tab === "meals" && <MealLog entries={entries} title={readableDate(date)} loading={loading} busy={busy} templatesReady={capabilities.templates}
        onEdit={setEditingEntry} onDelete={(entry) => void removeMeal(entry)} onLogFood={() => setTab("log")} onCopyYesterday={() => void copyYesterday()}
        onSaveMeal={(slot) => setNamePrompt({ kind: "meal", slot, initial: `My ${slot.toLowerCase()}` })}
        onSaveDay={() => setNamePrompt({ kind: "day", initial: `${readableDate(date, { weekday: "long" })} routine` })}/>}
      {tab === "foods" && <MyFoods rows={customRows} loading={loading} v2={capabilities.customFoodsV2} busy={busy}
        photoFor={photoFor} onUse={(row) => { chooseFood(customFoodResult(row, photoFor(row))); setTab("log"); }} onAdd={() => setFoodForm({ editing: null, prefill: null })}
        onEdit={(row) => setFoodForm({ editing: row, prefill: null })} onRemove={(row) => void removeFood(row)}/>}
      {tab === "routines" && <Routines templates={templates} ready={capabilities.templates} loading={loading} busy={busy} dateLabel={readableDate(date, { month: "short", day: "numeric" })}
        onApply={(template, slot) => void applyTemplate(template, slot)} onDelete={(template) => void removeTemplate(template)}/>}
      {tab === "insights" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-2 font-medium">Daily nutrition insights</h2><p className="mb-5 text-sm text-fitx-text-secondary">This view summarizes the food you have logged for the selected day{estimateCount > 0 ? `, including ${estimateCount} estimated ${estimateCount === 1 ? "item" : "items"}` : ""}.</p>{entries.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([["Energy", Math.round(totals.calories), "kcal", target?.calories], ["Protein", Math.round(totals.protein), "g", target?.protein], ["Carbohydrates", Math.round(totals.carbs), "g", target?.carbs], ["Fat", Math.round(totals.fat), "g", target?.fat]] as const).map(([label, value, unit, goal]) => { const progress = goal ? goalProgress(value, goal) : null; return <div key={label} className="rounded-xl border border-fitx-border bg-fitx-surface p-4"><p className="text-xs text-fitx-text-secondary">{label}</p><p className="mt-2 text-2xl font-semibold">{value} <span className="text-sm font-normal text-fitx-text-disabled">{unit}</span></p>{progress && <p className={`mt-2 text-xs ${progress.isOver ? styles.macroOver : "text-fitx-text-disabled"}`}>{progress.isOver ? `${progress.over} ${unit} over the ${manualTargets ? "" : "estimated "}target` : `${progress.percent}% of ${manualTargets ? "your" : "estimated"} target`}</p>}</div>; })}</div> : <EmptyState title="No nutrition data yet" description="Logged meals will be summarized here."/>}</section>}
      {editingEntry && <EntryEditor entry={editingEntry} busy={busy} onCancel={() => setEditingEntry(null)} onSave={(change) => void saveEntry(editingEntry, change)}/>}
      {foodForm && <CustomFoodForm editing={foodForm.editing} prefill={foodForm.prefill} photoUrl={photoFor(foodForm.editing ?? undefined)} v2={capabilities.customFoodsV2} busy={busy} onCancel={() => setFoodForm(null)} onSave={(input, photo) => void saveFood(input, photo)}/>}
      {namePrompt && <NameDialog title={namePrompt.kind === "meal" ? `Save ${namePrompt.slot.toLowerCase()} as a meal` : "Save this day as a routine"}
        description={namePrompt.kind === "meal" ? "Its foods and amounts are copied, so you can add the same meal to any day." : "Every meal of this day is copied, so you can add the whole day again in one tap."}
        initial={namePrompt.initial} busy={busy} onCancel={() => setNamePrompt(null)} onSave={(name) => void saveNamed(name)}/>}
      {targetsOpen && <TargetsEditor estimated={estimated} manual={manualTargets} ready={capabilities.targets} busy={busy} onClose={() => setTargetsOpen(false)}
        onSave={(next) => void updateTargets(next)} onReset={() => void updateTargets(null)}/>}
    </div>
  );
}

