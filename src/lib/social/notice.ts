/**
 * Messages shown inside an open dialog (the story viewer, a sheet) instead of a toast (D6, bug 18). A toast raised
 * while a modal <dialog> is open is drawn under the browser's top layer and is inert, so nobody sees or hears it; the
 * message goes next to what the member just used instead, in a live region inside the dialog.
 */
export type NoticeTone = "error" | "success" | "info";
export type Notice = { id: number; tone: NoticeTone; text: string; at: number };

/** The next message: a new id every time, so the same words said twice are announced twice. */
export function nextNotice(previous: Notice | null, tone: NoticeTone, text: string, at: number): Notice {
  return { id: (previous?.id ?? 0) + 1, tone, text, at };
}

/** How long a message stays in the story viewer: errors a little longer, as they may need acting on. */
export function noticeMs(notice: Pick<Notice, "tone">): number {
  return notice.tone === "error" ? 7000 : 4000;
}

/**
 * A message the dialog closed on before it could be read (shown under `readMs` ago): the page says it again, as a
 * toast, once the dialog is gone. Null when it was on screen long enough, or there is none.
 */
export function carryOver(notice: Notice | null, now: number, readMs = 2500): Notice | null {
  return notice && now - notice.at < readMs ? notice : null;
}
