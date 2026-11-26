"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { CoachThreadSummary } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { relativeDay } from "./format";

/** The member's past conversations. */
export function ConversationList({
  threads,
  activeId,
  onOpen,
  onNew,
  onDelete,
  busy,
  problem = null,
}: {
  threads: CoachThreadSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** `list`: this list's own element, so focus can move to the row that takes the deleted one's place. */
  onDelete: (thread: CoachThreadSummary, list: HTMLElement | null) => void;
  busy: boolean;
  /**
   * A delete that failed: the row stays and the message shows under it, beside the Delete button the member pressed,
   * so it is seen and heard inside the history drawer too (BRIEF-3 D6).
   */
  problem?: { id: string; message: string } | null;
}) {
  // Days and times are in the viewer's own time zone, so they appear once the page is running in the browser.
  const hydrated = useHydrated();
  return (
    <nav aria-label="Coach conversations" className="flex min-h-0 flex-col">
      <button type="button" data-coach-new="" onClick={onNew} disabled={busy} className="fitx-button fitx-button-secondary w-full justify-start">
        <MessageSquarePlus size={17} aria-hidden="true" /> New conversation
      </button>
      {threads.length === 0 ? (
        <p className="mt-4 px-1 text-sm leading-6 text-fitx-text-secondary">Your conversations will appear here.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {threads.map((thread) => (
            <li key={thread.id}>
              <div className="group flex items-center gap-1">
                <button
                  type="button"
                  data-coach-thread={thread.id}
                  onClick={() => onOpen(thread.id)}
                  disabled={busy}
                  aria-current={thread.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-3 py-1.5 text-left transition-colors",
                    thread.id === activeId ? "bg-fitx-primary/10" : "hover:bg-fitx-hover",
                  )}
                >
                  <span className={cn("truncate text-sm", thread.id === activeId ? "font-semibold text-fitx-primary-text" : "text-fitx-text")}>{thread.title}</span>
                  <span className="min-h-4 text-[11px] text-fitx-text-secondary">{hydrated ? relativeDay(thread.updatedAt) : ""}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => onDelete(thread, event.currentTarget.closest("nav"))}
                  disabled={busy}
                  aria-label={`Delete conversation: ${thread.title}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-fitx-text-disabled opacity-100 transition hover:bg-fitx-hover hover:text-fitx-danger focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              {problem?.id === thread.id && <p role="alert" className="fitx-alert fitx-alert-danger mt-1">{problem.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
