"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Barcode, Coffee, Droplets, Search, Utensils, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey, readableDate } from "@/lib/domain/dates";
import { estimateNutritionTargets, goalPercent, scaleMacros, sumMacros } from "@/lib/domain/nutrition";

type Food = { id: string; name: string; brand: string | null; image: string | null; calories: number; protein: number; carbs: number; fat: number; source: string };
type Meal = { id: string; date: string; meal: string; food_name: string; brand: string | null; barcode: string | null; servings: number; calories: number; protein: number; carbs: number; fat: number; quantity_grams: number | null; source: string };
type Profile = { age: number | null; gender: string | null; height: number | null; weight: number | null };
type Prefs = { activity_level: string; primary_goal: string; daily_water_goal_ml: number };
const meals = ["Breakfast", "Lunch", "Dinner", "Snack"];

export default function NutritionPage() {
  const [date, setDate] = useState(() => new Date());
  const [entries, setEntries] = useState<Meal[]>([]);
  const [customFoods, setCustomFoods] = useState<Food[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(2500);
  const [target, setTarget] = useState<ReturnType<typeof estimateNutritionTargets>>(null);
  const [query, setQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState("100");
  const [meal, setMeal] = useState("Breakfast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"log" | "meals" | "insights" | "database">("log");
  const [custom, setCustom] = useState({ name: "", brand: "", calories: "", protein: "", carbs: "", fat: "", grams: "100" });
  const dateKey = localDateKey(date);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    if (!supabase) { setError("Nutrition tracking is not connected to Supabase."); setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sign in to track food and water."); setLoading(false); return; }
    const [mealResult, waterResult, profileResult, prefsResult, customFoodResult] = await Promise.all([
      supabase.from("meals").select("id,date,meal,food_name,brand,barcode,servings,calories,protein,carbs,fat,quantity_grams,source").eq("user_id", auth.user.id).eq("date", dateKey).order("created_at", { ascending: true }),
      supabase.from("water_logs").select("amount_ml").eq("user_id", auth.user.id).eq("local_date", dateKey),
      supabase.from("profiles").select("age,gender,height,weight").eq("id", auth.user.id).maybeSingle(),
      supabase.from("user_preferences").select("activity_level,primary_goal,daily_water_goal_ml").eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("custom_foods").select("id,name,brand,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g").eq("user_id", auth.user.id).order("name").limit(200),
    ]);
    const failure = [mealResult.error, waterResult.error, profileResult.error, prefsResult.error, customFoodResult.error].find(Boolean);
    if (failure) setError("Your nutrition data could not be loaded. Please try again.");
    else {
      setEntries((mealResult.data || []) as Meal[]);
      setWaterMl(((waterResult.data || []) as Array<{ amount_ml: number }>).reduce((sum: number, row) => sum + Number(row.amount_ml || 0), 0));
      const prefs = prefsResult.data as Prefs | null;
      setWaterGoal(prefs?.daily_water_goal_ml || 2500);
      setTarget(estimateNutritionTargets((profileResult.data || {}) as Profile, prefs?.activity_level, prefs?.primary_goal));
      setCustomFoods(((customFoodResult.data || []) as Array<{ id: string; name: string; brand: string | null; calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number }>).map((food) => ({
        id: food.id, name: food.name, brand: food.brand, image: null, calories: Number(food.calories_per_100g), protein: Number(food.protein_per_100g), carbs: Number(food.carbs_per_100g), fat: Number(food.fat_per_100g), source: "FITX custom food",
      })));
      setError("");
    }
    setLoading(false);
  }, [dateKey]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const totals = useMemo(() => sumMacros(entries), [entries]);
  const selectedMacros = selected ? scaleMacros(selected, Number(grams)) : null;

  function shiftDate(offset: number) {
    setDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset));
  }

  const lookupBarcode = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/foods/search?barcode=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Barcode lookup failed.");
      setResults(data.foods || []);
      if (!data.foods?.length) setError("No nutrition label was found for that barcode. You can add it as a custom food below.");
      else setSelected(data.foods[0]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Barcode lookup failed."); }
    finally { setBusy(false); }
  }, []);

  const onBarcodeDetected = useCallback((value: string) => {
    setBarcode(value);
    void lookupBarcode(value);
  }, [lookupBarcode]);

  async function findBarcode(event: FormEvent) {
    event.preventDefault();
    await lookupBarcode(barcode);
  }

  async function searchFoods(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) { setResults([]); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/foods/search?q=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Food search failed.");
      setResults(data.foods || []);
      if (!data.foods?.length) setError("No matching food was found. Try another search or add a custom food.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Food search is temporarily unavailable."); }
    finally { setBusy(false); }
  }

  async function logFood(food: Food, providerId?: string, quantity = grams) {
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) { setError("Enter a serving between 1 and 5,000 grams."); return; }
    const supabase = createClient();
    if (!supabase) return setError("Nutrition tracking is not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to log food.");
    setBusy(true); setError("");
    const scaled = scaleMacros(food, amount);
    const inserted = await supabase.from("meals").insert({
      user_id: auth.user.id, date: dateKey, meal, food_name: food.name, brand: food.brand,
      barcode: food.source === "Open Food Facts" ? food.id : null, provider_id: providerId || food.id,
      source: food.source, serving_size: `${amount} g`, servings: amount / 100, quantity_grams: amount,
      calories: scaled.calories, protein: scaled.protein, carbs: scaled.carbs, fat: scaled.fat,
      nutrition_snapshot: { per_100g: { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }, source: food.source },
    });
    if (inserted.error) setError("That food could not be logged. Please try again.");
    else { setSelected(null); setQuery(""); setResults([]); await load(); }
    setBusy(false);
  }

  async function addWater(amount: number) {
    const supabase = createClient();
    if (!supabase) return setError("Water tracking is not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to log water.");
    setBusy(true);
    const result = await supabase.from("water_logs").insert({ user_id: auth.user.id, amount_ml: amount, local_date: dateKey });
    if (result.error) setError("Water could not be logged."); else setWaterMl((current) => current + amount);
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

  async function saveCustomFood(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return setError("Custom foods are not connected to Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to save a custom food.");
    const portion = Number(custom.grams);
    const parsed = [custom.calories, custom.protein, custom.carbs, custom.fat].map(Number);
    if (!custom.name.trim() || !Number.isFinite(portion) || portion <= 0 || parsed.some((value) => !Number.isFinite(value) || value < 0)) { setError("Add a name, serving size, and valid nutrition values."); return; }
    setBusy(true); setError("");
    const result = await supabase.from("custom_foods").insert({
      user_id: auth.user.id, name: custom.name.trim(), brand: custom.brand.trim() || null,
      serving_size: `${portion} g`, serving_grams: portion, calories_per_100g: parsed[0] * 100 / portion,
      protein_per_100g: parsed[1] * 100 / portion, carbs_per_100g: parsed[2] * 100 / portion, fat_per_100g: parsed[3] * 100 / portion,
    }).select("id").single();
    if (result.error) { setError("Your custom food could not be saved."); setBusy(false); return; }
    const food: Food = { id: result.data.id, name: custom.name.trim(), brand: custom.brand.trim() || null, image: null, calories: parsed[0] * 100 / portion, protein: parsed[1] * 100 / portion, carbs: parsed[2] * 100 / portion, fat: parsed[3] * 100 / portion, source: "FITX custom food" };
    await logFood(food, result.data.id, custom.grams || "100");
    setCustom({ name: "", brand: "", calories: "", protein: "", carbs: "", fat: "", grams: "100" });
  }

  return (
    <div className="space-y-5">
      <PageHeading title="Track your nutrition" description="Search a food, choose a portion, and keep a clear log of meals and water." actions={
        <div className="flex items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-2 py-1">
          <button onClick={() => shiftDate(-1)} aria-label="Previous day" className="grid h-8 w-8 place-items-center rounded text-fitx-text-secondary hover:bg-white/5"><ArrowLeft size={16}/></button>
          <span className="min-w-32 text-center text-xs text-fitx-text-secondary">{readableDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          <button onClick={() => shiftDate(1)} aria-label="Next day" className="grid h-8 w-8 place-items-center rounded text-fitx-text-secondary hover:bg-white/5"><ArrowRight size={16}/></button>
        </div>
      }/>
      <nav aria-label="Nutrition sections" className="flex gap-5 overflow-x-auto border-b border-fitx-divider text-sm">
        {([["log", "Log food"], ["meals", "Meals"], ["insights", "Insights"], ["database", "Food database"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`whitespace-nowrap border-b-2 px-1 pb-3 ${tab === value ? "border-fitx-primary text-fitx-primary" : "border-transparent text-fitx-text-secondary hover:text-fitx-text"}`}>{label}</button>)}
      </nav>
      {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
      {tab === "log" && <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)_280px]">
        <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-3 flex items-center gap-2 font-medium"><Search size={17} className="text-fitx-primary"/>Search food</h2><form onSubmit={searchFoods} className="flex gap-2"><input className="fitx-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search foods or brands" aria-label="Search foods"/><button className="fitx-button fitx-button-secondary shrink-0 px-3" disabled={busy} aria-label="Search food"><Search size={17}/></button></form><form onSubmit={findBarcode} className="mt-2 flex gap-2"><input className="fitx-field" value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Barcode number" aria-label="Barcode number"/><button className="fitx-button fitx-button-secondary shrink-0 px-3" disabled={busy} aria-label="Find barcode"><Barcode size={17}/></button></form><BarcodeScanner onDetected={onBarcodeDetected}/><div className="mt-3 flex gap-2 text-[11px] text-fitx-text-disabled"><span className="rounded bg-fitx-surface px-2 py-1">Open Food Facts</span><span className="rounded bg-fitx-surface px-2 py-1">USDA when configured</span></div><div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">{results.map((food) => <button key={food.source + food.id} onClick={() => { setSelected(food); setGrams("100"); }} className={`w-full rounded-lg border p-3 text-left transition-colors ${selected?.id === food.id ? "border-fitx-primary/70 bg-fitx-primary/5" : "border-fitx-border bg-fitx-surface hover:border-fitx-primary/30"}`}><span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-sm font-medium">{food.name}</span><span className="mt-1 block truncate text-xs text-fitx-text-secondary">{food.brand || food.source}</span></span><span className="shrink-0 text-xs text-fitx-primary">{food.calories} kcal</span></span><span className="mt-2 block text-[11px] text-fitx-text-disabled">per 100 g · P {food.protein} g · C {food.carbs} g · F {food.fat} g</span></button>)}</div></section>
        <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-4 font-medium">Add to log</h2>{selected ? <><div className="rounded-lg border border-fitx-border bg-fitx-surface p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">{selected.name}</p><p className="mt-1 text-xs text-fitx-text-secondary">{selected.brand || selected.source}</p></div><button onClick={() => setSelected(null)} aria-label="Clear selected food" className="text-fitx-text-disabled hover:text-fitx-text"><X size={16}/></button></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded bg-[#0a1011] p-2">{selectedMacros?.calories}<span className="block text-[10px] text-fitx-text-disabled">kcal</span></div><div className="rounded bg-[#0a1011] p-2">{selectedMacros?.protein} g<span className="block text-[10px] text-fitx-text-disabled">protein</span></div><div className="rounded bg-[#0a1011] p-2">{selectedMacros?.carbs} g<span className="block text-[10px] text-fitx-text-disabled">carbs</span></div></div></div><label className="mt-4 block text-xs text-fitx-text-secondary">Quantity<input className="fitx-field mt-1.5" inputMode="decimal" type="number" min="1" max="5000" value={grams} onChange={(event) => setGrams(event.target.value)}/></label><label className="mt-3 block text-xs text-fitx-text-secondary">Meal<select className="fitx-field mt-1.5" value={meal} onChange={(event) => setMeal(event.target.value)}>{meals.map((name) => <option key={name}>{name}</option>)}</select></label><button onClick={() => void logFood(selected)} disabled={busy} className="fitx-button mt-4 w-full">{busy ? "Saving…" : "Add to log"}</button></> : <EmptyState title="Choose a food" description="Search the database or look up a product barcode to see its serving nutrition here."/>}
        <details className="mt-4 border-t border-fitx-divider pt-3"><summary className="cursor-pointer text-sm text-fitx-text-secondary">Add a custom food</summary><form onSubmit={saveCustomFood} className="mt-3 grid grid-cols-2 gap-2">{([["name", "Food name"], ["brand", "Brand"], ["grams", "Serving grams"], ["calories", "Calories"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"]] as const).map(([key, label]) => <label key={key} className={`text-[11px] text-fitx-text-secondary ${key === "name" || key === "brand" ? "col-span-2" : ""}`}>{label}<input className="fitx-field mt-1" required={key !== "brand"} type={key === "name" || key === "brand" ? "text" : "number"} min={key === "grams" ? "1" : "0"} step="any" value={custom[key]} onChange={(event) => setCustom((old) => ({ ...old, [key]: event.target.value }))}/></label>)}<button disabled={busy} className="fitx-button col-span-2 mt-1 w-full">Save and log</button></form></details></section>
        <aside className="space-y-4"><section className="fitx-panel p-4 sm:p-5"><h2 className="mb-4 font-medium">Today&apos;s nutrition</h2>{target ? <><div className="relative mx-auto grid h-40 w-40 place-items-center rounded-full" style={{ background: `conic-gradient(#79df83 ${goalPercent(totals.calories, target.calories)}%, #253032 0)` }}><div className="grid h-[132px] w-[132px] place-content-center rounded-full bg-[#0b1112] text-center"><strong className="text-2xl">{Math.round(totals.calories)}</strong><span className="text-xs text-fitx-text-disabled">/ {target.calories} kcal</span></div></div><p className="mt-2 text-center text-[11px] text-fitx-text-disabled">Estimated daily target from your profile</p><div className="mt-4 space-y-3">{([["Protein", totals.protein, target.protein, "#70b6ff"], ["Carbs", totals.carbs, target.carbs, "#79df83"], ["Fat", totals.fat, target.fat, "#f4c552"]] as const).map(([label, value, max, color]) => <div key={label}><div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="text-fitx-text-secondary">{Math.round(value)} / {max} g</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#253032]"><div className="h-full rounded-full" style={{ width: `${goalPercent(value, max)}%`, background: color }}/></div></div>)}</div></> : <EmptyState title="Set up nutrition targets" description="Add your age, height, and weight in your profile to see an estimated daily target." action={<Link href="/profile" className="text-sm text-fitx-primary">Open profile</Link>}/>}</section>
        <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-3 flex items-center gap-2 font-medium"><Droplets size={17} className="text-sky-400"/>Water intake</h2><p className="mb-3 text-sm text-fitx-text-secondary">{(waterMl / 1000).toFixed(1)} L <span className="text-fitx-text-disabled">/ {(waterGoal / 1000).toFixed(1)} L</span></p><div className="mb-3 h-2 overflow-hidden rounded-full bg-[#253032]"><div className="h-full rounded-full bg-sky-400" style={{ width: `${goalPercent(waterMl, waterGoal)}%` }}/></div><div className="flex gap-2">{[250, 500].map((ml) => <button key={ml} disabled={busy} onClick={() => void addWater(ml)} className="fitx-button fitx-button-secondary flex-1">+{ml} ml</button>)}</div></section></aside>
      </div>}
      {tab === "meals" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-4 font-medium">Meals · {readableDate(date)}</h2>{loading ? <p className="text-sm text-fitx-text-secondary">Loading meals…</p> : entries.length ? <div className="space-y-5">{meals.map((mealName) => { const rows = entries.filter((item) => item.meal === mealName); return <div key={mealName}><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Coffee size={15} className="text-fitx-primary"/>{mealName}<span className="text-xs font-normal text-fitx-text-disabled">{Math.round(sumMacros(rows).calories)} kcal</span></h3>{rows.length ? <div className="space-y-2">{rows.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3"><Utensils size={15} className="text-fitx-text-disabled"/><div className="min-w-0 flex-1"><p className="truncate text-sm">{row.food_name}</p><p className="text-xs text-fitx-text-secondary">{row.quantity_grams || Math.round(Number(row.servings) * 100)} g · P {Math.round(Number(row.protein))} g · C {Math.round(Number(row.carbs))} g · F {Math.round(Number(row.fat))} g</p></div><span className="text-xs text-fitx-text-secondary">{Math.round(Number(row.calories))} kcal</span><button onClick={() => void removeMeal(row.id)} aria-label={`Remove ${row.food_name}`} className="p-2 text-fitx-text-disabled hover:text-red-300"><X size={15}/></button></div>)}</div> : <p className="py-2 text-xs text-fitx-text-disabled">Nothing logged yet.</p>}</div>; })}</div> : <EmptyState title="No meals logged" description="Use Log Food to find a food or enter your own nutrition details." action={<button onClick={() => setTab("log")} className="text-sm text-fitx-primary">Log a food</button>}/>}</section>}
      {tab === "insights" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-2 font-medium">Daily nutrition insights</h2><p className="mb-5 text-sm text-fitx-text-secondary">This view summarizes the food you have logged for the selected day.</p>{entries.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([["Energy", Math.round(totals.calories), "kcal", target?.calories], ["Protein", Math.round(totals.protein), "g", target?.protein], ["Carbohydrates", Math.round(totals.carbs), "g", target?.carbs], ["Fat", Math.round(totals.fat), "g", target?.fat]] as const).map(([label, value, unit, goal]) => <div key={label} className="rounded-xl border border-fitx-border bg-fitx-surface p-4"><p className="text-xs text-fitx-text-secondary">{label}</p><p className="mt-2 text-2xl font-semibold">{value} <span className="text-sm font-normal text-fitx-text-disabled">{unit}</span></p>{goal && <p className="mt-2 text-xs text-fitx-text-disabled">{goalPercent(value, goal)}% of estimated target</p>}</div>)}</div> : <EmptyState title="No nutrition data yet" description="Logged meals will be summarized here."/>}</section>}
      {tab === "database" && <section className="fitx-panel p-4 sm:p-5"><h2 className="mb-2 font-medium">Food database</h2><p className="mb-4 text-sm text-fitx-text-secondary">Search results use Open Food Facts. USDA FoodData Central results are included when this deployment has a USDA key configured. Your custom foods are private to your account.</p><button onClick={() => setTab("log")} className="fitx-button"><Search size={15}/>Search foods</button><h3 className="mb-3 mt-6 font-medium">My custom foods</h3>{customFoods.length ? <div className="grid gap-2 sm:grid-cols-2">{customFoods.map((food) => <div key={food.id} className="flex items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{food.name}</p><p className="mt-1 truncate text-xs text-fitx-text-secondary">{food.brand || "Custom food"} · {food.calories} kcal per 100 g</p></div><button onClick={() => { setSelected(food); setGrams("100"); setTab("log"); }} className="fitx-button fitx-button-secondary px-3">Use</button></div>)}</div> : <EmptyState title="No custom foods saved" description="Add a food from its label in the Log Food panel to keep it in your private database." action={<button onClick={() => setTab("log")} className="text-sm text-fitx-primary">Add a custom food</button>}/>}</section>}
    </div>
  );
}
