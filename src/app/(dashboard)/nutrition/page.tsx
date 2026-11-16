"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Barcode, Coffee, Droplets, Search, Utensils, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { askForGramsMessage, describePortion, formatAmount, parseFoodQuery, rankFoods, resolvePortion } from "@/lib/domain/food-query";
import type { FoodPortion, FoodState, ParsedFoodQuery } from "@/lib/domain/food-query";
import styles from "./Nutrition.module.css";
import { estimateNutritionTargets, goalPercent, goalProgress, scaleMacros, sumMacros } from "@/lib/domain/nutrition";

/** Calories, protein, carbs and fat are per 100 g. */
type Food = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
  dataType?: string | null;
  basis?: string;
  state?: FoodState | null;
  portions?: FoodPortion[];
};
type SourceStatus = { id: string; label: string; status: "ok" | "no_results" | "not_used" | "not_configured" | "error" | "timeout"; count: number };
type Meal = {
  id: string; date: string; meal: string; food_name: string; brand: string | null; barcode: string | null; servings: number;
  calories: number; protein: number; carbs: number; fat: number; quantity_grams: number | null; source: string;
  serving_size: string | null; nutrition_snapshot: { portion?: { estimate?: boolean } } | null;
};
type Profile = { age: number | null; gender: string | null; height: number | null; weight: number | null };
type Prefs = { activity_level: string; primary_goal: string; daily_water_goal_ml: number };
type CustomFoodRow = { id: string; name: string; brand: string | null; serving_grams: number | null; calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number };
/** A volume weight worked out from another USDA measure, such as 1 teaspoon from the tablespoon. */
type DerivedPortion = { portion: FoodPortion; from: FoodPortion };

const meals = ["Breakfast", "Lunch", "Dinner", "Snack"];
const EXAMPLES = ["3 idli", "150 g rice", "2 roti", "1 cup dal", "banana"];
const CUSTOM_SOURCE = "FITX custom food";
const NO_AMOUNT = parseFoodQuery("");
const emptyCustom = { name: "", brand: "", calories: "", protein: "", carbs: "", fat: "", grams: "100" };

function customFood(row: CustomFoodRow): Food {
  const serving = Number(row.serving_grams) > 0 ? Number(row.serving_grams) : 100;
  return {
    id: row.id, name: row.name, brand: row.brand, image: null,
    calories: Number(row.calories_per_100g), protein: Number(row.protein_per_100g), carbs: Number(row.carbs_per_100g), fat: Number(row.fat_per_100g),
    source: CUSTOM_SOURCE, basis: "Your food", state: null,
    portions: [{ label: `1 serving (${formatAmount(serving)} g)`, unit: "serving", grams: serving, countDefault: true, estimate: false }],
  };
}

function sourceText(source: SourceStatus) {
  if (source.status === "ok") return `${source.label} · ${source.count}`;
  if (source.status === "no_results") return `${source.label} · no match`;
  if (source.status === "timeout") return `${source.label} · timed out`;
  if (source.status === "not_configured") return `${source.label} · not set up`;
  return `${source.label} · unavailable`;
}

