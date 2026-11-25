"use client";

import { useCallback, useRef, useState } from "react";
import { nextNotice, type Notice, type NoticeTone } from "@/lib/social/notice";

/**
 * One message for an open dialog or sheet (D6): `show` replaces it, `clear` removes it (on close, or a new try).
 * `latest` is the same message, kept current at once, for a dialog that hands it to the page as it closes.
 */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const latest = useRef<Notice | null>(null);
  const show = useCallback((tone: NoticeTone, text: string) => {
    const next = nextNotice(latest.current, tone, text, Date.now());
    latest.current = next;
    setNotice(next);
  }, []);
  const clear = useCallback(() => {
    latest.current = null;
    setNotice(null);
  }, []);
  return { notice, show, clear, latest };
}
