"use client";

import Link from "next/link";
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bookmark, PersonStanding, SlidersHorizontal, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActiveFilters } from "@/components/exercises/discovery/ActiveFilters";
import { DiscoverySection } from "@/components/exercises/discovery/DiscoverySection";
import { EquipmentGrid } from "@/components/exercises/discovery/EquipmentGrid";
import { ExerciseResultCard, mainMuscleLabel } from "@/components/exercises/discovery/ExerciseResultCard";
import { FilterPanel } from "@/components/exercises/discovery/FilterPanel";
import { NoResults } from "@/components/exercises/discovery/NoResults";
import { SearchField } from "@/components/exercises/discovery/SearchField";
import { MuscleRail } from "@/components/training/MuscleRail";
import { ModePanel, ModeTabs } from "@/components/workouts/ModeTabs";
import { clearRecentSearches, forgetSearch, readRecentExercises, readRecentSearches, rememberSearch } from "@/lib/domain/exercise-preferences";
import { localDateKey } from "@/lib/domain/dates";
import { notifyUserContextChanged } from "@/lib/domain/user-context";
import { createClient, SUPABASE_URL } from "@/lib/supabase/client";
import type { CatalogExercise } from "@/lib/training/catalog";
import { focusAreaCounts, loadCatalogThumbnails, queryCatalog, relaxSuggestions, resultCountLine, type QueryFacet, type RankedExercise } from "@/lib/training/catalog-search";
import { equipmentFor, saveEquipmentProfile } from "@/lib/training/data";
import { expandOwnedEquipment, sortEquipmentKeys } from "@/lib/training/equipment";
import { survivingExerciseIds } from "@/lib/training/exercise-merges";
import { replanAfterListSaved, replanMessage } from "@/lib/training/programme-replan";
import { FOCUS_AREAS, FOCUS_COUNT_NOTE } from "@/lib/training/focus";
import { FREE_EXERCISE_DB_SOURCE_URL } from "@/lib/training/media";
import { LEVELS, type Level } from "@/lib/training/taxonomy";
import { modeDirection, readStoredMode, writeStoredMode, type WorkoutMode } from "@/lib/training/workout-mode";
import { focusHeading, focusLost } from "@/lib/workouts/focus-heading";
import { useRetryFocus, type ReloadPhase } from "@/lib/workouts/retry-focus";
import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";
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
import { LIBRARY_MARKS, findMarked, libraryFocusAfter, waitsForResults, type LibraryFocus, type LibraryPress } from "./_lib/library-focus";
import { bookmarkTakesFocusBack, type CardPlace, type SaveProblem } from "./_lib/saved-toggle";
import { replaceSearch, useCatalogue, useLibraryAccount, useSavedExercises, useUrlSearch } from "./_lib/use-library";

const PAGE_SIZE = 24;
const RECENT_SHOWN = 6;
const SECTIONS_KEY = "fitx:exercise:v1:library-sections";
const CONTEXT_TITLES: Record<TrainingContext, string> = { home: "Home", gym: "Gym" };
const LEVEL_LABELS: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const SORT_LABELS: Record<LibrarySort, string> = { best: "Best match", name: "Name, A to Z", difficulty: "Easiest first" };
/** The page's h1 and the results heading, where focus goes after a Try again, and those Try again buttons (D5). */
const LIBRARY_TITLE = "exercise-library-title";
const RESULTS_TITLE = "exercise-results";
const ACCOUNT_FOCUS = { heading: LIBRARY_TITLE, retry: "library-account-retry" };
const CATALOGUE_FOCUS = { heading: RESULTS_TITLE, retry: "library-catalogue-retry" };

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

