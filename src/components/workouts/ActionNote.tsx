import { cn } from "@/lib/utils";

/**
 * What an action did, or why it did not work, beside the control that was used (D6): a quiet status line, or an
 * alert for a problem. With `live`, the status line stays in the page while empty, so a screen reader hears each new
 * message in it (a region added with its text already in it may not be read out).
 */
export function ActionNote({ note, live = false, className }: { note: { tone: "info" | "error"; text: string } | null; live?: boolean; className?: string }) {
  const info = note?.tone === "info" ? note.text : "";
  return (
    <>
      {(live || info) && <p role="status" className={info ? cn("m-0 rounded-lg bg-fitx-surface-variant px-3 py-2 text-xs text-fitx-text-secondary", className) : "sr-only"}>{info}</p>}
      {note?.tone === "error" && <p role="alert" className={cn("fitx-alert fitx-alert-danger m-0 px-3 py-2 text-sm", className)}>{note.text}</p>}
    </>
  );
}
