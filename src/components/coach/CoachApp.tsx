"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Dumbbell, Footprints, History, Loader2, MessageCircle, MessageSquarePlus, Settings2, Target, UserRound, Utensils, X } from "lucide-react";
import { useHydrated } from "@/components/ui/use-hydrated";
import { capabilityStarters, generalPrompts } from "@/lib/ai/capabilities";
import type { QuickPrompt } from "@/lib/ai/quick-prompts";
import type { CoachState, CoachStatus } from "@/lib/ai/status";
import { cn } from "@/lib/utils";
import type { CoachActionView, CoachMessageView, CoachQuota, CoachStreamEvent, CoachSwap, CoachThreadSummary } from "@/lib/ai/types";
import type { ActionState } from "./ActionButton";
import { CoachRequestError, applyAction, deleteThread, fetchStatus, fetchThread, requestSwap, sendTurn } from "./coach-client";
import { CoachSettings } from "./CoachSettings";
import { CoachUnavailable } from "./CoachUnavailable";
import { Composer, type ComposerMode } from "./Composer";
import { modeFor } from "./composer-rules";
import { ReadAloudToggle, VoiceButton, useReadAloud } from "./CoachVoice";
import { ConsentPanel } from "./ConsentPanel";
import { ConsentRenewal } from "./ConsentRenewal";
import { ConversationList } from "./ConversationList";
import {
  NO_ANNOUNCEMENT, UNAVAILABLE_STATES as UNAVAILABLE, focusAfterDelete, liveRegionText, nextAnnouncement, readablePlace, settingsReachable, settleAnnouncement,
  statusAfterDelete, type Announcement,
} from "./focus-rules";
import { formatResetTime } from "./format";
import type { PlanActions } from "./MealPlanCard";
import { MessageView } from "./MessageView";
import { RichText } from "./RichText";
import styles from "./Coach.module.css";

type Pending = { task: ComposerMode; status: string | null; text: string };
type Problem = { message: string; retryAt?: string };
/** A conversation whose delete failed: its row stays, with the message under it. */
type RowProblem = { id: string; message: string };

/**
 * variant "page": the AI Coach page (conversation rail on wide screens, the window scrolls).
 * variant "panel": inside the floating AI Coach panel (CoachPanel): one column that scrolls on its own.
 * prompt: text another page asked to put in the message box (never sent without the member pressing Send);
 * a new key puts it in again.
 */
