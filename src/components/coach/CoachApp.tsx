"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dumbbell, Footprints, History, Loader2, MessageCircle, MessageSquarePlus, Settings2, Target, UserRound, Utensils, X } from "lucide-react";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { QuickPrompt } from "@/lib/ai/quick-prompts";
import type { CoachState, CoachStatus } from "@/lib/ai/status";
import { cn } from "@/lib/utils";
import type { CoachActionView, CoachMessageView, CoachQuota, CoachStreamEvent, CoachSwap, CoachThreadSummary } from "@/lib/ai/types";
import type { ActionState } from "./ActionButton";
import { CoachRequestError, applyAction, deleteThread, fetchStatus, fetchThread, requestSwap, sendTurn } from "./coach-client";
import { CoachSettings } from "./CoachSettings";
import { CoachUnavailable } from "./CoachUnavailable";
import { Composer, type ComposerMode } from "./Composer";
import { ConsentPanel } from "./ConsentPanel";
import { ConversationList } from "./ConversationList";
import { formatResetTime } from "./format";
import type { PlanActions } from "./MealPlanCard";
import { MessageView } from "./MessageView";
import { RichText } from "./RichText";
import styles from "./Coach.module.css";

type Pending = { task: ComposerMode; status: string | null; text: string };
type Problem = { message: string; retryAt?: string };