export default function NutritionPage() {
  const [date, setDate] = useState(() => new Date());
  const [entries, setEntries] = useState<Meal[]>([]);
  const [customFoods, setCustomFoods] = useState<Food[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(2500);
  const [target, setTarget] = useState<ReturnType<typeof estimateNutritionTargets>>(null);
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState<ParsedFoodQuery>(NO_AMOUNT);
  const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [searchingFoods, setSearchingFoods] = useState(true);
  const [selected, setSelected] = useState<Food | null>(null);
  const [amount, setAmount] = useState("100");
  const [unitKey, setUnitKey] = useState("g");
  const [derived, setDerived] = useState<DerivedPortion | null>(null);
  const [amountPrompt, setAmountPrompt] = useState<{ message: string; grams: number | null } | null>(null);
  const [meal, setMeal] = useState("Breakfast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"log" | "meals" | "insights" | "database">("log");
  const [custom, setCustom] = useState(emptyCustom);
  const dateKey = localDateKey(date);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    if (!supabase) { setError("Nutrition tracking is not connected to Supabase."); setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sign in to track food and water."); setLoading(false); return; }
    const [mealResult, waterResult, profileResult, prefsResult, customFoodResult] = await Promise.all([
      supabase.from("meals").select("id,date,meal,food_name,brand,barcode,servings,calories,protein,carbs,fat,quantity_grams,source,serving_size,nutrition_snapshot").eq("user_id", auth.user.id).eq("date", dateKey).order("created_at", { ascending: true }),
      supabase.from("water_logs").select("amount_ml").eq("user_id", auth.user.id).eq("local_date", dateKey),
      supabase.from("profiles").select("age,gender,height,weight").eq("id", auth.user.id).maybeSingle(),
      supabase.from("user_preferences").select("activity_level,primary_goal,daily_water_goal_ml").eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("custom_foods").select("id,name,brand,serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g").eq("user_id", auth.user.id).order("name").limit(200),
    ]);
    const failure = [mealResult.error, waterResult.error, profileResult.error, prefsResult.error, customFoodResult.error].find(Boolean);
    if (failure) setError("Your nutrition data could not be loaded. Please try again.");
    else {
      setEntries((mealResult.data || []) as Meal[]);
      setWaterMl(((waterResult.data || []) as Array<{ amount_ml: number }>).reduce((sum: number, row) => sum + Number(row.amount_ml || 0), 0));
      const prefs = prefsResult.data as Prefs | null;
      setWaterGoal(prefs?.daily_water_goal_ml || 2500);
      setTarget(estimateNutritionTargets((profileResult.data || {}) as Profile, prefs?.activity_level, prefs?.primary_goal));
      setCustomFoods(((customFoodResult.data || []) as CustomFoodRow[]).map(customFood));
      setError("");
    }
    setLoading(false);
  }, [dateKey]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const totals = useMemo(() => sumMacros(entries), [entries]);
  const portionOptions = useMemo(() => [...(selected?.portions ?? []), ...(derived ? [derived.portion] : [])], [selected, derived]);
  const chosenPortion = unitKey.startsWith("portion:") ? portionOptions[Number(unitKey.slice("portion:".length))] ?? null : null;
  const amountNumber = amount.trim() ? Number(amount) : Number.NaN;
  const grams = Number.isFinite(amountNumber) ? Math.round(amountNumber * (chosenPortion ? chosenPortion.grams : 1) * 10) / 10 : Number.NaN;
  const selectedMacros = selected && grams > 0 ? scaleMacros(selected, grams) : null;
  const calorieGoal = target ? goalProgress(totals.calories, target.calories) : null;

  function shiftDate(offset: number) {
    setDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset));
  }

  /** Selects a food and fills the amount from what was typed: "3 idli" becomes 3 x USDA's 38 g idli. */
  const chooseFood = useCallback((food: Food, typed: ParsedFoodQuery = NO_AMOUNT) => {
    const portions = food.portions ?? [];
    const resolution = resolvePortion(typed, portions);
    setSelected(food);
    setDerived(null);
    setAmountPrompt(null);
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
      const measures = portions.length ? " You can also pick one of this food's measures under Unit." : "";
      setAmountPrompt({ message: `${askForGramsMessage(food.name, resolution)}${measures}`, grams: resolution.unit === null && resolution.amount >= 10 ? resolution.amount : null });
    } else {
      // Nothing typed: one of the food's own pieces or servings when it has one, otherwise 100 g.
      const index = portions.findIndex((portion) => portion.countDefault);
      setAmount(index >= 0 ? "1" : "100");
      setUnitKey(index >= 0 ? `portion:${index}` : "g");
    }
  }, []);

  const lookupBarcode = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/foods/search?barcode=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Barcode lookup failed.");
      const foods: Food[] = data.foods || [];
      setResults(foods);
      setSources(data.sources || []);
      setLastQuery(NO_AMOUNT);
      const lookup = (data.sources as SourceStatus[] | undefined)?.find((source) => source.id === "open-food-facts");
      if (!foods.length) setError(lookup && (lookup.status === "error" || lookup.status === "timeout") ? "Open Food Facts did not answer, so the barcode could not be checked. Try again shortly, or add it as a custom food below." : "No nutrition label was found for that barcode. You can add it as a custom food below.");
      else chooseFood(foods[0]);
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Food search failed.");
      setResults(data.foods || []);
      setSources(data.sources || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void browseFoods(); }, 0);
    return () => window.clearTimeout(timer);
  }, [browseFoods]);

  async function runFoodSearch(value: string) {
    setQuery(value);
    const typed = parseFoodQuery(value);
    if (typed.text.length < 2) {
      setResults([]);
      if (typed.amount !== null) setError("Add a food name after the amount, for example “150 g rice”.");
      return;
    }
    setSearchingFoods(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/foods/search?q=${encodeURIComponent(value.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Food search failed.");
      const found = [...rankFoods(customFoods, typed.words).slice(0, 5), ...((data.foods || []) as Food[])];
      setResults(found);
      setSources(data.sources || []);
      setLastQuery(typed);
      if (!found.length) setError("No matching food was found. Try another search or add a custom food.");
      else if (typed.amount !== null) chooseFood(found[0], typed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setSearchingFoods(false); }
  }

  async function searchFoods(event: FormEvent) {
    event.preventDefault();
    await runFoodSearch(query);
  }

  async function logFood(food: Food) {
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
      barcode: food.source === "Open Food Facts" ? food.id : null, provider_id: food.id,
      source: food.source, serving_size: portion ? describePortion(amountNumber, portion, grams) : `${formatAmount(grams)} g`,
      servings: grams / 100, quantity_grams: grams,
      calories: scaled.calories, protein: scaled.protein, carbs: scaled.carbs, fat: scaled.fat,
      nutrition_snapshot: {
        per_100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
        source: food.source,
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
    else { setSelected(null); setQuery(""); setResults([]); setNotice(`Added ${food.name} to ${meal}.`); await load(); }
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

  async function removeMeal(id: string) {
    const supabase = createClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const result = await supabase.from("meals").delete().eq("id", id).eq("user_id", auth.user.id);
    if (result.error) setError("That food could not be removed."); else await load();
  }

  /** Saves a food to the user's list only; logging it is a separate step. */
  async function saveCustomFood(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return setError("Custom foods are not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to save a custom food.");
    const serving = Number(custom.grams);
    const parsed = [custom.calories, custom.protein, custom.carbs, custom.fat].map(Number);
    if (!custom.name.trim() || !Number.isFinite(serving) || serving <= 0 || parsed.some((value) => !Number.isFinite(value) || value < 0)) { setError("Add a name, serving size, and valid nutrition values."); return; }
    setBusy(true); setError(""); setNotice("");
    const row = {
      name: custom.name.trim(), brand: custom.brand.trim() || null, serving_grams: serving,
      calories_per_100g: parsed[0] * 100 / serving, protein_per_100g: parsed[1] * 100 / serving, carbs_per_100g: parsed[2] * 100 / serving, fat_per_100g: parsed[3] * 100 / serving,
    };
    const result = await supabase.from("custom_foods").insert({ user_id: auth.user.id, serving_size: `${serving} g`, ...row }).select("id").single();
    if (result.error) { setError("Your custom food could not be saved."); setBusy(false); return; }
    const saved = customFood({ id: result.data.id, ...row });
    setCustom(emptyCustom);
    await load();
    chooseFood(saved);
    setNotice(`Saved “${saved.name}” to your foods. It is not in today's log; choose an amount and add it when you eat it.`);
    setBusy(false);
  }

  const macroRows = ([["Protein", totals.protein, target?.protein], ["Carbs", totals.carbs, target?.carbs], ["Fat", totals.fat, target?.fat]] as const)
    .map(([label, value, goal]) => ({ label, value, goal, progress: goal ? goalProgress(value, goal) : null }));
  const calorieLabel = `${Math.round(totals.calories)} calories logged${target ? ` of ${target.calories} calorie target` : ""}${calorieGoal?.isOver ? `, ${calorieGoal.over} over` : ""}`;
  const visibleSources = sources.filter((source) => source.status !== "not_used");
  const usdaLive = sources.find((source) => source.id === "usda-live");

  return (
    <div className={`${styles.page} space-y-5`}>
      <PageHeading title="Track your nutrition" description="Search a food, choose a portion, and keep a clear log of meals and water." actions={
        <div className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-2 py-1">
          <button onClick={() => shiftDate(-1)} aria-label="Previous day" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-surface-variant"><ArrowLeft size={16}/></button>
          <span className="min-w-32 text-center text-xs text-fitx-text-secondary">{readableDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          <button onClick={() => shiftDate(1)} aria-label="Next day" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-surface-variant"><ArrowRight size={16}/></button>
        </div>
      }/>
      <section className={styles.overview} aria-label={`Nutrition summary for ${readableDate(date)}`}>
        <div className={styles.overviewHeader}><div><p className={styles.eyebrow}>Daily nutrition</p><h2>{readableDate(date, { weekday: "long", month: "long", day: "numeric" })}</h2></div><span className={styles.sourceNote}>From your food log</span></div>
        <div className={styles.overviewBody}>
          <div className={styles.calorieColumn}>
            <div className={`${styles.calorieRing} ${calorieGoal?.isOver ? styles.isOver : ""}`} role="img" aria-label={calorieLabel} style={{ "--ring-percent": `${calorieGoal?.percent ?? 0}%` } as CSSProperties}>
              <div><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>{target ? `/ ${target.calories} kcal` : "kcal logged"}</span></div>
            </div>
            <div className={styles.calorieNotes}>
              {calorieGoal?.isOver && <p className={styles.overNote}>Over target by {calorieGoal.over.toLocaleString()} kcal</p>}
              {target && <p className={styles.targetHint}>Estimated daily target from your profile</p>}
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
        {([["log", "Log food"], ["meals", "Meals"], ["insights", "Insights"], ["database", "Food database"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`whitespace-nowrap border-b-2 px-1 pb-3 ${tab === value ? "border-fitx-primary text-fitx-primary" : "border-transparent text-fitx-text-secondary hover:text-fitx-text"}`}>{label}</button>)}
      </nav>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
      {tab === "log" && <div className={`${styles.logGrid} grid items-start gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)_280px]`}>
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
          {visibleSources.length > 0 && <p className={styles.sources} aria-label="Sources for these results">{visibleSources.map((source) => <span key={source.id} className={source.status === "ok" || source.status === "no_results" ? styles.sourceChip : styles.sourceChipDown}>{sourceText(source)}</span>)}</p>}
          <div aria-live="polite" className={styles.foodResults}>
            {searchingFoods ? <p className="py-5 text-center text-xs text-fitx-text-secondary">Loading foods…</p> : results.map((food) => {
              const active = selected?.id === food.id && selected?.source === food.source;
              const piece = food.portions?.find((portion) => portion.countDefault) ?? food.portions?.[0];
              return (
                <button key={`${food.source}-${food.id}`} type="button" onClick={() => chooseFood(food, lastQuery)} aria-pressed={active} className={`${styles.foodResult} ${active ? styles.foodResultActive : ""}`}>
                  <span className={styles.foodResultMain}>
                    <span className={styles.foodName}>{food.name}</span>
                    <span className={styles.foodMeta}>{food.brand ? `${food.brand} · ` : ""}{food.basis ?? food.source}</span>
                    {(food.state || piece) && <span className={styles.foodTags}>
                      {food.state && <span className={food.state === "cooked" ? styles.tagCooked : styles.tagRaw}>{food.state === "cooked" ? "Cooked" : "Raw"}</span>}
                      {piece && <span className={styles.tag}>{piece.label} · {formatAmount(piece.grams)} g</span>}
                    </span>}
                    <span className={styles.foodMacros}>P {food.protein} g · C {food.carbs} g · F {food.fat} g</span>
                  </span>
                  <span className={styles.foodKcal}>{Math.round(food.calories)}<small>kcal / 100 g</small></span>
                </button>
              );
            })}
          </div>
        </section>
        <section className={`${styles.addPanel} fitx-panel p-4 sm:p-5`}>
          <h2 className="mb-4 font-medium">Add to log</h2>
          {selected ? <>
            <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="mt-1 text-xs text-fitx-text-secondary">{selected.brand ? `${selected.brand} · ` : ""}{selected.basis ?? selected.source}{selected.state ? ` · ${selected.state}` : ""}</p>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Clear selected food" className="text-fitx-text-disabled hover:text-fitx-text"><X size={16}/></button>
              </div>
              <div className={styles.macroTiles} aria-label="Nutrition for this amount">
                <div>{selectedMacros ? Math.round(selectedMacros.calories) : "–"}<span>kcal</span></div>
                <div>{selectedMacros ? `${selectedMacros.protein} g` : "–"}<span>protein</span></div>
                <div>{selectedMacros ? `${selectedMacros.carbs} g` : "–"}<span>carbs</span></div>
                <div>{selectedMacros ? `${selectedMacros.fat} g` : "–"}<span>fat</span></div>
              </div>
            </div>
            <div className={styles.amountRow}>
              <label>Amount<input className="fitx-field" inputMode="decimal" type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setAmountPrompt(null); }} aria-describedby="portion-note"/></label>
              <label>Unit<select className="fitx-field" value={unitKey} onChange={(event) => { setUnitKey(event.target.value); setAmountPrompt(null); }}>
                <option value="g">grams (g)</option>
                {portionOptions.map((portion, index) => <option key={`${portion.label}-${index}`} value={`portion:${index}`}>{portion.label} · {formatAmount(portion.grams)} g</option>)}
              </select></label>
            </div>
            <p id="portion-note" className={styles.portionNote}>
              {grams > 0 ? <>
                <span>= <strong>{formatAmount(grams)} g</strong></span>
                {chosenPortion && (chosenPortion.estimate === false
                  ? <span>{selected.source === CUSTOM_SOURCE ? "your saved serving" : "serving from the package label"}</span>
                  : <span className={styles.estimateBadge}>Portion estimate</span>)}
              </> : <span>Enter an amount</span>}
            </p>
            {chosenPortion && chosenPortion.estimate !== false && <p className={styles.portionSource}>
              {derived && chosenPortion === derived.portion
                ? `Worked out from USDA's ${derived.from.label} = ${formatAmount(derived.from.grams)} g (US measures).`
                : `USDA average for ${chosenPortion.label}: ${formatAmount(chosenPortion.grams)} g.`} Real pieces and cups vary; weigh it for an exact log.
            </p>}
            {amountPrompt && <div className={styles.prompt} role="status">
              <p>{amountPrompt.message}</p>
              {amountPrompt.grams !== null && <button type="button" className="fitx-button fitx-button-secondary min-h-10 justify-self-start px-3 text-xs" onClick={() => { setAmount(String(amountPrompt.grams)); setUnitKey("g"); setAmountPrompt(null); }}>Use {amountPrompt.grams} g</button>}
            </div>}
            <label className="mt-3 block text-xs text-fitx-text-secondary">Meal<select className="fitx-field mt-1.5" value={meal} onChange={(event) => setMeal(event.target.value)}>{meals.map((name) => <option key={name}>{name}</option>)}</select></label>
            <button onClick={() => void logFood(selected)} disabled={busy} className="fitx-button mt-4 w-full">{busy ? "Saving…" : "Add to log"}</button>
          </> : <EmptyState title="Choose a food" description="Search the database or look up a product barcode to see its serving nutrition here."/>}
          <details className="mt-4 border-t border-fitx-divider pt-3">
            <summary className="cursor-pointer text-sm text-fitx-text-secondary">Add a custom food</summary>
            <form onSubmit={saveCustomFood} className="mt-3 grid grid-cols-2 gap-2">
              <p className="col-span-2 text-[11px] leading-5 text-fitx-text-disabled">Enter the values for one serving, from the label or your recipe. Saving adds it to your foods, not to today&apos;s log.</p>
              {([["name", "Food name"], ["brand", "Brand"], ["grams", "Serving size (g)"], ["calories", "Calories per serving"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"]] as const).map(([key, label]) => <label key={key} className={`text-[11px] text-fitx-text-secondary ${key === "name" || key === "brand" ? "col-span-2" : ""}`}>{label}<input className="fitx-field mt-1" required={key !== "brand"} type={key === "name" || key === "brand" ? "text" : "number"} min={key === "grams" ? "1" : "0"} step="any" value={custom[key]} onChange={(event) => setCustom((old) => ({ ...old, [key]: event.target.value }))}/></label>)}
              <button disabled={busy} className="fitx-button col-span-2 mt-1 w-full">Save food</button>
            </form>
          </details>
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
      {tab === "meals" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-4 font-medium">Meals · {readableDate(date)}</h2>{loading ? <p className="text-sm text-fitx-text-secondary">Loading meals…</p> : entries.length ? <div className={`${styles.page} space-y-5`}>{meals.map((mealName) => { const rows = entries.filter((item) => item.meal === mealName); return <div key={mealName}><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Coffee size={15} className="text-fitx-primary"/>{mealName}<span className="text-xs font-normal text-fitx-text-disabled">{Math.round(sumMacros(rows).calories)} kcal</span></h3>{rows.length ? <div className="space-y-2">{rows.map((row) => {
        const portion = row.nutrition_snapshot?.portion;
        const amountText = portion && row.serving_size ? row.serving_size : `${formatAmount(Number(row.quantity_grams) || Number(row.servings) * 100)} g`;
        return <div key={row.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3"><Utensils size={15} className="shrink-0 text-fitx-text-disabled"/><div className="min-w-0 flex-1"><p className="truncate text-sm">{row.food_name}</p><p className="text-xs text-fitx-text-secondary">{amountText}{portion?.estimate && <span className={styles.estimateBadge}>estimate</span>}</p><p className="text-xs text-fitx-text-disabled">P {Math.round(Number(row.protein))} g · C {Math.round(Number(row.carbs))} g · F {Math.round(Number(row.fat))} g</p></div><span className="text-xs text-fitx-text-secondary">{Math.round(Number(row.calories))} kcal</span><button onClick={() => void removeMeal(row.id)} aria-label={`Remove ${row.food_name}`} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-disabled hover:bg-fitx-surface-variant hover:text-fitx-primary"><X size={15}/></button></div>;
      })}</div> : <p className="py-2 text-xs text-fitx-text-disabled">Nothing logged yet.</p>}</div>; })}</div> : <EmptyState title="No meals logged" description="Use Log Food to find a food or enter your own nutrition details." action={<button onClick={() => setTab("log")} className="text-sm text-fitx-primary">Log a food</button>}/>}</section>}
      {tab === "insights" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-2 font-medium">Daily nutrition insights</h2><p className="mb-5 text-sm text-fitx-text-secondary">This view summarizes the food you have logged for the selected day.</p>{entries.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([["Energy", Math.round(totals.calories), "kcal", target?.calories], ["Protein", Math.round(totals.protein), "g", target?.protein], ["Carbohydrates", Math.round(totals.carbs), "g", target?.carbs], ["Fat", Math.round(totals.fat), "g", target?.fat]] as const).map(([label, value, unit, goal]) => { const progress = goal ? goalProgress(value, goal) : null; return <div key={label} className="rounded-xl border border-fitx-border bg-fitx-surface p-4"><p className="text-xs text-fitx-text-secondary">{label}</p><p className="mt-2 text-2xl font-semibold">{value} <span className="text-sm font-normal text-fitx-text-disabled">{unit}</span></p>{progress && <p className={`mt-2 text-xs ${progress.isOver ? styles.macroOver : "text-fitx-text-disabled"}`}>{progress.isOver ? `${progress.over} ${unit} over the estimated target` : `${progress.percent}% of estimated target`}</p>}</div>; })}</div> : <EmptyState title="No nutrition data yet" description="Logged meals will be summarized here."/>}</section>}
      {tab === "database" && <section className="fitx-panel p-4 sm:p-5">
        <h2 className="mb-2 font-medium">Food database</h2>
        <p className="mb-3 text-sm text-fitx-text-secondary">Search looks at FITX staples first: common Indian dishes and cooked rice from USDA FoodData Central, with USDA&apos;s piece and cup weights. Then it checks a USDA Foundation Foods snapshot (April 2026), live USDA search when this server has a key, and Open Food Facts for packaged products. Amounts worked out from a piece or cup weight are marked as portion estimates. Your custom foods are private to your account.</p>
        {usdaLive && <p className="mb-4 text-xs text-fitx-text-disabled">Live USDA search: {usdaLive.status === "not_configured" ? "not set up on this server" : "on"}.{visibleSources.length > 0 && <> Last search: {visibleSources.map(sourceText).join(" · ")}.</>}</p>}
        <button onClick={() => setTab("log")} className="fitx-button"><Search size={15}/>Search foods</button>
        <h3 className="mb-3 mt-6 font-medium">My custom foods</h3>
        {customFoods.length ? <div className="grid gap-2 sm:grid-cols-2">{customFoods.map((food) => <div key={food.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{food.name}</p><p className="mt-1 truncate text-xs text-fitx-text-secondary">{food.brand || "Custom food"} · {Math.round(food.calories)} kcal per 100 g · serving {formatAmount(food.portions?.[0]?.grams ?? 100)} g</p></div><button onClick={() => { chooseFood(food); setTab("log"); }} className="fitx-button fitx-button-secondary px-3">Use</button></div>)}</div> : <EmptyState title="No custom foods saved" description="Add a food from its label in the Log Food panel to keep it in your private database." action={<button onClick={() => setTab("log")} className="text-sm text-fitx-primary">Add a custom food</button>}/>}
      </section>}
    </div>
  );
}