export function CoachApp({ initialStatus, variant = "page", prompt: openWith }: { initialStatus: CoachStatus; variant?: "page" | "panel"; prompt?: { text: string; key: number } }) {
  const inPanel = variant === "panel";
  const [status, setStatus] = useState(initialStatus);
  const [shareData, setShareData] = useState(initialStatus.consent?.shareData ?? false);
  const [threads, setThreads] = useState<CoachThreadSummary[]>(initialStatus.threads);
  const [quotas, setQuotas] = useState<CoachQuota[]>(initialStatus.quotas);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessageView[]>([]);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [swaps, setSwaps] = useState<Record<string, CoachSwap[]>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("chat");
  const [budget, setBudget] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rowProblem, setRowProblem] = useState<RowProblem | null>(null);
  // The page's one polite live region is kept in place across the coach, consent and paused views (see the return).
  // While Coach settings or the history drawer is open the page behind is inert, so an announcement made then is read
  // in that dialog's own region (settleAnnouncement, below).
  const [announcement, setAnnouncement] = useState<Announcement>(NO_ANNOUNCEMENT);
  const announce = useCallback((text: string) => setAnnouncement((old) => nextAnnouncement(old, text)), []);
  // A failed delete's message stays only while the list it was shown in is the one in use.
  const showHistory = useCallback((open: boolean) => {
    setHistoryOpen(open);
    setRowProblem(null);
  }, []);
  const closeHistory = useCallback(() => showHistory(false), [showHistory]);
  // A screen that replaces the coach (the consent screen, or the paused one) takes focus on its heading, and so does the
  // paused screen when its Coach settings button goes: each request is a new key (ConsentPanel, CoachUnavailable).
  const [headingFocus, setHeadingFocus] = useState(0);
  const focusHeading = useCallback(() => setHeadingFocus((key) => key + 1), []);
  const [focusKey, setFocusKey] = useState(0);
  const stopper = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const threadBox = useRef<HTMLElement>(null);
  // Reset times are in the viewer's time zone, which the server can't know: they appear after hydration.
  const hydrated = useHydrated();
  const readAloud = useReadAloud();
  const speakReply = readAloud.speak;

  // Only accounts whose profile says 18 or over share their data (the server checks this too).
  const mayShare = !status.minor && !status.ageMissing;
  const plansAllowed = shareData && mayShare;
  const busy = pending !== null;

  const scrollToEnd = useCallback(() => {
    const box = inPanel ? threadBox.current : null;
    const nearBottom = box
      ? box.scrollTop + box.clientHeight >= box.scrollHeight - 320
      : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
    if (nearBottom) end.current?.scrollIntoView({ block: "end" });
  }, [inPanel]);
  useEffect(scrollToEnd, [messages, pending, scrollToEnd]);

  // The composer's height, so what scrolls into view at the end of the conversation (a reply, an error) is never
  // left behind it (Coach.module.css .end). It changes with the mode (the meal plan's budget field) and the text.
  const measureDock = useCallback((dock: HTMLDivElement | null) => {
    const chat = dock?.parentElement;
    if (!dock || !chat || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => chat.style.setProperty("--coach-dock-height", `${Math.ceil(dock.getBoundingClientRect().height)}px`));
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  // A prompt from another page fills the box once per key; the member still presses Send.
  const promptKey = openWith?.key;
  const promptText = openWith?.text;
  const [appliedPrompt, setAppliedPrompt] = useState<number | undefined>(undefined);
  if (promptKey !== undefined && promptText && promptKey !== appliedPrompt) {
    setAppliedPrompt(promptKey);
    setMode("chat");
    setDraft(promptText);
    setFocusKey((key) => key + 1);
  }

  const recordActions = useCallback((actions: CoachActionView[]) => {
    setActionStates((old) => ({ ...old, ...Object.fromEntries(actions.map((action) => [action.id, action.status])) }));
    const swapActions = actions.filter((action) => action.swap);
    if (swapActions.length) {
      setSwaps((old) => {
        const next = { ...old };
        for (const action of swapActions) {
          const list = next[action.swap!.replaces] ?? [];
          if (!list.some((swap) => swap.item.key === action.swap!.item.key)) next[action.swap!.replaces] = [...list, action.swap!];
        }
        return next;
      });
    }
  }, []);

  /**
   * The 30 days after FITX's eating-disorder note (status.careMode): no meal plans or swaps and no food prompts. The
   * server says whether they started (a swap note can start them too); the suggestions written from the member's
   * data leave out food from then on (quick-prompts.ts).
   */
  const refreshCareMode = useCallback(() => {
    void fetchStatus()
      .then((fresh) => {
        setStatus((old) => ({ ...old, quickPrompts: fresh.quickPrompts, careMode: fresh.careMode }));
        if (fresh.careMode) setMode((old) => (old === "meal_plan" ? "chat" : old));
      })
      .catch(() => {});
  }, []);

  function startCarePeriod() {
    setStatus((old) => ({ ...old, careMode: true }));
    setMode((old) => (old === "meal_plan" ? "chat" : old));
    refreshCareMode();
  }

  function updateQuota(quota: CoachQuota | null) {
    if (quota) setQuotas((old) => [...old.filter((item) => item.kind !== quota.kind), quota]);
  }

  /** `failedDelete`: the conversation whose delete failed; its message goes under its row instead of in the conversation. */
  function handleFailure(error: unknown, text: string, failedDelete?: string) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setDraft(text);
      return;
    }
    const failure = error instanceof CoachRequestError ? error : new CoachRequestError("failed", "Something went wrong. Please try again.");
    if (failure.code === "consent_required") {
      focusHeading();
      setStatus((old) => ({ ...old, state: "consent" }));
      // The history drawer goes with the coach (a failed delete inside it): it must not open again when the coach is back.
      showHistory(false);
      // The reason may be a profile change (now under 18), so the consent screen takes its details afresh.
      void fetchStatus().then(setStatus).catch(() => {});
      return;
    }
    if (failure.code === "paused" || failure.code === "not_configured" || failure.code === "not_available") {
      // The paused screen replaces the coach and the control in use: focus goes to its heading.
      focusHeading();
      setStatus((old) => ({ ...old, state: failure.code as CoachState }));
      showHistory(false);
      return;
    }
    // A failed send puts its words back in the message box; a failed open or delete leaves what was typed there.
    if (text) setDraft(text);
    const when = formatResetTime(failure.retryAt);
    const message =
      failure.code === "quota"
        ? `${failure.message}${when ? ` The next one is back at ${when}.` : ""}`
        : failure.code === "at_capacity"
          ? `${failure.message} Nothing was used from your limit.${when ? ` Try again after ${when}.` : " Please try again."}`
          : failure.message;
    // The row stays, so its message goes under it, in the list the member used: in the history drawer, which is modal,
    // the conversation's alert behind it would be neither seen nor heard (BRIEF-3 D6).
    if (failedDelete) setRowProblem({ id: failedDelete, message: `Couldn't delete this conversation. ${message}` });
    else setProblem({ message, retryAt: failure.retryAt });
  }

  async function send(spoken?: string) {
    const text = spoken?.trim() || draft.trim() || (mode === "meal_plan" ? "Plan my meals for today." : mode === "workout_plan" ? "Plan a workout for today." : "");
    if (!text || busy) return;
    const localId = `local-${Date.now()}`;
    const sentMode = mode;
    setProblem(null);
    setDraft("");
    setMessages((old) => [...old, { id: localId, role: "user", task: sentMode, content: text, data: null, provider: null, createdAt: new Date().toISOString() }]);
    setPending({ task: sentMode, status: sentMode === "chat" ? null : "Starting", text: "" });
    const controller = new AbortController();
    stopper.current = controller;
    const previousThread = threadId;
    let userMessageId = localId;
    let sawThread = false;
    let failed = false;
    const removeUserMessage = () => setMessages((old) => old.filter((message) => message.id !== localId && message.id !== userMessageId));

    const onEvent = (event: CoachStreamEvent) => {
      if (event.type === "thread") {
        sawThread = true;
        userMessageId = event.userMessageId;
        setThreadId(event.threadId);
        setMessages((old) => old.map((message) => (message.id === localId ? { ...message, id: event.userMessageId } : message)));
        setThreads((old) => [{ id: event.threadId, title: event.title, updatedAt: new Date().toISOString() }, ...old.filter((thread) => thread.id !== event.threadId)]);
      } else if (event.type === "task") setPending((old) => (old ? { ...old, task: event.task } : old));
      else if (event.type === "status") setPending((old) => (old ? { ...old, status: event.text } : old));
      else if (event.type === "delta") setPending((old) => (old ? { ...old, status: null, text: old.text + event.text } : old));
      else if (event.type === "reset") setPending((old) => (old ? { ...old, text: "" } : old));
      else if (event.type === "message") {
        setMessages((old) => [...old, event.message]);
        recordActions(event.actions);
        // FITX's eating-disorder note starts the 30 days without meal plans: the page stops offering them at once.
        if (event.message.role === "safety" && event.message.data?.safety === "eating_disorder") startCarePeriod();
        // Read aloud (when the member turned it on): chat replies and safety notes; plans are cards to read.
        if (event.message.role !== "user" && event.message.task === "chat") speakReply(event.message.content);
        // A plan is long: show its start, not its end, once it is on the page.
        if (event.message.data?.plan) requestAnimationFrame(() => document.getElementById(`coach-message-${event.message.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
      } else if (event.type === "done") updateQuota(event.quota);
      else if (event.type === "error") {
        failed = true;
        removeUserMessage();
        handleFailure(new CoachRequestError(event.code, event.message, event.retryAt), text);
      }
    };

    try {
      await sendTurn({ message: text, threadId, mode: sentMode, ...(sentMode === "meal_plan" && budget.trim() ? { budget: budget.trim() } : {}) }, onEvent, controller.signal);
      if (!failed && sentMode !== "chat") setMode("chat");
    } catch (error) {
      failed = true;
      removeUserMessage();
      handleFailure(error, text);
    } finally {
      setPending(null);
      stopper.current = null;
      // The server takes back a turn nobody answered (and a conversation it had just started); mirror that.
      if (failed && sawThread) await refreshAfterFailure(previousThread);
    }
  }

  async function refreshAfterFailure(previousThread: string | null) {
    setThreadId(previousThread);
    try {
      const fresh = await fetchStatus();
      setThreads(fresh.threads);
      setQuotas(fresh.quotas);
    } catch {
      // The page still works; the list refreshes on the next action.
    }
  }

  async function openThread(id: string, { quiet = false }: { quiet?: boolean } = {}) {
    if (!quiet) setLoadingThread(true);
    setProblem(null);
    showHistory(false);
    try {
      const view = await fetchThread(id);
      setThreadId(view.thread.id);
      setMessages(view.messages);
      setActionStates({});
      setSwaps({});
      recordActions(view.actions);
    } catch (error) {
      handleFailure(error, "");
    } finally {
      setLoadingThread(false);
    }
  }

  function newConversation() {
    setThreadId(null);
    setMessages([]);
    setActionStates({});
    setSwaps({});
    setProblem(null);
    showHistory(false);
  }

  /**
   * `list`: the conversation list the Delete button was pressed in (the rail, or the history drawer). The deleted row
   * goes, so focus moves to the conversation that takes its place, or to "New conversation" (focusAfterDelete).
   */
  async function removeThread(thread: CoachThreadSummary, list: HTMLElement | null) {
    if (!window.confirm(`Delete “${thread.title}”? This can't be undone. Foods and workouts you added stay.`)) return;
    setRowProblem(null);
    try {
      await deleteThread(thread.id);
      const target = focusAfterDelete(threads.map((item) => item.id), thread.id);
      // Committed at once: the row is gone, its replacement is there to focus, and a drawer this closes is closed.
      flushSync(() => {
        setThreads((old) => old.filter((item) => item.id !== thread.id));
        if (thread.id === threadId) newConversation();
      });
      const next = target.kind === "thread" ? list?.querySelector<HTMLElement>(`[data-coach-thread="${target.id}"]`) : list?.querySelector<HTMLElement>("[data-coach-new]");
      next?.focus();
      announce(`Deleted “${thread.title}”.`);
    } catch (error) {
      handleFailure(error, "", thread.id);
    }
  }

  const planActions: PlanActions = useMemo(
    () => ({
      stateOf: (id) => (id ? actionStates[id] ?? "proposed" : "proposed"),
      apply: (id) => {
        setActionStates((old) => ({ ...old, [id]: "applying" }));
        applyAction(id)
          .then((result) => {
            setActionStates((old) => ({ ...old, [id]: "applied" }));
            announce(result.kind === "workout_plan" ? "Saved as a workout draft in Workouts." : "Saved to My foods in Nutrition. Nothing was logged as eaten.");
          })
          .catch((error) => {
            setActionStates((old) => ({ ...old, [id]: "error" }));
            announce(error instanceof CoachRequestError ? error.message : "Couldn't add it. Please try again.");
          });
      },
      swapsFor: (id) => (id ? swaps[id] ?? [] : []),
      requestSwap: async (id, note) => {
        try {
          const result = await requestSwap(id, note);
          recordActions([result.action]);
          updateQuota(result.quota);
          announce(`Swap found: ${result.swap.item.name}, shown below the food it replaces.`);
          return null;
        } catch (error) {
          if (error instanceof CoachRequestError) {
            // A swap note can bring FITX's eating-disorder note (coach.ts requestSwap), which starts the 30 days.
            if (error.code === "refused") refreshCareMode();
            const when = formatResetTime(error.retryAt);
            return error.code === "at_capacity" ? `${error.message}${when ? ` Try again after ${when}.` : ""}` : error.message;
          }
          return "Couldn't find a swap. Please try again.";
        }
      },
      canSwap: plansAllowed && !status.careMode,
    }),
    [actionStates, swaps, plansAllowed, status.careMode, recordActions, refreshCareMode, announce],
  );

  const settings = (
    <CoachSettings
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      shareData={shareData}
      minor={status.minor}
      ageMissing={status.ageMissing}
      providers={status.providers}
      status={liveRegionText(announcement, "settings")}
      onShareChange={(share) => {
        setShareData(share);
        // Replies written from the member's data are not sent again once sharing is off (the server leaves
        // them out), so the next message starts a new conversation rather than seeming to continue this one.
        if (!share) { setMode("chat"); newConversation(); }
        // Prompts written from the member's data appear once sharing is on (and go once it is off).
        void fetchStatus().then((fresh) => setStatus((old) => ({ ...old, quickPrompts: fresh.quickPrompts }))).catch(() => {});
        announce(share
          ? "The coach can now use your FITX data."
          : "Questions only: the coach no longer gets your logs or profile, only your questions and what its safety rules need, such as the lowest daily calories it may suggest. Your next message starts a new conversation.");
      }}
      onDeleted={() => {
        // Closed at once (its effect runs inside flushSync), so the page behind is no longer inert when the result is
        // announced on it below.
        flushSync(() => setSettingsOpen(false));
        newConversation();
        setThreads([]);
        setShareData(false);
        // On the paused screen, Coach settings goes now (statusAfterDelete); otherwise the consent screen replaces the
        // coach once the fresh status arrives. Either way focus goes to that screen's heading, and the live region (kept
        // in place) says why.
        setStatus(statusAfterDelete);
        focusHeading();
        announce("Your coach data was deleted.");
        void fetchStatus()
          .then((fresh) => {
            setStatus(fresh);
            setThreads(fresh.threads);
            setQuotas(fresh.quotas);
          })
          .catch(() => setStatus((old) => ({ ...old, state: UNAVAILABLE.has(old.state) ? old.state : "consent", consent: null, threads: [] })));
      }}
    />
  );

  // Paused or not set up: a member who used the coach can still change sharing or delete their coach data.
  const hasCoachData = settingsReachable(status, threads.length);
  const coachShown = !UNAVAILABLE.has(status.state) && status.state !== "consent";
  // A new announcement is read where it can be: in the dialog this view has open (the page behind a modal dialog is
  // inert), else on the page; one left in a dialog that has closed is dropped (settleAnnouncement).
  const settled = settleAnnouncement(announcement, readablePlace({
    settings: settingsOpen && (coachShown || (UNAVAILABLE.has(status.state) && hasCoachData)),
    history: historyOpen && coachShown,
  }));
  if (settled !== announcement) setAnnouncement(settled);

  // One polite live region, at the same place in every view, so an announcement made as the view changes (the
  // consent screen replacing the coach) is still read, and the same words twice are read twice (announcementText).
  const live = <p className="sr-only" aria-live="polite">{liveRegionText(announcement, "page")}</p>;

  if (UNAVAILABLE.has(status.state)) {
    return (
      <>
        <>
          <CoachUnavailable
            state={status.state as "paused" | "not_configured" | "not_available"}
            onSettings={hasCoachData ? () => setSettingsOpen(true) : undefined}
            focusKey={headingFocus}
          />
          {hasCoachData && settings}
        </>
        {live}
      </>
    );
  }
  if (status.state === "consent") {
    return (
      <>
        <ConsentPanel
          providers={status.providers}
          sharedSummary={status.sharedSummary}
          minor={status.minor}
          ageMissing={status.ageMissing}
          memberDataAvailable={status.memberDataAvailable}
          focusKey={headingFocus}
          onDone={(share) => {
            setShareData(share);
            // The coach replaces the consent screen: focus goes to the message box (Composer's focusKey).
            setFocusKey((key) => key + 1);
            setStatus((old) => ({ ...old, state: "ready", consent: { shareData: share, consentedAt: new Date().toISOString() } }));
            void fetchStatus().then((fresh) => {
              setQuotas(fresh.quotas);
              setThreads(fresh.threads);
              setStatus((old) => ({ ...old, quickPrompts: fresh.quickPrompts, careMode: fresh.careMode }));
            }).catch(() => {});
          }}
        />
        {live}
      </>
    );
  }

  const chatQuota = quotas.find((quota) => quota.kind === "chat");
  const planQuota = quotas.find((quota) => quota.kind === "plan");
  const activeQuota = mode === "chat" ? chatQuota : planQuota;
  const quotaHint = activeQuota ? quotaText(activeQuota, mode === "chat" ? "messages" : "plans", hydrated ? formatResetTime(activeQuota.resetsAt) : null) : null;
  // Prompts written from the member's own data when they share it; general ones otherwise.
  const prompts: StarterPrompt[] = plansAllowed && status.quickPrompts.length
    ? status.quickPrompts
    : generalPrompts({ minor: status.minor, careMode: status.careMode }).map(({ source, context, text }, index) => ({ id: `general-${index}`, source, context, text, mode: "chat" as const }));

  function choosePrompt(prompt: StarterPrompt) {
    setMode(modeFor(prompt.mode, { plansAllowed, mealPlansPaused: status.careMode }));
    setDraft(prompt.text);
    setFocusKey((key) => key + 1);
  }

  const list = (
    <ConversationList threads={threads} activeId={threadId} onOpen={(id) => void openThread(id)} onNew={newConversation} onDelete={(thread, list) => void removeThread(thread, list)} busy={busy} problem={rowProblem} />
  );

  return (
    <>
      <div className={cn(styles.layout, inPanel && styles.panelLayout)}>
        {!inPanel && <aside className={styles.rail} aria-label="Conversations and limits">
          <div className={styles.railInner}>
            <div className={styles.railList}>{list}</div>
            {(chatQuota || planQuota) && (
              <div className={styles.limits}>
                <h2 className={styles.limitsTitle}>Last 24 hours</h2>
                {chatQuota && <QuotaLine label="Messages" quota={chatQuota} />}
                {planQuota && <QuotaLine label="Plans" quota={planQuota} />}
              </div>
            )}
          </div>
        </aside>}

        <div className={styles.chat}>
          <div className={styles.bar}>
            <p className={styles.mode}>
              <span aria-hidden="true" className={cn(styles.dot, plansAllowed && styles.dotOn)} />
              {plansAllowed ? "Using your FITX data" : status.minor ? "General questions only" : "Questions only"}
            </p>
            <div className={styles.tools}>
              <ReadAloudToggle readAloud={readAloud} />
              <button type="button" onClick={() => showHistory(true)} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text", !inPanel && "lg:hidden")}>
                <History size={17} aria-hidden="true" /><span className="sr-only sm:not-sr-only">History</span>
              </button>
              <button type="button" onClick={newConversation} disabled={busy} aria-label="New conversation" className={cn("grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text", !inPanel && "lg:hidden")}>
                <MessageSquarePlus size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Coach settings" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
                <Settings2 size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {status.renewal && (
            <ConsentRenewal
              renewal={status.renewal}
              // The prompt goes: focus moves to the message box rather than to the page body.
              onClosed={() => setFocusKey((key) => key + 1)}
              onAgreed={() => {
                setStatus((old) => ({ ...old, renewal: null }));
                announce("Agreed to the updated terms.");
                // The services' notices and the prompts written from the member's data follow the new consent.
                void fetchStatus().then((fresh) => setStatus((old) => ({ ...old, providers: fresh.providers, memberDataAvailable: fresh.memberDataAvailable, quickPrompts: fresh.quickPrompts, renewal: fresh.renewal }))).catch(() => {});
              }}
            />
          )}

          <section ref={threadBox} aria-label="Conversation" aria-busy={busy || loadingThread} className={styles.thread}>
            {loadingThread ? (
              <p className={styles.thinking}><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Opening conversation…</p>
            ) : messages.length === 0 && !pending ? (
              <div className={styles.hello}>
                <div>
                  <h2 className={styles.helloTitle}>What can I help with?</h2>
                  {status.providers.length > 0 && (
                    <p className={styles.services}>
                      <span className={styles.service}><span aria-hidden="true" className={cn(styles.dot, styles.dotOn)} />{status.providers.length === 1 ? "1 AI service ready" : `${status.providers.length} AI services ready`}</span>
                      <span aria-hidden="true">·</span>
                      <span>{status.providers.map((provider) => provider.name).join(", ")}</span>
                    </p>
                  )}
                </div>
                <ul className={styles.skills} aria-label="What the coach can do">
                  {capabilityStarters({ sharesData: plansAllowed, careMode: status.careMode }).map((starter) => (
                    <li key={starter.id}>
                      <button type="button" onClick={() => choosePrompt({ id: `skill-${starter.id}`, source: "general", context: starter.label, text: starter.text, mode: starter.mode })} className={styles.skill}>
                        {starter.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <ul className={styles.prompts} aria-label="Suggested questions">
                  {prompts.map((prompt) => {
                    const Icon = PROMPT_ICONS[prompt.source];
                    return (
                      <li key={prompt.id}>
                        <button type="button" onClick={() => choosePrompt(prompt)} className={styles.prompt}>
                          <span className={styles.promptContext}><Icon size={14} aria-hidden="true" /><span>{prompt.context}</span></span>
                          <span className={styles.promptText}>{prompt.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} id={`coach-message-${message.id}`} className="scroll-mt-24">
                  <MessageView message={message} actions={planActions} />
                </div>
              ))
            )}

            {pending && (
              <div className="grid gap-2.5" aria-live="polite">
                <p className={styles.replyMeta}><span aria-hidden="true" className={styles.mark}>FX</span>FITX Coach</p>
                {pending.text ? (
                  <div><RichText text={pending.text} /><span aria-hidden="true" className={styles.caret} /></div>
                ) : (
                  <p className={styles.thinking}>
                    <span aria-hidden="true" className={styles.dots}><span /><span /><span /></span>
                    {pending.status ? `${pending.status}…` : "Thinking…"}
                  </p>
                )}
              </div>
            )}

            {problem && (
              <div role="alert" className="fitx-alert fitx-alert-danger flex items-start justify-between gap-3">
                <span>{problem.message}</span>
                {/* The alert goes with its Dismiss button: focus moves to the message box, which holds the words again. */}
                <button type="button" onClick={() => { setProblem(null); setFocusKey((key) => key + 1); }} aria-label="Dismiss" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-fitx-hover"><X size={16} aria-hidden="true" /></button>
              </div>
            )}
            {/* Clears the sticky composer when scrolled to. */}
            <div ref={end} className={styles.end} />
          </section>

          <div ref={measureDock} className={styles.composerDock}>
            <Composer
              draft={draft}
              onDraft={setDraft}
              mode={mode}
              onMode={setMode}
              budget={budget}
              onBudget={setBudget}
              plansAllowed={plansAllowed}
              mealPlansPaused={status.careMode}
              plansNote={status.minor ? "Plans aren't available for under-18 accounts." : status.ageMissing ? "Plans need your age in Profile and “Use my FITX data”." : !shareData ? "Plans need “Use my FITX data”, in Coach settings." : null}
              busy={busy}
              onSend={() => void send()}
              onStop={() => stopper.current?.abort()}
              hint={quotaHint}
              focusKey={focusKey}
              voice={
                <VoiceButton
                    disabled={busy}
                    onStart={() => { readAloud.cancel(); setMode("chat"); }}
                    onTranscript={setDraft}
                    onFinished={(text) => void send(text)}
                  />
              }
            />
          </div>
        </div>

        <HistoryDrawer open={historyOpen} onClose={closeHistory} closeWhenWide={!inPanel} status={liveRegionText(announcement, "history")}>{list}</HistoryDrawer>

        {settings}
      </div>
      {live}
    </>
  );
}

type StarterPrompt = Omit<QuickPrompt, "source"> & { source: QuickPrompt["source"] | "general" };
const PROMPT_ICONS: Record<StarterPrompt["source"], typeof Utensils> = {
  food: Utensils, training: Dumbbell, activity: Footprints, goal: Target, setup: UserRound, general: MessageCircle,
};

/** The composer's limit line. The limit counts the last 24 hours, so a used-up limit frees one request at a time. */
function quotaText(quota: CoachQuota, noun: "messages" | "plans", nextAt: string | null) {
  const left = Math.max(0, quota.limit - quota.used);
  if (left > 0) return `${left} of ${quota.limit} ${noun} left in the last 24 hours`;
  return nextAt ? `No ${noun} left · the next one is back at ${nextAt}` : `No ${noun} left for now`;
}

/**
 * Conversations on phones and tablets: a native modal dialog, so focus moves into it, Tab stays inside,
 * Escape closes it and focus returns to the History button. `status`: what the page announces while it is open
 * (the page behind it is inert), read from the drawer's own live region.
 */
function HistoryDrawer({ open, onClose, closeWhenWide, status, children }: { open: boolean; onClose: () => void; closeWhenWide: boolean; status: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // The drawer is for narrow screens; widening the window to the desktop layout closes it.
  useEffect(() => {
    if (!open || !closeWhenWide) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const closeIfWide = () => {
      if (wide.matches) onClose();
    };
    wide.addEventListener("change", closeIfWide);
    return () => wide.removeEventListener("change", closeIfWide);
  }, [open, onClose, closeWhenWide]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={onClose}
      // A press on the backdrop lands on the dialog itself, outside the panel.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="coach-history-title"
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(86vw,340px)] max-w-none border-0 bg-fitx-elevated p-0 text-fitx-text shadow-2xl backdrop:bg-fitx-scrim/55"
    >
      <div className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="coach-history-title" className="text-base font-semibold text-fitx-text">Conversations</h2>
          <button type="button" onClick={onClose} aria-label="Close conversations" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <p className="sr-only" aria-live="polite">{status}</p>
      </div>
    </dialog>
  );
}

function QuotaLine({ label, quota }: { label: string; quota: CoachQuota }) {
  const left = Math.max(0, quota.limit - quota.used);
  const percent = quota.limit ? Math.round((quota.used / quota.limit) * 100) : 100;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm">
        <span className="text-fitx-text">{label}</span>
        <span className="text-fitx-text-secondary">{left} of {quota.limit} left</span>
      </div>
      <div className="fitx-progress-track mt-1.5 h-1.5" aria-hidden="true"><div className="fitx-progress-fill" style={{ width: `${Math.min(100, percent)}%` }} /></div>
    </div>
  );
}
