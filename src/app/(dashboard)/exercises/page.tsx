"use client";

import Link from "next/link";
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bookmark, Dumbbell, House, PersonStanding, SlidersHorizontal, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActiveFilters } from "@/components/exercises/discovery/ActiveFilters";
import { DiscoverySection } from "@/components/exercises/discovery/DiscoverySection";
import { EquipmentGrid } from "@/components/exercises/discovery/EquipmentGrid";
import { ExerciseResultCard, mainMuscleLabel } from "@/components/exercises/discovery/ExerciseResultCard";
import { FilterPanel } from "@/components/exercises/discovery/FilterPanel";
import { NoResults } from "@/components/exercises/discovery/NoResults";
import { SearchField } from "@/components/exercises/discovery/SearchField";
import { FocusTiles } from "@/components/training/FocusTiles";
import { clearRecentSearches, forgetSearch, readRecentExercises, readRecentSearches, rememberSearch } from "@/lib/domain/exercise-preferences";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { focusAreaCounts, loadCatalogThumbnails, queryCatalog, relaxSuggestions, type QueryFacet, type RankedExercise } from "@/lib/training/catalog-search";
import { equipmentFor, saveEquipmentProfile } from "@/lib/training/data";
import { expandOwnedEquipment, sortEquipmentKeys } from "@/lib/training/equipment";
import { survivingExerciseIds } from "@/lib/training/exercise-merges";
import { FOCUS_AREAS } from "@/lib/training/focus";
import { FREE_EXERCISE_DB_SOURCE_URL } from "@/lib/training/media";
import { LEVELS, type Level } from "@/lib/training/taxonomy";
import styles from "@/components/exercises/discovery/Library.module.css";
import { buildVocabulary, highlightRanges, suggestSpelling } from "@/lib/training/search-terms";
import { rankSubstitutes } from "@/lib/training/substitutions";
import type { TrainingContext } from "@/lib/training/taxonomy";
import {
  browseByMuscleHref,
  canonicalLibrarySearch,
  equipmentListText,
  filterChips,
  libraryQuery,
  muscleWordFilter,
  panelFilterCount,
  quickLevel,
  readLibraryState,
  relaxLabel,
  relaxState,
  withoutChip,
  withoutFilters,
  withQuickLevel,
  writeLibraryState,
  type LibrarySort,
  type LibraryState,
} from "./_lib/library-state";
import { listsLoadNote } from "./_lib/equipment-lists";
import { replaceSearch, useCatalogue, useLibraryAccount, useSavedExercises, useUrlSearch } from "./_lib/use-library";

const PAGE_SIZE = 24;
const RECENT_SHOWN = 6;
const SECTIONS_KEY = "fitx:exercise:v1:library-sections";
const CONTEXT_TITLES: Record<TrainingContext, string> = { home: "Home", gym: "Gym" };
const LEVEL_LABELS: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const SORT_LABELS: Record<LibrarySort, string> = { best: "Best match", name: "Name, A to Z", difficulty: "Easiest first" };

type Sections = { focus: boolean; equipment: boolean };

/** Which panels the member folded away, remembered on this device (a convenience; defaults when unreadable). */
function readSections(): Sections {
  try {
    const value = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) || "{}") as Partial<Sections>;
    return { focus: value.focus !== false, equipment: value.equipment !== false };
  } catch {
    return { focus: true, equipment: true };
  }
}

function writeSections(sections: Sections) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    // Browser storage may be unavailable; the panels still open and close.
  }
}

