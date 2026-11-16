"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownWideNarrow, ArrowRight, Bookmark, BookmarkCheck, Dumbbell, Filter, House, Search, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { ExerciseThumbnail } from "@/components/exercises/ExerciseMedia";
import { readExerciseFavorites, readRecentExercises, toggleExerciseFavorite } from "@/lib/domain/exercise-preferences";
import { createClient } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { catalogSearchQuery, MAX_IDS } from "@/lib/training/catalog-search";
import { equipmentFor, loadEquipmentProfiles, type EquipmentProfiles } from "@/lib/training/data";
import { equipmentLabel, expandOwnedEquipment } from "@/lib/training/equipment";
import { FREE_EXERCISE_DB_SOURCE_URL } from "@/lib/training/media";
import { CATEGORY_LABELS, EQUIPMENT, EXERCISE_CATEGORIES, LEVELS, MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type TrainingContext } from "@/lib/training/taxonomy";
import { capitalize, workPerSet } from "./_lib/format";
import { activeFilterCount, libraryApiQuery, readLibraryState, withLibraryParam, withoutLibraryFilters, type LibraryParam } from "./_lib/library-state";

type Item = CatalogExercise & { thumbnail: string | null };
type LibraryPage = { items: Item[]; total: number; page: number; pageSize: number; curated: boolean };
type Results = LibraryPage & { key: string };
type Failure = { key: string; message: string; status: number };
type Account =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "signed-out" }
  | { status: "ready"; profiles: EquipmentProfiles; legacyWords: string[]; failed: boolean };

const SEARCH_DELAY_MS = 250;
const RECENT_LIMIT = 6;
const LIBRARY_ERROR = "The exercise library could not be loaded. Check your connection and try again.";
const CONTEXT_TITLES: Record<TrainingContext, string> = { home: "Home Workout", gym: "Gym Workout" };

function subscribeToUrl(callback: () => void) { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); }
function currentSearch() { return window.location.search; }
function useUrlSearch() { return useSyncExternalStore(subscribeToUrl, currentSearch, () => ""); }

/** One page from GET /api/exercises; null when the request was cancelled. */
async function fetchLibraryPage(query: string, page: number, signal?: AbortSignal): Promise<{ body: LibraryPage } | { error: string; status: number } | null> {
  const params = new URLSearchParams(query);
  if (page > 1) params.set("page", String(page));
  try {
    const response = await fetch(`/api/exercises?${params.toString()}`, { signal, headers: { Accept: "application/json" } });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : LIBRARY_ERROR;
      return { error: message, status: response.status };
    }
    return { body: body as LibraryPage };
  } catch {
    return signal?.aborted ? null : { error: LIBRARY_ERROR, status: 0 };
  }
}