/** The bookmark of the card for exercise `id` in a grid of cards, found by its exact mark (ids are not selectors). */
function bookmarkIn(grid: ParentNode | null, id: string): HTMLElement | null {
  return findMarked(grid?.querySelectorAll<HTMLElement>(`[${LIBRARY_MARKS.card}]`) ?? [], LIBRARY_MARKS.card, id)?.querySelector<HTMLElement>("button[aria-pressed]") ?? null;
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
  // Once saved, "Save as my … list" goes (the search's list is the saved one), and "Use my saved list" goes with its
  // press: Edit list, beside them, takes focus, else "Only show what I can do" (D5).
  const editListLink = useRef<HTMLAnchorElement>(null);
  const doableSwitch = useRef<HTMLButtonElement>(null);
  const [listSaved, setListSaved] = useState(0);
  useEffect(() => { if (listSaved && focusLost(document)) (editListLink.current ?? doableSwitch.current)?.focus(); }, [listSaved]);
  // Chips, Clear all, recent searches, the search box's ×, the no-results suggestions and "Filter by …" go with their
  // press (D5): where focus goes then is _lib/library-focus.ts's decision, carried out below once the page has
  // changed. "Show more exercises" goes once every result is shown: the first card it brought takes focus.
  const [libraryFocus, setLibraryFocus] = useState<{ target: LibraryFocus; seq: number } | null>(null);
  const handledLibraryFocus = useRef(0);
  const focusAfter = (press: LibraryPress): LibraryFocus => {
    const target = libraryFocusAfter(press);
    setLibraryFocus((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));
    return target;
  };
  const filtersButton = useRef<HTMLButtonElement>(null);
  const resultsGrid = useRef<HTMLDivElement>(null);
  const recentGrid = useRef<HTMLDivElement>(null);
  // A save or unsave that fails says why in the card whose bookmark was pressed (D6: saved-toggle.ts); in the Saved
  // view that card comes back, and its bookmark takes focus again from where the press sent it (D5).
  const [saveProblem, setSaveProblem] = useState<SaveProblem | null>(null);
  const saveProblemSeq = useRef(0);
  const handledSaveProblem = useRef(0);
  const [moreFocus, setMoreFocus] = useState<{ shown: string[]; seq: number } | null>(null);
  const handledMoreFocus = useRef(0);

  // Links from earlier versions (?equipment=, ?location=, a single ?muscle=full_body) are rewritten once.
  useEffect(() => {
    const current = window.location.search.slice(1);
    const canonical = canonicalLibrarySearch(current);
    if (canonical !== new URLSearchParams(current).toString()) replaceSearch(canonical);
  }, []);
  useEffect(() => { void Promise.resolve().then(() => setSections(readSections())); }, []);
  // Home or Gym carries over from Workouts on this device when the address does not say (phase 12).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("context") || params.has("location") || readStoredMode() !== "home") return;
    params.set("context", "home");
    replaceSearch(params.toString());
  }, []);
  const [modeMove, setModeMove] = useState<1 | -1 | 0>(0);
  useEffect(() => {
    if (!userId) return;
    void Promise.resolve().then(() => {
      setRecentSearches(readRecentSearches(userId));
      setRecentIds(survivingExerciseIds(readRecentExercises(userId)));
    });
  }, [userId]);

  const navigate = useCallback((next: LibraryState) => replaceSearch(writeLibraryState(next)), []);
  const update = (patch: Partial<LibraryState>) => navigate({ ...state, ...patch });
  const switchContext = (next: WorkoutMode) => {
    if (next === state.context) return;
    setModeMove(modeDirection(state.context, next));
    setListNote(null);
    writeStoredMode(next);
    update({ context: next, have: null });
  };
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
  const filterKey = writeLibraryState({ ...view, q: "" });
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
    const { context } = state;
    const keys = state.have;
    setSavingList(true);
    const { error } = await saveEquipmentProfile(supabase, account.userId, context, keys);
    setSavingList(false);
    if (error) { setListNote({ tone: "error", text: `Your ${contextName} list could not be saved. Check your connection and try again.` }); return; }
    // Profile shows the lists (and counts a saved one as setup done) from the shared context: it reloads now.
    notifyUserContextChanged();
    await reloadProfiles({ context, keys });
    navigate({ ...state, have: null });
    setListSaved((value) => value + 1);
    const saved = `Saved as your ${contextName} list. Workouts uses it too.`;
    setListNote({ tone: "info", text: saved });
    // The programme the member follows plans its days ahead from this list: they follow it now (bug 17), as when the
    // list is saved on Workouts, and what changed is said here. Workouts checks again when it opens if this fails.
    const checked = await replanAfterListSaved(supabase, { userId: account.userId, context, keys, catalog: exercises ?? [], level: account.level ?? "beginner", todayKey: localDateKey() });
    const replanned = !checked ? "" : checked.error
      ? "Your programme’s days ahead couldn’t be checked against it yet: Workouts checks them when you open it."
      : replanMessage(checked, context);
    if (replanned) setListNote((current) => (current?.text === saved ? { tone: "info", text: `${saved} ${replanned}` } : current));
  }

  const resultsTitle = !result ? (catalogue.status === "error" ? "Exercises unavailable" : "Loading exercises") : `${result.items.length.toLocaleString()} ${result.items.length === 1 ? "exercise" : "exercises"}`;
  // Main-muscle results, what the member can do of those, and the ones that only assist (the same "you can do" as Workouts).
  const countLine = result && result.items.length ? resultCountLine(result.items, { focused: view.focus.length > 0, doableOnly: view.doable, ownedKnown: owned !== null }) : null;
  const levelChoice = quickLevel(state);
  useEffect(() => {
    if (!libraryFocus || libraryFocus.seq === handledLibraryFocus.current) return;
    const { target } = libraryFocus;
    // The results heading says the new count: wait until the results for the new choice are shown.
    if (waitsForResults(target) && (updating || (!result && catalogue.status !== "error"))) return;
    handledLibraryFocus.current = libraryFocus.seq;
    if (target.to === "results") { focusHeading(document, RESULTS_TITLE, { keepScroll: true }); return; }
    if (!focusLost(document)) return;
    const marked = (root: ParentNode | null, attribute: string, value: string) => findMarked(root?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [], attribute, value);
    const control = target.to === "filters" ? filtersButton.current
      : target.to === "chip" ? marked(document, LIBRARY_MARKS.chip, target.id)
        : target.to === "recent" ? marked(document, LIBRARY_MARKS.recent, target.term)
          : marked(resultsGrid.current, LIBRARY_MARKS.card, target.id)?.querySelector<HTMLElement>("button[aria-pressed]");
    control?.focus();
  }, [libraryFocus, updating, result, catalogue.status]);
  useEffect(() => {
    if (!moreFocus || moreFocus.seq === handledMoreFocus.current || !result) return;
    handledMoreFocus.current = moreFocus.seq;
    const ids = visible.map((item) => item.exercise.id);
    const target = focusAfterShowMore({ more: ids.length < result.items.length, shown: moreFocus.shown, added: addedIds(moreFocus.shown, ids) });
    if (!target || target === "button" || !focusLost(document)) return;
    findMarked(resultsGrid.current?.querySelectorAll<HTMLElement>(`[${LIBRARY_MARKS.card}]`) ?? [], LIBRARY_MARKS.card, target)?.querySelector<HTMLElement>("h3 a")?.focus();
  }, [moreFocus, visible, result]);
  // Try again swaps its alert for loading, taking the button with it (D5). Once the member's details have loaded the
  // page's h1 takes focus; once the library has, the results heading (when the results are worked out). When it failed
  // again, the new Try again does. The page stays where it is for touch.
  const accountPhase: ReloadPhase = account.status === "loading" ? "loading" : account.status === "error" ? "failed" : "ready";
  const retryingAccount = useRetryFocus(accountPhase, ACCOUNT_FOCUS, { keepScroll: true });
  const cataloguePhase: ReloadPhase = catalogue.status === "error" ? "failed" : catalogue.status === "ready" && result ? "ready" : "loading";
  const retryingCatalogue = useRetryFocus(cataloguePhase, CATALOGUE_FOCUS, { keepScroll: true });

  // A failed save or unsave: its card (back in the list, in the Saved view) says why beside the bookmark, and the
  // bookmark takes focus back if focus is still where the press sent it, or was lost; never from where the member has
  // put it since (saved-toggle.ts).
  useEffect(() => {
    if (!saveProblem || saveProblem.seq === handledSaveProblem.current) return;
    handledSaveProblem.current = saveProblem.seq;
    const { id, place, movedTo } = saveProblem;
    const bookmark = bookmarkIn(place === "recent" ? recentGrid.current : resultsGrid.current, id);
    const sentTo = movedTo?.to === "results" ? document.getElementById(RESULTS_TITLE) : movedTo?.to === "card-save" ? bookmarkIn(resultsGrid.current, movedTo.id) : null;
    if (bookmark && bookmarkTakesFocusBack(document, sentTo)) bookmark.focus();
  }, [saveProblem]);

  const renderCard = (item: RankedExercise, index = 0, place: CardPlace = "results") => (
    <ExerciseResultCard
      key={item.exercise.id}
      item={item}
      thumbnail={thumbs.get(item.exercise.id)}
      highlight={item.match?.matched.length ? highlightRanges(item.exercise.name, item.match.matched) : undefined}
      saved={savedSet.has(item.exercise.id)}
      canSave={Boolean(userId) && saved.ready}
      saveProblem={saveProblem?.id === item.exercise.id && saveProblem.place === place ? saveProblem.message : null}
      onToggleSave={() => {
        const id = item.exercise.id;
        // In the Saved view a card the member unsaves leaves the list, bookmark and all: the next card's takes focus.
        const movedTo = view.saved && savedSet.has(id) ? focusAfter({ control: "unsave-card", cards: visible.map((entry) => entry.exercise.id), id }) : null;
        setSaveProblem(null);
        void toggle(id).then((outcome) => {
          if (outcome.status !== "failed") return;
          saveProblemSeq.current += 1;
          setSaveProblem({ id, place, message: outcome.message, movedTo, seq: saveProblemSeq.current });
        });
      }}
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
        titleId={LIBRARY_TITLE}
        meta={exercises ? `${exercises.length.toLocaleString()} exercises` : undefined}
        actions={<>
          <Link href={browseByMuscleHref(state)} className="fitx-button fitx-button-secondary min-h-11 px-3.5 text-sm"><PersonStanding size={16} aria-hidden="true" />Browse by muscle</Link>
          <Link href="/workouts" className="fitx-button min-h-11 px-3.5 text-sm">Build a workout<ArrowRight size={15} aria-hidden="true" /></Link>
        </>}
        className="mb-5 sm:mb-7"
      />

      <ModeTabs mode={state.context} onChange={switchContext} panelId="library-mode-panel" idPrefix="library" label="Exercise library mode" className="mb-5 sm:mb-7" />

      <ModePanel mode={state.context} direction={modeMove} id="library-mode-panel" labelledBy={`library-tab-${state.context}`}>
      <div className="space-y-6 sm:space-y-8">
      <section aria-label="Search and filters" className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <SearchField
            value={state.q}
            onChange={(value) => update({ q: value })}
            onClear={() => { update({ q: "" }); focusAfter({ control: "clear-search" }); }}
            onSubmit={rememberCurrentSearch}
            recent={recentSearches}
            onPickRecent={(term) => { update({ q: term }); if (userId) setRecentSearches(rememberSearch(userId, term)); focusAfter({ control: "pick-recent" }); }}
            onForgetRecent={(term) => { if (!userId) return; focusAfter({ control: "forget-recent", recent: recentSearches, term }); setRecentSearches(forgetSearch(userId, term)); }}
            onClearRecent={() => { if (!userId) return; setRecentSearches(clearRecentSearches(userId)); focusAfter({ control: "clear-recent" }); }}
          />
          <div className="flex gap-2">
            <button type="button" aria-pressed={state.saved} onClick={() => update({ saved: !state.saved })} disabled={!userId}
              className={`fitx-button min-h-12 flex-1 px-3.5 sm:flex-none ${state.saved ? "" : "fitx-button-secondary"}`}>
              <Bookmark size={15} aria-hidden="true" />Saved{saved.ready && <span className="tabular-nums">{saved.ids.length}</span>}
            </button>
            <button ref={filtersButton} type="button" aria-expanded={filtersOpen} aria-controls="exercise-filters" onClick={() => setFiltersOpen((open) => !open)}
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
            <button type="button" onClick={() => { navigate(wordFilter.next); focusAfter({ control: "word-filter" }); }} className="inline-flex min-h-11 items-center font-semibold text-fitx-primary-text underline underline-offset-4">Filter by {wordFilter.label}</button>
          </p>
        )}
        {filtersOpen && <div className="fitx-panel p-3.5 sm:p-5"><FilterPanel id="exercise-filters" state={state} onChange={navigate} /></div>}
        {catalogue.status === "ready" && !catalogue.curated && <p className="m-0 text-xs text-fitx-text-secondary">Some filters are approximate until the catalogue update is applied.</p>}
        {account.status === "error" && (
          <p role="alert" className="fitx-alert fitx-alert-danger m-0">
            <span id="library-account-problem">Your equipment and saved exercises could not be loaded.</span>
            <button id={ACCOUNT_FOCUS.retry} type="button" aria-describedby="library-account-problem" className="fitx-alert-action" onClick={() => { retryingAccount(); retryAccount(); }}>Try again</button>
          </p>
        )}
        {saved.problem && <p role="alert" className="fitx-alert fitx-alert-danger m-0">{saved.problem}</p>}
        {saved.moved > 0 && <p role="status" className="m-0 text-xs text-fitx-text-secondary">{saved.moved === 1 ? "1 saved exercise" : `${saved.moved} saved exercises`} moved from this device to your account.</p>}
        <ActiveFilters chips={chipItems} onRemove={(id) => {
          const chip = chips.find((item) => `${item.key}:${item.value}` === id);
          if (!chip) return;
          focusAfter({ control: "remove-chip", chips: chipItems.map((item) => item.id), id });
          navigate(withoutChip(state, chip));
        }} onClearAll={() => { navigate(withoutFilters(state)); focusAfter({ control: "clear-all" }); }} />
      </section>

      {!searching && (
        <section aria-labelledby="focus-title" className="grid gap-3">
          <h2 id="focus-title" className="m-0 font-heading text-lg font-semibold tracking-[-.02em]">Target muscles</h2>
          <MuscleRail value={state.focus} onChange={(focus) => update({ focus })} details={focusDetails} label="Focus areas" />
          {focusDetails && <p className="m-0 text-xs text-fitx-text-secondary">{FOCUS_COUNT_NOTE}</p>}
        </section>
      )}

      {!searching && (
        <DiscoverySection id="equipment" title="Equipment" open={sections.equipment} onToggle={() => toggleSection("equipment")}
          summary={account.status === "loading" ? "Loading your lists…" : account.status === "error" && !haveKeys ? "Your lists could not be loaded." : haveKeys ? `${state.have ? "This search" : list?.saved ? `Your ${contextName} list` : `Starting ${contextName} list`}: ${equipmentListText(haveKeys)}` : "Sign in to match your equipment."}
>
          <div className="grid gap-4">
            <EquipmentGrid value={account.status === "ready" ? haveKeys : null} onChange={setHave} context={state.context} disabled={account.status !== "ready"} />
            <div className="flex flex-col gap-3 border-t border-fitx-divider pt-3 sm:flex-row sm:items-center sm:justify-between">
              <button ref={doableSwitch} type="button" role="switch" aria-checked={state.doable} disabled={!owned} onClick={() => update({ doable: !state.doable })}
                className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-left text-sm font-medium text-fitx-text disabled:opacity-60">
                <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${state.doable ? "bg-fitx-primary" : "bg-fitx-track"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fitx-surface shadow-sm transition-transform motion-reduce:transition-none ${state.doable ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </span>
                Only show what I can do
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {state.have && account.status === "ready" && account.profiles.available && (
                  <button type="button" onClick={() => { if (!savingList) void saveHaveList(); }} aria-disabled={savingList || undefined} className="fitx-button fitx-button-secondary min-h-11 px-3.5 text-sm aria-disabled:opacity-60">
                    {savingList ? "Saving…" : `Save as my ${contextName} list`}
                  </button>
                )}
                {state.have && <button type="button" onClick={() => { update({ have: null }); setListSaved((value) => value + 1); }} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-fitx-primary-text underline underline-offset-4">{list?.saved ? "Use my saved list" : "Use the starting list"}</button>}
                {!state.have && account.status === "ready" && account.profiles.available && (
                  <Link ref={editListLink} href={`/workouts?equipment=${state.context}`} className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-fitx-primary-text underline underline-offset-4">Edit list</Link>
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
          <div ref={recentGrid} className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{recentMatches.map((item, index) => renderCard(item, index, "recent"))}</div>
        </section>
      )}

      <section aria-labelledby="exercise-results" aria-busy={updating || !result} className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-primary-text">{searching ? "Results" : CONTEXT_TITLES[state.context]}</p>
            <h2 id={RESULTS_TITLE} className="m-0 mt-1 font-heading text-xl font-semibold tracking-[-.02em]">{resultsTitle}</h2>
            {countLine && <p className="m-0 mt-0.5 text-xs text-fitx-text-secondary">{countLine}</p>}
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
            <span id="library-catalogue-problem">The library could not be loaded.</span>
            <button id={CATALOGUE_FOCUS.retry} type="button" aria-describedby="library-catalogue-problem" className="fitx-alert-action" onClick={() => { retryingCatalogue(); retry(); }}>Try again</button>
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
              clearLabel="Show all exercises" onClear={() => { update({ saved: false }); focusAfter({ control: "show-all" }); }} />
          ) : view.saved && !saved.ids.length ? (
            <NoResults title="No saved exercises yet" options={[]} onRelax={() => undefined}
              description={`Tap the bookmark on any exercise${saved.store === "account" ? "" : ". Saved on this device"}.`}
              clearLabel="Show all exercises" onClear={() => { update({ saved: false }); focusAfter({ control: "show-all" }); }} />
          ) : (
            <NoResults
              title="No exercises match"
              description={view.q.trim() ? `Nothing matches “${view.q.trim()}”${chips.length ? " with these filters" : ""}.` : "No exercise matches all of these filters."}
              spelling={spelling}
              onSpelling={(text) => { update({ q: text }); focusAfter({ control: "spelling" }); }}
              options={relax.map((item) => ({ id: item.facet, label: relaxLabel(item.facet, view), count: item.count }))}
              onRelax={(facet) => {
                const next = relaxState(facet as QueryFacet, state);
                // Leaving home keeps the equipment the count was made with, rather than switching to the Gym list.
                navigate(facet === "environment" && haveKeys ? { ...next, have: [...haveKeys] } : next);
                focusAfter({ control: "relax" });
              }}
              clearLabel="Clear search and filters"
              onClear={() => { navigate({ ...withoutFilters(state), q: "" }); focusAfter({ control: "clear-search-and-filters" }); }}
            />
          )
        ) : (
          <>
            {/* Keyed by the filters (not the search text), so the cards rise in again when a category or filter changes. */}
            <div key={filterKey} ref={resultsGrid} className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 sm:gap-4 motion-reduce:transition-none xl:grid-cols-4 ${updating ? "opacity-60" : ""}`}>
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
                <button type="button" className="fitx-button fitx-button-secondary min-h-11" onClick={() => {
                  setMoreFocus((current) => ({ shown: visible.map((item) => item.exercise.id), seq: (current?.seq ?? 0) + 1 }));
                  setLimit({ key: viewKey, count: shownCount + PAGE_SIZE });
                }}>Show more exercises</button>
              )}
            </div>
          </>
        )}
      </section>

      <p className="text-center text-[11px] leading-5 text-fitx-text-secondary">
        Photos and steps adapted from <a className="text-fitx-primary-text underline underline-offset-2" href={FREE_EXERCISE_DB_SOURCE_URL} target="_blank" rel="noreferrer">Free Exercise DB</a> (public domain). Cards marked AI demo show FITX’s AI demonstrations, made from those real photos of the same movement; the rest show the photos themselves. No exercise has a verified video yet.
      </p>
      </div>
      </ModePanel>
    </div>
  );
}