export default function ExerciseLibraryPage() {
  const search = useUrlSearch();
  const state = useMemo(() => readLibraryState(search), [search]);
  // Results follow the URL a moment behind typing, so the field never waits for the list.
  const view = useDeferredValue(state);
  const { catalogue, retry } = useCatalogue();
  const { account, reloadProfiles, retry: retryAccount } = useLibraryAccount();
  const userId = account.status === "ready" ? account.userId : "";
  const exercises = catalogue.status === "ready" ? catalogue.exercises : null;
  const knownIds = useMemo(() => (catalogue.status === "ready" ? new Set(catalogue.exercises.map((exercise) => exercise.id)) : catalogue.status === "error" ? null : undefined), [catalogue]);
  const { saved, savedSet, toggle } = useSavedExercises(userId, knownIds);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sections, setSections] = useState<Sections>({ focus: true, equipment: true });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [limit, setLimit] = useState({ key: "", count: PAGE_SIZE });
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const requestedThumbs = useRef(new Set<string>());
  const [listNote, setListNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [savingList, setSavingList] = useState(false);

  // Links from earlier versions (?equipment=, ?location=, a single ?muscle=full_body) are rewritten once.
  useEffect(() => {
    const current = window.location.search.slice(1);
    const canonical = canonicalLibrarySearch(current);
    if (canonical !== new URLSearchParams(current).toString()) replaceSearch(canonical);
  }, []);
  useEffect(() => { void Promise.resolve().then(() => setSections(readSections())); }, []);
  useEffect(() => {
    if (!userId) return;
    void Promise.resolve().then(() => {
      setRecentSearches(readRecentSearches(userId));
      setRecentIds(survivingExerciseIds(readRecentExercises(userId)));
    });
  }, [userId]);

  const navigate = useCallback((next: LibraryState) => replaceSearch(writeLibraryState(next)), []);
  const update = (patch: Partial<LibraryState>) => navigate({ ...state, ...patch });
  const toggleSection = (key: keyof Sections) => setSections((current) => {
    const next = { ...current, [key]: !current[key] };
    writeSections(next);
    return next;
  });

  // What the member has: this search's choice, else their saved list for the context (a starting list until saved).
  const list = account.status === "ready" ? equipmentFor(account.profiles, state.context, account.legacyWords) : null;
  const haveKeys = state.have ?? list?.keys ?? null;
  const haveKey = haveKeys ? haveKeys.join(",") : null;
  const owned = useMemo(() => (haveKey === null ? null : expandOwnedEquipment(haveKey ? haveKey.split(",") : [])), [haveKey]);
  const level = account.status === "ready" ? account.level : null;
  const contextName = state.context === "home" ? "Home" : "Gym";
  const listName = state.have ? "the equipment you chose" : `your ${contextName} list`;
  const loadNote = account.status === "ready" ? listsLoadNote(account, state.context) : null;

  // Without a signed-in member there is no saved list to wait for: Saved then shows its empty state.
  const savedReady = !view.saved || saved.ready || (account.status !== "loading" && !userId);
  const query = useMemo(() => libraryQuery(view, saved.ids), [view, saved.ids]);
  const result = useMemo(() => (exercises && savedReady ? queryCatalog(exercises, query, { owned, level }) : null), [exercises, savedReady, query, owned, level]);
  const viewKey = writeLibraryState(view);
  const shownCount = limit.key === viewKey ? limit.count : PAGE_SIZE;
  const visible = useMemo(() => result?.items.slice(0, shownCount) ?? [], [result, shownCount]);
  const updating = state !== view;

  // Photos for the cards on screen: FITX's own copies where exercise_media has them, else the pinned photos.
  useEffect(() => {
    const supabase = createClient();
    const wanted = visible.map((item) => item.exercise).filter((exercise) => !requestedThumbs.current.has(exercise.id));
    if (!supabase || !wanted.length) return;
    for (const exercise of wanted) requestedThumbs.current.add(exercise.id);
    void loadCatalogThumbnails(supabase, wanted, SUPABASE_URL).then(({ thumbnails }) => {
      setThumbs((current) => {
        const next = new Map(current);
        for (const [id, url] of thumbnails) next.set(id, url);
        return next;
      });
    });
  }, [visible]);

  // "Try instead": the best exercise for the same job that the member can do.
  const alternatives = useMemo(() => {
    const found = new Map<string, CatalogExercise | null>();
    if (!exercises || !owned) return found;
    for (const item of visible) {
      if (item.doable !== false) continue;
      const [best] = rankSubstitutes(item.exercise, exercises, { owned, level: level ?? item.exercise.difficulty, doableOnly: true, limit: 1 });
      found.set(item.exercise.id, best?.exercise ?? null);
    }
    return found;
  }, [exercises, owned, level, visible]);

  // Each tile counts what choosing only that area would list, with the same filters, place and equipment as the results.
  // The tiles show only without a search, so nothing is counted while one is typed (nor with a search still deferred).
  const searching = state.q.trim().length > 0;
  const counts = useMemo(() => (exercises && savedReady && !searching ? focusAreaCounts(exercises, { ...query, q: "" }, { owned, level }) : null), [exercises, savedReady, searching, query, owned, level]);
  const focusDetails = counts
    ? Object.fromEntries(FOCUS_AREAS.map((area) => {
      const { total, doable } = counts[area];
      const text = total.toLocaleString();
      return [area, doable === null ? text : `${text} · ${doable.toLocaleString()} you can do`];
    }))
    : undefined;

  const vocabulary = useMemo(() => (exercises ? buildVocabulary(exercises.map((exercise) => exercise.name)) : null), [exercises]);
  const empty = Boolean(result && result.items.length === 0);
  const spelling = useMemo(() => {
    if (!empty || !exercises || !vocabulary || !view.q.trim()) return null;
    const corrected = suggestSpelling(view.q, vocabulary);
    return corrected && queryCatalog(exercises, { ...query, q: corrected }, { owned, level }).items.length ? corrected : null;
  }, [empty, exercises, vocabulary, view.q, query, owned, level]);
  const relax = useMemo(() => (empty && exercises ? relaxSuggestions(exercises, query, { owned, level }).slice(0, 4) : []), [empty, exercises, query, owned, level]);
  const wordFilter = useMemo(() => muscleWordFilter(state), [state]);

  const byId = useMemo(() => new Map((exercises ?? []).map((exercise) => [exercise.id, exercise])), [exercises]);
  const chips = filterChips(state);
  const chipItems = chips.map((chip) => ({ id: `${chip.key}:${chip.value}`, kind: chip.kind, label: chip.label }));
  const recentlyViewed = recentIds.map((id) => byId.get(id)).filter((exercise): exercise is CatalogExercise => Boolean(exercise)).slice(0, RECENT_SHOWN);
  const recentMatches = useMemo(() => {
    if (!result || !view.q.trim() || !recentIds.length) return [];
    const order = new Map(recentIds.map((id, index) => [id, index]));
    return result.items.filter((item) => order.has(item.exercise.id)).sort((a, b) => (order.get(a.exercise.id) ?? 0) - (order.get(b.exercise.id) ?? 0)).slice(0, 3);
  }, [result, view.q, recentIds]);

  const rememberCurrentSearch = useCallback(() => {
    if (userId && state.q.trim()) setRecentSearches(rememberSearch(userId, state.q));
  }, [userId, state.q]);

  const setHave = (keys: readonly string[]) => {
    const sorted = sortEquipmentKeys(keys);
    const same = list && sorted.join(",") === sortEquipmentKeys(list.keys).join(",");
    setListNote(null);
    update({ have: same ? null : sorted });
  };

  async function saveHaveList() {
    const supabase = createClient();
    if (!supabase || account.status !== "ready" || !state.have) return;
    setSavingList(true);
    const { error } = await saveEquipmentProfile(supabase, account.userId, state.context, state.have);
    setSavingList(false);
    if (error) { setListNote({ tone: "error", text: `Your ${contextName} list could not be saved. Check your connection and try again.` }); return; }
    await reloadProfiles({ context: state.context, keys: state.have });
    navigate({ ...state, have: null });
    setListNote({ tone: "info", text: `Saved as your ${contextName} list. Workouts uses it too.` });
  }

  const resultsTitle = !result ? (catalogue.status === "error" ? "Exercises unavailable" : "Loading exercises") : `${result.items.length.toLocaleString()} ${result.items.length === 1 ? "exercise" : "exercises"}`;
  const directCount = result && view.focus.length ? result.items.filter((item) => item.focusTier === 0).length : null;
  const levelChoice = quickLevel(state);

  const renderCard = (item: RankedExercise, index = 0) => (
    <ExerciseResultCard
      key={item.exercise.id}
      item={item}
      thumbnail={thumbs.get(item.exercise.id)}
      highlight={item.match?.matched.length ? highlightRanges(item.exercise.name, item.match.matched) : undefined}
      saved={savedSet.has(item.exercise.id)}
      canSave={Boolean(userId) && saved.ready}
      onToggleSave={() => void toggle(item.exercise.id)}
      alternative={alternatives.get(item.exercise.id) ?? null}
      listName={listName}
      onOpen={rememberCurrentSearch}
      index={index}
    />
  );

  return (
    <div>
      <PageHeader
        title="Exercise library"
        meta={exercises ? `${exercises.length.toLocaleString()} exercises` : undefined}
        actions={<>
          <Link href={browseByMuscleHref(state)} className="fitx-button fitx-button-secondary min-h-11 px-3.5 text-sm"><PersonStanding size={16} aria-hidden="true" />Browse by muscle</Link>
          <Link href="/workouts" className="fitx-button min-h-11 px-3.5 text-sm">Build a workout<ArrowRight size={15} aria-hidden="true" /></Link>
        </>}
        className="mb-5 sm:mb-7"
      />

      <div className="space-y-6 sm:space-y-8">
      <section aria-label="Search and filters" className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <SearchField
            value={state.q}
            onChange={(value) => update({ q: value })}
            onSubmit={rememberCurrentSearch}
            recent={recentSearches}
            onPickRecent={(term) => { update({ q: term }); if (userId) setRecentSearches(rememberSearch(userId, term)); }}
            onForgetRecent={(term) => { if (userId) setRecentSearches(forgetSearch(userId, term)); }}
            onClearRecent={() => { if (userId) setRecentSearches(clearRecentSearches(userId)); }}
          />
          <div className="flex gap-2">
            <button type="button" aria-pressed={state.saved} onClick={() => update({ saved: !state.saved })} disabled={!userId}
              className={`fitx-button min-h-12 flex-1 px-3.5 sm:flex-none ${state.saved ? "" : "fitx-button-secondary"}`}>
              <Bookmark size={15} aria-hidden="true" />Saved{saved.ready && <span className="tabular-nums">{saved.ids.length}</span>}
            </button>
            <button type="button" aria-expanded={filtersOpen} aria-controls="exercise-filters" onClick={() => setFiltersOpen((open) => !open)}
              className="fitx-button fitx-button-secondary min-h-12 flex-1 px-3.5 sm:flex-none">
              <SlidersHorizontal size={15} aria-hidden="true" />Filters
              {panelFilterCount(state) > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-fitx-primary px-1 text-[10px] text-fitx-on-primary">{panelFilterCount(state)}</span>}
            </button>
          </div>
        </div>
        <div role="group" aria-label="Level" className={`${styles.rail} -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0`}>
          {([null, ...LEVELS] as const).map((level) => {
            const on = levelChoice === level;
            return (
              <button key={level ?? "all"} type="button" aria-pressed={on} onClick={() => navigate(withQuickLevel(state, level))}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm transition-colors motion-reduce:transition-none ${on ? "border-fitx-primary bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:text-fitx-text"}`}>
                {level ? LEVEL_LABELS[level] : "All levels"}
              </button>
            );
          })}
        </div>
        {wordFilter && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-fitx-text-secondary">
            <Sparkles size={14} aria-hidden="true" className="text-fitx-primary" />
            <span>“{wordFilter.word}” reads as {wordFilter.label.toLowerCase()}.</span>
            <button type="button" onClick={() => navigate(wordFilter.next)} className="inline-flex min-h-11 items-center font-semibold text-fitx-primary-text underline underline-offset-4">Filter by {wordFilter.label}</button>
          </p>
        )}
        {filtersOpen && <div className="fitx-panel p-3.5 sm:p-5"><FilterPanel id="exercise-filters" state={state} onChange={navigate} /></div>}
        {catalogue.status === "ready" && !catalogue.curated && <p className="m-0 text-xs text-fitx-text-secondary">Some filters are approximate until the catalogue update is applied.</p>}
        {account.status === "error" && (
          <p role="alert" className="fitx-alert fitx-alert-danger m-0">
            Your equipment and saved exercises could not be loaded.
            <button type="button" className="fitx-alert-action" onClick={retryAccount}>Try again</button>
          </p>
        )}
        {saved.problem && <p role="alert" className="fitx-alert fitx-alert-danger m-0">{saved.problem}</p>}
        {saved.moved > 0 && <p role="status" className="m-0 text-xs text-fitx-text-secondary">{saved.moved === 1 ? "1 saved exercise" : `${saved.moved} saved exercises`} moved from this device to your account.</p>}
        <ActiveFilters chips={chipItems} onRemove={(id) => {
          const chip = chips.find((item) => `${item.key}:${item.value}` === id);
          if (chip) navigate(withoutChip(state, chip));
        }} onClearAll={() => navigate(withoutFilters(state))} />
      </section>

      {!searching && (
        <section aria-labelledby="focus-title" className="grid gap-3">
          <h2 id="focus-title" className="m-0 font-heading text-lg font-semibold tracking-[-.02em]">Focus</h2>
          <FocusTiles value={state.focus} onChange={(focus) => update({ focus })} details={focusDetails} layout="rail" credit={false} />
        </section>
      )}

      {!searching && (
        <DiscoverySection id="equipment" title="Equipment" open={sections.equipment} onToggle={() => toggleSection("equipment")}
          summary={account.status === "loading" ? "Loading your lists…" : account.status === "error" && !haveKeys ? "Your lists could not be loaded." : haveKeys ? `${state.have ? "This search" : list?.saved ? `Your ${contextName} list` : `Starting ${contextName} list`}: ${equipmentListText(haveKeys)}` : "Sign in to match your equipment."}
          actions={(
            <div role="group" aria-label="Where you train" className="grid grid-cols-2 gap-1 rounded-full border border-fitx-border bg-fitx-surface-variant p-1">
              {(["home", "gym"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={state.context === value} onClick={() => { setListNote(null); update({ context: value, have: null }); }}
                  className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${state.context === value ? "bg-fitx-card text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text"}`}>
                  {value === "home" ? <House size={15} aria-hidden="true" /> : <Dumbbell size={15} aria-hidden="true" />}{value === "home" ? "Home" : "Gym"}
                </button>
              ))}
            </div>
          )}>
          <div className="grid gap-4">
            <EquipmentGrid value={account.status === "ready" ? haveKeys : null} onChange={setHave} context={state.context} disabled={account.status !== "ready"} />
            <div className="flex flex-col gap-3 border-t border-fitx-divider pt-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" role="switch" aria-checked={state.doable} disabled={!owned} onClick={() => update({ doable: !state.doable })}
                className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-left text-sm font-medium text-fitx-text disabled:opacity-60">
                <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${state.doable ? "bg-fitx-primary" : "bg-fitx-track"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fitx-surface shadow-sm transition-transform motion-reduce:transition-none ${state.doable ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </span>
                Only show what I can do
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {state.have && account.status === "ready" && account.profiles.available && (
                  <button type="button" onClick={() => void saveHaveList()} disabled={savingList} className="fitx-button fitx-button-secondary min-h-11 px-3.5 text-sm">
                    {savingList ? "Saving…" : `Save as my ${contextName} list`}
                  </button>
                )}
                {state.have && <button type="button" onClick={() => update({ have: null })} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-fitx-primary-text underline underline-offset-4">{list?.saved ? "Use my saved list" : "Use the starting list"}</button>}
                {!state.have && account.status === "ready" && account.profiles.available && (
                  <Link href={`/workouts?equipment=${state.context}`} className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-fitx-primary-text underline underline-offset-4">Edit list</Link>
                )}
              </div>
            </div>
            {listNote && <p role={listNote.tone === "error" ? "alert" : "status"} className={`m-0 text-sm ${listNote.tone === "error" ? "text-fitx-danger" : "text-fitx-text-secondary"}`}>{listNote.text}</p>}
            {loadNote && <p className="m-0 text-xs text-fitx-text-secondary">{loadNote}</p>}
          </div>
        </DiscoverySection>
      )}

      {!searching && chips.length === 0 && recentlyViewed.length > 0 && (
        <section aria-labelledby="recent-viewed" className="grid gap-3">
          <h2 id="recent-viewed" className="m-0 font-heading text-lg font-semibold tracking-[-.02em]">Recently viewed</h2>
          <ul className={`${styles.rail} -mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0`}>
            {recentlyViewed.map((exercise) => (
              <li key={exercise.id} className="shrink-0">
                <Link href={`/exercises/${encodeURIComponent(exercise.id)}`} className="flex min-h-14 w-48 flex-col justify-center rounded-xl border border-fitx-border bg-fitx-surface px-3.5 py-2 text-xs transition-colors hover:border-fitx-primary/45 motion-reduce:transition-none">
                  <span className="block truncate text-sm font-medium text-fitx-text">{exercise.name}</span>
                  <span className="mt-0.5 block truncate text-fitx-text-secondary">{mainMuscleLabel(exercise)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentMatches.length > 0 && (
        <section aria-labelledby="recent-matches" className="grid gap-3">
          <h2 id="recent-matches" className="m-0 text-xs font-semibold uppercase tracking-[.12em] text-fitx-text-secondary">Recent</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{recentMatches.map((item, index) => renderCard(item, index))}</div>
        </section>
      )}

      <section aria-labelledby="exercise-results" aria-busy={updating || !result} className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-primary-text">{searching ? "Results" : CONTEXT_TITLES[state.context]}</p>
            <h2 id="exercise-results" className="m-0 mt-1 font-heading text-xl font-semibold tracking-[-.02em]">{resultsTitle}</h2>
            {result && result.items.length > 0 && (directCount !== null || result.doableCount !== null) && (
              <p className="m-0 mt-0.5 text-xs text-fitx-text-secondary">
                {directCount !== null && `${directCount.toLocaleString()} main-muscle`}
                {directCount !== null && result.doableCount !== null && " · "}
                {result.doableCount !== null && `${result.doableCount.toLocaleString()} you can do`}
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-fitx-text-secondary">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select aria-label="Sort" className="fitx-field min-h-11 w-auto py-0 text-sm text-fitx-text" value={state.sort} onChange={(event) => update({ sort: event.target.value as LibrarySort })}>
              {(Object.keys(SORT_LABELS) as LibrarySort[]).map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
            </select>
          </label>
        </div>
        <p className="sr-only" role="status">{result ? `${result.items.length} ${result.items.length === 1 ? "exercise" : "exercises"} found` : ""}</p>

        {catalogue.status === "error" ? (
          <div role="alert" className="fitx-alert fitx-alert-danger">
            The library could not be loaded.
            <button type="button" className="fitx-alert-action" onClick={retry}>Try again</button>
          </div>
        ) : !result ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4" role="status" aria-label="Loading exercises">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface">
                <div className={`${styles.cover} animate-pulse bg-fitx-surface-variant motion-reduce:animate-none`} />
                <div className="space-y-2 p-3.5"><div className="h-4 w-3/4 animate-pulse rounded bg-fitx-surface-variant motion-reduce:animate-none" /><div className="h-3 w-1/2 animate-pulse rounded bg-fitx-surface-variant motion-reduce:animate-none" /></div>
              </div>
            ))}
          </div>
        ) : result.items.length === 0 ? (
          view.saved && !userId ? (
            <NoResults title="Saved exercises unavailable" options={[]} onRelax={() => undefined}
              description={account.status === "error" ? "Your account could not be checked." : "Sign in to save exercises."}
              clearLabel="Show all exercises" onClear={() => update({ saved: false })} />
          ) : view.saved && !saved.ids.length ? (
            <NoResults title="No saved exercises yet" options={[]} onRelax={() => undefined}
              description={`Tap the bookmark on any exercise${saved.store === "account" ? "" : ". Saved on this device"}.`}
              clearLabel="Show all exercises" onClear={() => update({ saved: false })} />
          ) : (
            <NoResults
              title="No exercises match"
              description={view.q.trim() ? `Nothing matches “${view.q.trim()}”${chips.length ? " with these filters" : ""}.` : "No exercise matches all of these filters."}
              spelling={spelling}
              onSpelling={(text) => update({ q: text })}
              options={relax.map((item) => ({ id: item.facet, label: relaxLabel(item.facet, view), count: item.count }))}
              onRelax={(facet) => {
                const next = relaxState(facet as QueryFacet, state);
                // Leaving home keeps the equipment the count was made with, rather than switching to the Gym list.
                navigate(facet === "environment" && haveKeys ? { ...next, have: [...haveKeys] } : next);
              }}
              clearLabel="Clear search and filters"
              onClear={() => navigate({ ...withoutFilters(state), q: "" })}
            />
          )
        ) : (
          <>
            <div className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 sm:gap-4 motion-reduce:transition-none xl:grid-cols-4 ${updating ? "opacity-60" : ""}`}>
              {visible.map((item, index) => (
                <Fragment key={item.exercise.id}>
                  {result.assistFrom === index && (
                    <p className="col-span-full m-0 border-t border-fitx-divider pt-3 text-[11px] font-semibold uppercase tracking-[.14em] text-fitx-text-secondary">Assisting muscle</p>
                  )}
                  {renderCard(item, index)}
                </Fragment>
              ))}
            </div>
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="m-0 text-xs text-fitx-text-secondary">{visible.length.toLocaleString()} of {result.items.length.toLocaleString()}</p>
              {visible.length < result.items.length && (
                <button type="button" className="fitx-button fitx-button-secondary min-h-11" onClick={() => setLimit({ key: viewKey, count: shownCount + PAGE_SIZE })}>Show more exercises</button>
              )}
            </div>
          </>
        )}
      </section>

      <p className="text-center text-[11px] leading-5 text-fitx-text-secondary">
        Photos and steps adapted from <a className="text-fitx-primary-text underline underline-offset-2" href={FREE_EXERCISE_DB_SOURCE_URL} target="_blank" rel="noreferrer">Free Exercise DB</a>. Stills, not demonstrations.
      </p>
      </div>
    </div>
  );
}