/** "Dumbbells, Weight bench and 3 more"; "no equipment" for an empty list. */
function listText(keys: readonly string[]) {
  if (!keys.length) return "no equipment (body weight only)";
  const labels = keys.map(equipmentLabel);
  return labels.length <= 4 ? labels.join(", ") : `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;
}

export default function ExerciseLibraryPage() {
  const searchString = useUrlSearch();
  const state = useMemo(() => readLibraryState(searchString), [searchString]);
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [userId, setUserId] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<{ key: string; loading: boolean; error: string } | null>(null);
  const [recent, setRecent] = useState<{ key: string; items: Item[] } | null>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setAccount({ status: "unavailable" }); return; }
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const uid = data.user?.id ?? "";
      // Saved and recent exercises are keyed by user; they work before the equipment lists arrive.
      setUserId(uid);
      setFavoriteIds(readExerciseFavorites(uid));
      setRecentIds(readRecentExercises(uid));
      if (!uid) { setAccount({ status: "signed-out" }); return; }
      const [lists, preferences] = await Promise.all([
        loadEquipmentProfiles(supabase, uid),
        supabase.from("user_preferences").select("equipment").eq("user_id", uid).maybeSingle(),
      ]);
      if (!active) return;
      const words = (preferences.data as { equipment?: string[] | null } | null)?.equipment;
      setAccount({ status: "ready", profiles: lists.profiles, legacyWords: Array.isArray(words) ? words : [], failed: Boolean(lists.error) });
    })();
    return () => { active = false; };
  }, []);

  const list = useMemo(() => (account.status === "ready" ? equipmentFor(account.profiles, state.context, account.legacyWords) : null), [account, state.context]);
  const owned = useMemo(() => (list ? [...expandOwnedEquipment(list.keys)] : null), [list]);
  // Without an account there is no list to check against, so the toggle cannot apply.
  const doableAvailable = account.status === "loading" || account.status === "ready";
  const doable = state.doable && doableAvailable;
  const noFavorites = favoritesOnly && favoriteIds.length === 0;
  const queryKey = noFavorites ? null : libraryApiQuery({ ...state, doable }, owned, favoritesOnly ? favoriteIds.slice(0, MAX_IDS) : null);

  useEffect(() => {
    if (!queryKey) return;
    const controller = new AbortController();
    // The first page loads at once; later changes (typing, filters) wait for a short pause.
    const timer = window.setTimeout(() => {
      void fetchLibraryPage(queryKey, 1, controller.signal).then((outcome) => {
        if (!outcome) return;
        if ("error" in outcome) { setFailure({ key: queryKey, message: outcome.error, status: outcome.status }); return; }
        loadedOnce.current = true;
        setResults({ ...outcome.body, key: queryKey });
      });
    }, loadedOnce.current ? SEARCH_DELAY_MS : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [queryKey, attempt]);

  const filterCount = activeFilterCount(state) + Number(favoritesOnly);
  const showRecent = !state.q.trim() && filterCount === 0 && !doable;
  const recentKey = showRecent && recentIds.length ? catalogSearchQuery({ ids: recentIds.slice(0, RECENT_LIMIT), pageSize: RECENT_LIMIT }).toString() : null;
  useEffect(() => {
    if (!recentKey) return;
    const controller = new AbortController();
    void fetchLibraryPage(recentKey, 1, controller.signal).then((outcome) => {
      if (outcome && "body" in outcome) setRecent({ key: recentKey, items: outcome.body.items });
    });
    return () => controller.abort();
  }, [recentKey]);
  const recentItems = useMemo(() => {
    if (!recent || recent.key !== recentKey) return [];
    const byId = new Map(recent.items.map((item) => [item.id, item]));
    return recentIds.map((id) => byId.get(id)).filter((item): item is Item => Boolean(item));
  }, [recent, recentKey, recentIds]);

  const current = results && results.key === queryKey ? results : null;
  const error = !noFavorites && failure && failure.key === queryKey && !current ? failure : null;
  // While new results load, the previous ones stay on screen (dimmed) instead of a blank grid.
  const shown = current ?? (results && results.items.length ? results : null);
  const updating = !noFavorites && !error && !current;
  const moreState = more && more.key === queryKey ? more : null;

  function navigate(search: string) {
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  function setParam(key: LibraryParam, value: string | boolean | null) { navigate(withLibraryParam(window.location.search, key, value)); }
  function clearFilters() { navigate(withoutLibraryFilters(window.location.search)); setFavoritesOnly(false); }
  function toggleFavorite(id: string) { if (userId) setFavoriteIds(toggleExerciseFavorite(userId, id)); }
  function retry() { setFailure(null); setAttempt((value) => value + 1); }

  async function loadMore() {
    if (!current || !queryKey) return;
    const key = queryKey;
    setMore({ key, loading: true, error: "" });
    const outcome = await fetchLibraryPage(key, current.page + 1);
    if (!outcome) return;
    if ("error" in outcome) { setMore({ key, loading: false, error: outcome.error }); return; }
    setMore(null);
    setResults((previous) => {
      if (!previous || previous.key !== key) return previous;
      const seen = new Set(previous.items.map((item) => item.id));
      return { ...outcome.body, key, items: [...previous.items, ...outcome.body.items.filter((item) => !seen.has(item.id))] };
    });
  }

  const contextName = state.context === "home" ? "Home" : "Gym";
  const emptyTitle = noFavorites ? "No saved exercises yet" : doable ? `Nothing matches your ${contextName.toLowerCase()} equipment` : "No matching exercises";
  const emptyDescription = noFavorites
    ? "Save a movement with the bookmark control to keep it close on this device."
    : doable
      ? `Turn off “Doable with my equipment”, clear a filter, or add equipment to your ${contextName} list on the Workouts page.`
      : "Try a broader search or clear one of the active filters.";

  return (
    <div className="space-y-6 sm:space-y-7">
      <PageHeading title="Exercise library" description="Explore the movements in your FITX training library. Choose where you train, then filter by muscle group, category, equipment and difficulty." actions={<Link href="/workouts" className="fitx-button fitx-button-secondary">Build a workout<ArrowRight size={15} /></Link>} />
      <p className="-mt-4 text-xs leading-5 text-fitx-text-secondary">Movement guidance and photos are adapted from <a className="text-fitx-primary-text underline underline-offset-2" href={FREE_EXERCISE_DB_SOURCE_URL} target="_blank" rel="noreferrer">Free Exercise DB</a>. The photos are stills, not animated demonstrations.</p>

      <section aria-label="Where you train" className="fitx-panel space-y-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Where you train" className="grid grid-cols-2 gap-1 rounded-lg border border-fitx-border bg-fitx-surface-variant p-1 lg:w-[360px]">
            {(["home", "gym"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={state.context === value} onClick={() => setParam("context", value)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${state.context === value ? "bg-fitx-card text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}>
                {value === "home" ? <House size={16} aria-hidden="true" /> : <Dumbbell size={16} aria-hidden="true" />}{CONTEXT_TITLES[value]}
              </button>
            ))}
          </div>
          <button type="button" role="switch" aria-checked={doable} disabled={!doableAvailable} onClick={() => setParam("doable", !state.doable)}
            className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-left text-sm font-medium disabled:opacity-60">
            <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${doable ? "bg-fitx-primary" : "bg-fitx-track"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fitx-surface shadow-sm transition-transform motion-reduce:transition-none ${doable ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </span>
            Doable with my equipment
          </button>
        </div>
        <EquipmentNote account={account} context={state.context} keys={list?.keys ?? null} saved={list?.saved ?? false} />
      </section>

      <section aria-label="Exercise search and filters" className="fitx-panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search size={17} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
            <input className="fitx-field pl-11" type="search" value={state.q} onChange={(event) => setParam("q", event.target.value)} placeholder="Search exercises by name" aria-label="Search exercises by name" list="fitx-exercise-suggestions" />
            <datalist id="fitx-exercise-suggestions">{state.q.trim() ? (current?.items ?? []).slice(0, 8).map((item) => <option key={item.id} value={item.name} />) : null}</datalist>
          </label>
          <div className="flex gap-2">
            <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)} className={`fitx-button min-h-12 flex-1 px-3 sm:flex-none ${favoritesOnly ? "" : "fitx-button-secondary"}`}><Bookmark size={15} aria-hidden="true" />Saved <span className="tabular-nums">{favoriteIds.length}</span></button>
            <button type="button" aria-expanded={filtersOpen} aria-controls="exercise-filter-options" onClick={() => setFiltersOpen((value) => !value)} className="fitx-button fitx-button-secondary min-h-12 px-3"><Filter size={15} aria-hidden="true" />Filters{filterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-fitx-primary px-1 text-[10px] text-fitx-on-primary">{filterCount}</span>}</button>
          </div>
        </div>

        {filtersOpen && <div id="exercise-filter-options" className="mt-3 grid gap-3 border-t border-fitx-divider pt-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Muscle group<select className="fitx-field min-h-11" value={state.muscle ?? ""} onChange={(event) => setParam("muscle", event.target.value)}><option value="">All muscle groups</option>{MUSCLE_GROUPS.map((value) => <option key={value} value={value}>{MUSCLE_GROUP_LABELS[value]}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Category<select className="fitx-field min-h-11" value={state.category ?? ""} onChange={(event) => setParam("category", event.target.value)}><option value="">All categories</option>{EXERCISE_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Uses equipment<select className="fitx-field min-h-11" value={state.equipment ?? ""} onChange={(event) => setParam("equipment", event.target.value)}><option value="">Any equipment</option>{EQUIPMENT.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Difficulty<select className="fitx-field min-h-11" value={state.difficulty ?? ""} onChange={(event) => setParam("difficulty", event.target.value)}><option value="">All levels</option>{LEVELS.map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-medium text-fitx-text-secondary">Sort by<select className="fitx-field min-h-11" value={state.sort} onChange={(event) => setParam("sort", event.target.value)}><option value="name">Exercise name</option><option value="difficulty">Difficulty, then name</option></select></label>
          {filterCount > 0 && <button type="button" onClick={clearFilters} className="inline-flex min-h-10 items-center gap-2 justify-self-start text-xs font-semibold text-fitx-primary-text"><X size={14} aria-hidden="true" />Clear filters</button>}
        </div>}
        {current && !current.curated && <p className="mt-3 text-xs leading-5 text-fitx-text-secondary">Some filters are approximate until FITX’s exercise catalogue update is applied.</p>}
      </section>

      {recentItems.length > 0 && showRecent && <section aria-label="Recently viewed exercises" className="space-y-2"><div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Recently viewed</h2><span className="text-[11px] text-fitx-text-secondary">Saved on this device</span></div><div className="flex gap-2 overflow-x-auto pb-1">{recentItems.map((item) => <Link key={item.id} href={`/exercises/${item.id}`} className="min-w-48 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2.5 text-xs transition-colors hover:border-fitx-primary/45"><span className="block truncate font-medium">{item.name}</span><span className="mt-1 block truncate text-fitx-text-secondary">{MUSCLE_GROUP_LABELS[item.muscle_group]}</span></Link>)}</div></section>}

      <section aria-label="Exercise results" aria-busy={updating} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-fitx-divider pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-fitx-primary-text">{CONTEXT_TITLES[state.context]}{doable ? " · doable with your equipment" : ""}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{noFavorites ? "No saved movements" : current ? `${current.total.toLocaleString()} ${current.total === 1 ? "movement" : "movements"}` : error ? "Exercises unavailable" : "Loading exercises"}</h2>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-fitx-text-secondary"><ArrowDownWideNarrow size={13} aria-hidden="true" />{state.sort === "name" ? "A–Z" : "Difficulty"}</p>
        </div>
        <p className="sr-only" role="status">{current ? `${current.total} ${current.total === 1 ? "movement" : "movements"} found` : ""}</p>

        {error ? <div role="alert" className="fitx-alert fitx-alert-danger">{error.message}{error.status === 401
          ? <Link className="fitx-alert-action" href="/signin?next=%2Fexercises">Sign in again</Link>
          : <button type="button" className="fitx-alert-action" onClick={retry}>Try again</button>}</div>
          : noFavorites || (current && current.items.length === 0)
            ? <EmptyState title={emptyTitle} description={emptyDescription} action={noFavorites ? undefined : <button type="button" className="fitx-button fitx-button-secondary" onClick={clearFilters}>Clear search and filters</button>} />
            : shown
              ? <>
                <div className={`grid gap-3 transition-opacity motion-reduce:transition-none sm:grid-cols-2 xl:grid-cols-3 ${current ? "" : "opacity-60"}`}>
                  {shown.items.map((item) => <ExerciseCard key={item.id} item={item} favorite={favoriteIds.includes(item.id)} onToggleFavorite={() => toggleFavorite(item.id)} />)}
                </div>
                {current && <div className="flex flex-col items-center gap-2 pt-1">
                  <p className="text-xs text-fitx-text-secondary">Showing {current.items.length.toLocaleString()} of {current.total.toLocaleString()}</p>
                  {current.items.length < current.total && <button type="button" className="fitx-button fitx-button-secondary min-h-11" disabled={moreState?.loading} onClick={() => void loadMore()}>{moreState?.loading ? "Loading…" : "Load more movements"}</button>}
                  {moreState?.error && <p role="alert" className="fitx-alert fitx-alert-danger">{moreState.error}<button type="button" className="fitx-alert-action" onClick={() => void loadMore()}>Try again</button></p>}
                </div>}
              </>
              : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading exercises">{Array.from({ length: 6 }, (_, index) => <div key={index} className="fitx-panel overflow-hidden"><div className="aspect-[4/3] animate-pulse bg-fitx-surface-variant" /><div className="space-y-2 p-4"><div className="h-4 w-2/3 animate-pulse rounded bg-fitx-surface-variant" /><div className="h-3 w-full animate-pulse rounded bg-fitx-surface-variant" /></div></div>)}</div>}
      </section>
      <p className="text-center text-[11px] leading-5 text-fitx-text-secondary">Exercise photos and guidance are provided for general fitness education. Match loads to your own training experience and use a range of motion you can control.</p>
    </div>
  );
}

/** Which equipment list "Doable with my equipment" uses, and where to change it. */
function EquipmentNote({ account, context, keys, saved }: { account: Account; context: TrainingContext; keys: string[] | null; saved: boolean }) {
  const name = context === "home" ? "Home" : "Gym";
  if (account.status === "loading" || !keys) {
    return <p className="text-xs leading-5 text-fitx-text-secondary">{account.status === "loading" ? `Loading your ${name} equipment list…` : "Sign in to check exercises against your equipment lists."}</p>;
  }
  if (account.status !== "ready") return null;
  const source = account.failed
    ? `Your saved lists could not be loaded, so this uses a starting ${name} list: ${listText(keys)}.`
    : saved
      ? `Uses your saved ${name} list: ${listText(keys)}.`
      : context === "home"
        ? `Uses a starting Home list from your profile: ${listText(keys)}. You have not saved your own yet.`
        : `Uses a starting Gym list: a full commercial gym (${keys.length} items). You have not saved your own yet.`;
  return (
    <p className="text-xs leading-5 text-fitx-text-secondary">
      {source}{" "}
      {account.profiles.available
        ? <Link href={`/workouts?equipment=${context}`} className="font-medium text-fitx-primary-text underline underline-offset-2">Edit it on the Workouts page</Link>
        : "Saving your own list becomes available with the next FITX update."}
    </p>
  );
}

function ExerciseCard({ item, favorite, onToggleFavorite }: { item: Item; favorite: boolean; onToggleFavorite: () => void }) {
  const equipment = item.required_equipment.length ? item.required_equipment.slice(0, 2).map(equipmentLabel) : ["No equipment"];
  return (
    <article className="fitx-panel group min-w-0 overflow-hidden transition-colors hover:border-fitx-primary/35">
      <Link href={`/exercises/${item.id}`} tabIndex={-1} aria-hidden="true" className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-fitx-surface-variant"><ExerciseThumbnail exerciseId={item.id} name={item.name} src={item.thumbnail} /></div>
      </Link>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/exercises/${item.id}`} className="text-sm font-semibold leading-snug tracking-tight hover:text-fitx-primary-text">{item.name}</Link>
            <p className="mt-1 truncate text-[11px] text-fitx-text-secondary">{MUSCLE_GROUP_LABELS[item.muscle_group]} · {CATEGORY_LABELS[item.category]}</p>
          </div>
          <button type="button" aria-label={favorite ? `Remove ${item.name} from saved exercises` : `Save ${item.name}`} aria-pressed={favorite} title={favorite ? "Remove saved exercise" : "Save exercise on this device"} onClick={onToggleFavorite} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary transition-colors hover:border-fitx-primary/45 hover:text-fitx-primary">{favorite ? <BookmarkCheck size={17} aria-hidden="true" className="text-fitx-primary" /> : <Bookmark size={17} aria-hidden="true" />}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-sm bg-fitx-surface-variant px-2 py-1 text-[10px] text-fitx-text-secondary">{capitalize(item.difficulty)}</span>
          {equipment.map((label) => <span key={label} className="rounded-sm border border-fitx-border px-2 py-1 text-[10px] text-fitx-text-secondary">{label}</span>)}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-fitx-divider pt-2.5 text-[11px] text-fitx-text-secondary">
          <span>{item.recommended_sets} sets · {workPerSet(item)}</span>
          <span className="inline-flex items-center gap-1 font-medium text-fitx-primary-text" aria-hidden="true">Details<ArrowRight size={12} /></span>
        </div>
      </div>
    </article>
  );
}
