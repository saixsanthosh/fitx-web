"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Loader2, MessageSquarePlus, Settings2, X } from "lucide-react";
import type { CoachState, CoachStatus } from "@/lib/ai/status";
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

type Pending = { task: ComposerMode; status: string | null; text: string };
type Problem = { message: string; retryAt?: string };

const UNAVAILABLE = new Set<CoachState>(["paused", "not_configured", "not_available"]);

export function CoachApp({ initialStatus }: { initialStatus: CoachStatus }) {
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
  const stopper = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const plansAllowed = shareData && !status.minor;
  const busy = pending !== null;

  const scrollToEnd = useCallback(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
    if (nearBottom) end.current?.scrollIntoView({ block: "end" });
  }, []);
  useEffect(scrollToEnd, [messages, pending, scrollToEnd]);

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
        ? `${failure.message}${when ? ` You can ask again from ${when}.` : ""}`
        : failure.code === "at_capacity"
          ? `${failure.message} Nothing was used from today's limit.${when ? ` Try again after ${when}.` : " Try again in a few minutes."}`
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
            setAnnouncement(result.kind === "workout_plan" ? "Saved as a workout draft in Workouts." : "Added to My Food Plan in Nutrition. Nothing was logged as eaten.");
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

  if (UNAVAILABLE.has(status.state)) return <CoachUnavailable state={status.state as "paused" | "not_configured" | "not_available"} />;
  if (status.state === "consent") {
    return (
      <ConsentPanel
        providers={status.providers}
        sharedSummary={status.sharedSummary}
        minor={status.minor}
        onDone={(share) => {
          setShareData(share);
          setStatus((old) => ({ ...old, state: "ready", consent: { shareData: share, consentedAt: new Date().toISOString() } }));
          void fetchStatus().then((fresh) => {
            setQuotas(fresh.quotas);
            setThreads(fresh.threads);
          }).catch(() => {});
        }}
      />
    );
  }

  const chatQuota = quotas.find((quota) => quota.kind === "chat");
  const planQuota = quotas.find((quota) => quota.kind === "plan");
  const activeQuota = mode === "chat" ? chatQuota : planQuota;
  const quotaHint = activeQuota
    ? `${Math.max(0, activeQuota.limit - activeQuota.used)} of ${activeQuota.limit} ${mode === "chat" ? "messages" : "plans"} left today${formatResetTime(activeQuota.resetsAt) ? ` · resets ${formatResetTime(activeQuota.resetsAt)}` : ""} · not medical advice`
    : null;
  const suggestions = status.minor
    ? ["What should I eat before sports practice?", "How can I get stronger safely?", "How much sleep do I need?"]
    : shareData
      ? ["How did my eating look this week?", "Am I getting enough protein for my goal?", "What should I focus on in training this week?"]
      : ["How much protein do I need a day?", "How do I eat well on a tight budget?", "What's a good beginner training split?"];

  const list = (
    <ConversationList threads={threads} activeId={threadId} onOpen={(id) => void openThread(id)} onNew={newConversation} onDelete={(thread) => void removeThread(thread)} busy={busy} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-fitx-text-secondary">
            {shareData && !status.minor ? "Using your FITX data" : status.minor ? "General questions only" : "Questions only"}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text lg:hidden">
              <History size={17} aria-hidden="true" /> History
            </button>
            <button type="button" onClick={newConversation} disabled={busy} aria-label="New conversation" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text lg:hidden">
              <MessageSquarePlus size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
              <Settings2 size={17} aria-hidden="true" /> <span className="hidden sm:inline">Coach settings</span><span className="sr-only sm:hidden">Coach settings</span>
            </button>
          </div>
        </div>

        <section aria-label="Conversation" aria-busy={busy || loadingThread} className="min-h-[46vh] space-y-6 pb-6">
          {loadingThread ? (
            <p className="flex items-center gap-2 py-10 text-sm text-fitx-text-secondary"><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Opening conversation…</p>
          ) : messages.length === 0 && !pending ? (
            <div className="py-6 sm:py-10">
              <h2 className="text-xl font-semibold tracking-[-.02em] text-fitx-text">What can I help with?</h2>
              <p className="mt-1.5 max-w-lg text-sm leading-6 text-fitx-text-secondary">
                {plansAllowed
                  ? "Ask a question, or use Plan my meals and Plan a workout for plans checked against FITX's food data and exercise library."
                  : "Ask a question about training, food or recovery."}
              </p>
              <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button type="button" onClick={() => { setMode("chat"); setDraft(suggestion); }} className="min-h-11 w-full rounded-xl border border-fitx-border bg-fitx-card px-3.5 py-3 text-left text-sm leading-5 text-fitx-text transition-colors hover:border-fitx-primary hover:bg-fitx-hover">
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            messages.map((message) => <MessageView key={message.id} message={message} actions={planActions} />)
          )}

          {pending && (
            <div className="space-y-2" aria-live="polite">
              {pending.status && (
                <p className="flex items-center gap-2 text-sm text-fitx-text-secondary">
                  <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                  {pending.status}…
                </p>
              )}
              {pending.text ? (
                <RichText text={pending.text} />
              ) : !pending.status ? (
                <p className="flex items-center gap-2 text-sm text-fitx-text-secondary"><Loader2 size={16} aria-hidden="true" className="animate-spin" /> The coach is thinking…</p>
              ) : null}
            </div>
          )}

          {problem && (
            <div role="alert" className="fitx-alert fitx-alert-danger flex items-start justify-between gap-3">
              <span>{problem.message}</span>
              <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-fitx-hover"><X size={16} aria-hidden="true" /></button>
            </div>
          )}
          <div ref={end} />
        </section>

        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-20 bg-gradient-to-t from-fitx-bg from-70% to-transparent pb-1 pt-4 lg:bottom-4">
          <Composer
            draft={draft}
            onDraft={setDraft}
            mode={mode}
            onMode={setMode}
            budget={budget}
            onBudget={setBudget}
            plansAllowed={plansAllowed}
            plansNote={status.minor ? "Plans aren't available for under-18 accounts." : !shareData ? "Plans need “Use my FITX data”, in Coach settings." : null}
            busy={busy}
            onSend={() => void send()}
            onStop={() => stopper.current?.abort()}
            hint={quotaHint}
          />
        </div>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-[92px] space-y-4">
          <div className="fitx-panel max-h-[calc(100dvh-220px)] overflow-y-auto p-3">{list}</div>
          {(chatQuota || planQuota) && (
            <div className="fitx-panel p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Today</h2>
              {chatQuota && <QuotaLine label="Messages" quota={chatQuota} />}
              {planQuota && <QuotaLine label="Plans" quota={planQuota} />}
              <p className="mt-3 text-xs leading-5 text-fitx-text-secondary">The coach runs on free AI services, so each account has a daily limit.</p>
            </div>
          )}
        </div>
      </aside>

      {historyOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Coach conversations">
          <button type="button" aria-label="Close conversations" onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-fitx-scrim/55" />
          <div className="absolute inset-y-0 left-0 flex w-[min(86vw,340px)] flex-col bg-fitx-elevated p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-fitx-text">Conversations</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close conversations" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover"><X size={18} aria-hidden="true" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
          </div>
        </div>
      )}

      <CoachSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        shareData={shareData}
        minor={status.minor}
        providers={status.providers}
        onShareChange={(share) => {
          setShareData(share);
          if (!share) setMode("chat");
          setAnnouncement(share ? "The coach can now use your FITX data." : "The coach no longer reads your FITX data.");
        }}
        onDeleted={() => {
          setSettingsOpen(false);
          newConversation();
          setThreads([]);
          setShareData(false);
          void fetchStatus().then(setStatus).catch(() => setStatus((old) => ({ ...old, state: "consent", consent: null })));
        }}
      />
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
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
