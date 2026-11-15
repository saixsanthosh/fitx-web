"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowDownWideNarrow, ArrowRight, Bookmark, BookmarkCheck, Filter, Search, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseThumbnail } from "@/components/exercises/ExerciseMedia";
import { readExerciseFavorites, readRecentExercises, toggleExerciseFavorite } from "@/lib/domain/exercise-preferences";
import { createClient } from "@/lib/supabase/client";
import type { ExerciseRecord } from "@/lib/domain/workout";

type Exercise = ExerciseRecord & { description: string };
type Filters = { muscle: string; equipment: string; movement: string; difficulty: string; location: string; sort: "name" | "difficulty" };
const DEFAULT_FILTERS: Filters = { muscle: "all", equipment: "all", movement: "all", difficulty: "all", location: "all", sort: "name" };
const PAGE_SIZE = 36;

function readable(value: string) { return value.replaceAll("_", " "); }
function subscribeToUrl(callback: () => void) { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); }
function currentSearch() { return window.location.search; }
function useUrlSearch() { return useSyncExternalStore(subscribeToUrl, currentSearch, () => ""); }

export default function ExerciseLibraryPage() {
  const [items, setItems] = useState<Exercise[]>([]);
  const searchString = useUrlSearch();
  const search = useMemo(() => new URLSearchParams(searchString).get("q") || "", [searchString]);
  const filters = useMemo<Filters>(() => {
    const params = new URLSearchParams(searchString);
    return {
      muscle: params.get("muscle") || "all",
      equipment: params.get("equipment") || "all",
      movement: params.get("movement") || "all",
      difficulty: params.get("difficulty") || "all",
      location: params.get("location") || "all",
      sort: params.get("sort") === "difficulty" ? "difficulty" : "name",
    };
  }, [searchString]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setLoading(false); setError("The exercise library is not connected to Supabase in this environment."); return; }
      const [auth, result] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("exercise_library").select("id,name,description,primary_muscle,secondary_muscles,equipment,locations,difficulty,movement_pattern,recommended_sets,reps_min,reps_max,rest_seconds,alternatives").eq("is_active", true).order("name").limit(1000),
      ]);
      if (!active) return;
      if (result.error) setError("The exercise library could not be loaded. Check your connection and try again.");
      else setItems((result.data || []) as Exercise[]);
      const uid = auth.data.user?.id || "";
      setUserId(uid);
      setFavoriteIds(readExerciseFavorites(uid));
      setRecentIds(readRecentExercises(uid));
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const options = useMemo(() => ({
    muscles: [...new Set(items.map((item) => item.primary_muscle))].sort(),
    equipment: [...new Set(items.flatMap((item) => item.equipment))].sort(),
    movements: [...new Set(items.map((item) => item.movement_pattern).filter(Boolean))].sort(),
    locations: [...new Set(items.flatMap((item) => item.locations))].sort(),
  }), [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = items.filter((item) => {
      const textMatches = !query || [item.name, item.description, item.primary_muscle, ...item.secondary_muscles, ...item.equipment, item.movement_pattern].some((part) => part.toLowerCase().includes(query));
      return textMatches
        && (filters.muscle === "all" || item.primary_muscle === filters.muscle || item.secondary_muscles.includes(filters.muscle))
        && (filters.equipment === "all" || item.equipment.includes(filters.equipment))
        && (filters.movement === "all" || item.movement_pattern === filters.movement)
        && (filters.difficulty === "all" || item.difficulty === filters.difficulty)
        && (filters.location === "all" || item.locations.includes(filters.location))
        && (!favoritesOnly || favoriteIds.includes(item.id));
    });
    const difficultyOrder = ["beginner", "intermediate", "advanced"];
    return matches.sort((a, b) => filters.sort === "difficulty"
      ? difficultyOrder.indexOf(a.difficulty) - difficultyOrder.indexOf(b.difficulty) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));
  }, [items, search, filters, favoritesOnly, favoriteIds]);

  const recentItems = useMemo(() => recentIds.map((id) => items.find((item) => item.id === id)).filter((item): item is Exercise => Boolean(item)), [items, recentIds]);
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "sort" && value !== "all").length + Number(filters.sort !== "name") + Number(favoritesOnly);

  function updateUrl(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    update(params);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setVisibleCount(PAGE_SIZE);
  }
  function clearFilters() { updateUrl((params) => ["q", "muscle", "equipment", "movement", "difficulty", "location", "sort"].forEach((key) => params.delete(key))); setFavoritesOnly(false); }
  function updateSearch(value: string) { updateUrl((params) => value.trim() ? params.set("q", value) : params.delete("q")); }
  function updateFilter(key: keyof Filters, value: string) {
    updateUrl((params) => value === DEFAULT_FILTERS[key] ? params.delete(key) : params.set(key, value));
  }
  function toggleFavorite(id: string) { setFavoriteIds(toggleExerciseFavorite(userId, id)); }

  return (
    <div className="space-y-6 sm:space-y-7">
      <PageHeading title="Exercise library" description="Explore the movements in your FITX training library. Filter by the equipment, muscles and training details each record provides." actions={<Link href="/workouts" className="fitx-button fitx-button-secondary">Build a workout<ArrowRight size={15} /></Link>} />
      <p className="-mt-4 text-xs text-fitx-text-disabled">Movement guidance and reference frames are adapted from <a className="text-fitx-primary underline underline-offset-2" href="https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5" target="_blank" rel="noreferrer">Free Exercise DB</a>. These still images are not animated demonstrations.</p>

      {error && <p role="alert" className="rounded-lg border border-fitx-border bg-fitx-surface px-4 py-3 text-sm text-fitx-text-secondary">{error}</p>}

      <section aria-label="Exercise search and filters" className="fitx-panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
            <input className="fitx-field pl-11" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search an exercise, muscle or equipment" aria-label="Search exercises" list="fitx-exercise-suggestions" />
            <datalist id="fitx-exercise-suggestions">{items.filter((item) => search && item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8).map((item) => <option key={item.id} value={item.name} />)}</datalist>
          </label>
          <div className="flex gap-2">
            <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)} className={`fitx-button min-h-12 flex-1 px-3 sm:flex-none ${favoritesOnly ? "" : "fitx-button-secondary"}`}><Bookmark size={15} />Saved <span className="tabular-nums">{favoriteIds.length}</span></button>
            <button type="button" aria-expanded={filtersOpen} aria-controls="exercise-filter-options" onClick={() => setFiltersOpen((value) => !value)} className="fitx-button fitx-button-secondary min-h-12 px-3"><Filter size={15} />Filters{activeFilterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-fitx-primary px-1 text-[10px] text-white">{activeFilterCount}</span>}</button>
          </div>
        </div>

        {filtersOpen && <div id="exercise-filter-options" className="mt-3 grid gap-3 border-t border-fitx-divider pt-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Muscle group<select className="fitx-field min-h-11" value={filters.muscle} onChange={(event) => updateFilter("muscle", event.target.value)}><option value="all">All muscle groups</option>{options.muscles.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Equipment<select className="fitx-field min-h-11" value={filters.equipment} onChange={(event) => updateFilter("equipment", event.target.value)}><option value="all">All equipment</option>{options.equipment.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Movement type<select className="fitx-field min-h-11" value={filters.movement} onChange={(event) => updateFilter("movement", event.target.value)}><option value="all">All movement types</option>{options.movements.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Difficulty<select className="fitx-field min-h-11" value={filters.difficulty} onChange={(event) => updateFilter("difficulty", event.target.value)}><option value="all">All levels</option>{["beginner", "intermediate", "advanced"].filter((value) => items.some((item) => item.difficulty === value)).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Training location<select className="fitx-field min-h-11" value={filters.location} onChange={(event) => updateFilter("location", event.target.value)}><option value="all">All locations</option>{options.locations.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Sort by<select className="fitx-field min-h-11" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}><option value="name">Exercise name</option><option value="difficulty">Difficulty, then name</option></select></label>
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="inline-flex min-h-10 items-center gap-2 justify-self-start text-xs font-semibold text-fitx-primary"><X size={14} />Clear filters</button>}
        </div>}
      </section>

      {!loading && recentItems.length > 0 && !search && !activeFilterCount && <section aria-label="Recently viewed exercises" className="space-y-2"><div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Recently viewed</h2><span className="text-[11px] text-fitx-text-disabled">Saved on this device</span></div><div className="flex gap-2 overflow-x-auto pb-1">{recentItems.slice(0, 6).map((item) => <Link key={item.id} href={`/exercises/${item.id}`} className="min-w-48 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2.5 text-xs transition-colors hover:border-fitx-primary/45"><span className="block truncate font-medium">{item.name}</span><span className="mt-1 block truncate capitalize text-fitx-text-disabled">{readable(item.primary_muscle)}</span></Link>)}</div></section>}

      <section aria-label="Exercise results" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-fitx-divider pb-3"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-fitx-primary">Movement library</p><h2 className="mt-1 text-lg font-semibold tracking-tight">{loading ? "Loading exercises" : `${filtered.length} ${filtered.length === 1 ? "movement" : "movements"}`}</h2></div><p className="flex items-center gap-1 text-[11px] text-fitx-text-disabled"><ArrowDownWideNarrow size={13} />{filters.sort === "name" ? "A–Z" : "Difficulty"}</p></div>
        {loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="fitx-panel overflow-hidden"><div className="aspect-[4/3] animate-pulse bg-fitx-surface-variant" /><div className="space-y-2 p-4"><div className="h-4 w-2/3 animate-pulse rounded bg-fitx-surface-variant" /><div className="h-3 w-full animate-pulse rounded bg-fitx-surface-variant" /></div></div>)}</div>
          : filtered.length === 0 ? <EmptyState title={favoritesOnly && favoriteIds.length === 0 ? "No saved exercises yet" : "No matching exercises"} description={favoritesOnly && favoriteIds.length === 0 ? "Save a movement with the bookmark control to keep it close on this device." : "Try a broader search or clear one of the active filters."} action={<button className="fitx-button fitx-button-secondary" onClick={clearFilters}>Clear search and filters</button>} />
          : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.slice(0, visibleCount).map((item) => {
              const favorite = favoriteIds.includes(item.id);
              return <article key={item.id} className="fitx-panel group min-w-0 overflow-hidden transition-colors hover:border-fitx-primary/35">
                <Link href={`/exercises/${item.id}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fitx-primary" aria-label={`View ${item.name}`}>
                  <div className="relative aspect-[4/3] overflow-hidden bg-fitx-surface-variant"><ExerciseThumbnail exerciseId={item.id} name={item.name} /></div>
                </Link>
                <div className="p-3.5 sm:p-4">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><Link href={`/exercises/${item.id}`} className="text-sm font-semibold leading-snug tracking-tight hover:text-fitx-primary">{item.name}</Link><p className="mt-1 truncate text-[11px] capitalize text-fitx-text-secondary">{readable(item.primary_muscle)}{item.secondary_muscles.length ? ` · ${item.secondary_muscles.slice(0, 2).map(readable).join(", ")}` : ""}</p></div><button type="button" aria-label={favorite ? `Remove ${item.name} from saved exercises` : `Save ${item.name}`} aria-pressed={favorite} title={favorite ? "Remove saved exercise" : "Save exercise on this device"} onClick={() => toggleFavorite(item.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary transition-colors hover:border-fitx-primary/45 hover:text-fitx-primary">{favorite ? <BookmarkCheck size={17} className="text-fitx-primary" /> : <Bookmark size={17} />}</button></div>
                  <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-sm bg-fitx-surface-variant px-2 py-1 text-[10px] capitalize text-fitx-text-secondary">{item.difficulty}</span>{item.equipment.slice(0, 2).map((equipment) => <span key={equipment} className="rounded-sm border border-fitx-border px-2 py-1 text-[10px] capitalize text-fitx-text-disabled">{readable(equipment)}</span>)}</div>
                  <div className="mt-3 flex items-center justify-between border-t border-fitx-divider pt-2.5 text-[10px] text-fitx-text-disabled"><span>{item.recommended_sets} sets · {item.reps_min}–{item.reps_max} reps</span><span className="inline-flex items-center gap-1 font-medium text-fitx-primary">Details<ArrowRight size={12} /></span></div>
                </div>
              </article>;
            })}</div>
            {visibleCount < filtered.length && <button type="button" className="fitx-button fitx-button-secondary mx-auto flex min-h-11" onClick={() => setVisibleCount((value) => Math.min(filtered.length, value + PAGE_SIZE))}>Show more movements</button>}
          </>}
      </section>
      <p className="text-center text-[10px] leading-5 text-fitx-text-disabled">Exercise reference frames and guidance are provided for general fitness education. Match loads to your own training experience and use a range of motion you can control.</p>
    </div>
  );
}