const UNAVAILABLE = new Set<CoachState>(["paused", "not_configured", "not_available"]);

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
  const [announcement, setAnnouncement] = useState("");
  const [focusKey, setFocusKey] = useState(0);
  const stopper = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const threadBox = useRef<HTMLElement>(null);
  // Reset times are in the viewer's time zone, which the server can't know: they appear after hydration.
  const hydrated = useHydrated();

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

  // A prompt from another page (or the voice button) fills the box; the member still presses Send.
  const promptKey = openWith?.key;
  const promptText = openWith?.text;
  useEffect(() => {
    if (promptKey === undefined || !promptText) return;
    setMode("chat");
    setDraft(promptText);
    setFocusKey((key) => key + 1);
  }, [promptKey, promptText]);

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

  function updateQuota(quota: CoachQuota | null) {
    if (quota) setQuotas((old) => [...old.filter((item) => item.kind !== quota.kind), quota]);
  }

  function handleFailure(error: unknown, text: string) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setDraft(text);
      return;
    }
    const failure = error instanceof CoachRequestError ? error : new CoachRequestError("failed", "Something went wrong. Please try again.");
    if (failure.code === "consent_required") {
      setStatus((old) => ({ ...old, state: "consent" }));
      // The reason may be a profile change (now under 18), so the consent screen takes its details afresh.
      void fetchStatus().then(setStatus).catch(() => {});
      return;
    }
    if (failure.code === "paused" || failure.code === "not_configured" || failure.code === "not_available") {
      setStatus((old) => ({ ...old, state: failure.code as CoachState }));
      return;
    }
    setDraft(text);
    const when = formatResetTime(failure.retryAt);
    const message =
      failure.code === "quota"
        ? `${failure.message}${when ? ` The next one is back at ${when}.` : ""}`
        : failure.code === "at_capacity"
          ? `${failure.message} Nothing was used from your limit.${when ? ` Try again after ${when}.` : " Try again in a few minutes."}`
          : failure.message;
    setProblem({ message, retryAt: failure.retryAt });
  }

  async function send() {
    const text = draft.trim() || (mode === "meal_plan" ? "Plan my meals for today." : mode === "workout_plan" ? "Plan a workout for today." : "");
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
    setHistoryOpen(false);
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
    setHistoryOpen(false);
  }

  async function removeThread(thread: CoachThreadSummary) {
    if (!window.confirm(`Delete “${thread.title}”? This can't be undone. Foods and workouts you added stay.`)) return;
    try {
      await deleteThread(thread.id);
      setThreads((old) => old.filter((item) => item.id !== thread.id));
      if (thread.id === threadId) newConversation();
      setAnnouncement("Conversation deleted.");
    } catch (error) {
      handleFailure(error, "");
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
            setAnnouncement(result.kind === "workout_plan" ? "Saved as a workout draft in Workouts." : "Saved to My foods in Nutrition. Nothing was logged as eaten.");
          })
          .catch((error) => {
            setActionStates((old) => ({ ...old, [id]: "error" }));
            setAnnouncement(error instanceof CoachRequestError ? error.message : "Couldn't add it. Please try again.");
          });
      },
      swapsFor: (id) => (id ? swaps[id] ?? [] : []),
      requestSwap: async (id, note) => {
        try {
          const result = await requestSwap(id, note);
          recordActions([result.action]);
          updateQuota(result.quota);
          return null;
        } catch (error) {
          if (error instanceof CoachRequestError) {
            const when = formatResetTime(error.retryAt);
            return error.code === "at_capacity" ? `${error.message}${when ? ` Try again after ${when}.` : ""}` : error.message;
          }
          return "Couldn't find a swap. Please try again.";
        }
      },
      canSwap: plansAllowed,
    }),
    [actionStates, swaps, plansAllowed, recordActions],
  );

  const settings = (
    <CoachSettings
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      shareData={shareData}
      minor={status.minor}
      ageMissing={status.ageMissing}
      providers={status.providers}
      onShareChange={(share) => {
        setShareData(share);
        // Replies written from the member's data are not sent again once sharing is off (the server leaves
        // them out), so the next message starts a new conversation rather than seeming to continue this one.
        if (!share) { setMode("chat"); newConversation(); }
        // Prompts written from the member's data appear once sharing is on (and go once it is off).
        void fetchStatus().then((fresh) => setStatus((old) => ({ ...old, quickPrompts: fresh.quickPrompts }))).catch(() => {});
        setAnnouncement(share
          ? "The coach can now use your FITX data."
          : "Questions only: the coach no longer gets your logs or profile, only your questions and what its safety rules need, such as the lowest daily calories it may suggest. Your next message starts a new conversation.");
      }}
      onDeleted={() => {
        setSettingsOpen(false);
        newConversation();
        setThreads([]);
        setShareData(false);
        setAnnouncement("Your coach data was deleted.");
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

  if (UNAVAILABLE.has(status.state)) {
    // Paused or not set up: a member who used the coach can still change sharing or delete their coach data.
    const hasCoachData = status.state !== "not_available" && (status.consent !== null || threads.length > 0);
    return (
      <>
        <CoachUnavailable state={status.state as "paused" | "not_configured" | "not_available"} onSettings={hasCoachData ? () => setSettingsOpen(true) : undefined} />
        {hasCoachData && settings}
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </>
    );
  }
  if (status.state === "consent") {
    return (
      <ConsentPanel
        providers={status.providers}
        sharedSummary={status.sharedSummary}
        minor={status.minor}
        ageMissing={status.ageMissing}
        memberDataAvailable={status.memberDataAvailable}
        onDone={(share) => {
          setShareData(share);
          setStatus((old) => ({ ...old, state: "ready", consent: { shareData: share, consentedAt: new Date().toISOString() } }));
          void fetchStatus().then((fresh) => {
            setQuotas(fresh.quotas);
            setThreads(fresh.threads);
            setStatus((old) => ({ ...old, quickPrompts: fresh.quickPrompts }));
          }).catch(() => {});
        }}
      />
    );
  }

  const chatQuota = quotas.find((quota) => quota.kind === "chat");
  const planQuota = quotas.find((quota) => quota.kind === "plan");
  const activeQuota = mode === "chat" ? chatQuota : planQuota;
  const quotaHint = activeQuota ? quotaText(activeQuota, mode === "chat" ? "messages" : "plans", hydrated ? formatResetTime(activeQuota.resetsAt) : null) : null;
  // Prompts written from the member's own data when they share it; general ones otherwise.
  const prompts: StarterPrompt[] = plansAllowed && status.quickPrompts.length
    ? status.quickPrompts
    : (status.minor ? MINOR_PROMPTS : GENERAL_PROMPTS).map(([source, context, text], index) => ({ id: `general-${index}`, source, context, text, mode: "chat" as const }));

  function choosePrompt(prompt: StarterPrompt) {
    setMode(prompt.mode !== "chat" && plansAllowed ? prompt.mode : "chat");
    setDraft(prompt.text);
    setFocusKey((key) => key + 1);
  }

  const list = (
    <ConversationList threads={threads} activeId={threadId} onOpen={(id) => void openThread(id)} onNew={newConversation} onDelete={(thread) => void removeThread(thread)} busy={busy} />
  );

  return (
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
            <button type="button" onClick={() => setHistoryOpen(true)} className={cn("inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text", !inPanel && "lg:hidden")}>
              <History size={17} aria-hidden="true" /> History
            </button>
            <button type="button" onClick={newConversation} disabled={busy} aria-label="New conversation" className={cn("grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text", !inPanel && "lg:hidden")}>
              <MessageSquarePlus size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Coach settings" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
              <Settings2 size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

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
              <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-fitx-hover"><X size={16} aria-hidden="true" /></button>
            </div>
          )}
          {/* Clears the sticky composer when scrolled to. */}
          <div ref={end} className="scroll-mb-48" />
        </section>

        <div className={styles.composerDock}>
          <Composer
            draft={draft}
            onDraft={setDraft}
            mode={mode}
            onMode={setMode}
            budget={budget}
            onBudget={setBudget}
            plansAllowed={plansAllowed}
            plansNote={status.minor ? "Plans aren't available for under-18 accounts." : status.ageMissing ? "Plans need your age in Profile and “Use my FITX data”." : !shareData ? "Plans need “Use my FITX data”, in Coach settings." : null}
            busy={busy}
            onSend={() => void send()}
            onStop={() => stopper.current?.abort()}
            hint={quotaHint}
            focusKey={focusKey}
          />
        </div>
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} closeWhenWide={!inPanel}>{list}</HistoryDrawer>

      {settings}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}

type StarterPrompt = Omit<QuickPrompt, "source"> & { source: QuickPrompt["source"] | "general" };

type GeneralPrompt = [StarterPrompt["source"], string, string];
const GENERAL_PROMPTS: GeneralPrompt[] = [
  ["food", "Protein", "How much protein do I need a day?"],
  ["food", "Budget", "How do I eat well on a tight budget?"],
  ["training", "Training", "What's a good beginner training split?"],
  ["training", "Warm-up", "How do I warm up before lifting?"],
];
const MINOR_PROMPTS: GeneralPrompt[] = [
  ["food", "Food", "What should I eat before sports practice?"],
  ["training", "Strength", "How can I get stronger safely?"],
  ["general", "Recovery", "How much sleep do I need?"],
];
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
 * Escape closes it and focus returns to the History button.
 */
function HistoryDrawer({ open, onClose, closeWhenWide, children }: { open: boolean; onClose: () => void; closeWhenWide: boolean; children: ReactNode }) {
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
