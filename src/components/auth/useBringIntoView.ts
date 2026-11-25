import { useLayoutEffect, type RefObject } from "react";
import { bringIntoView } from "@/lib/auth/into-view";

/**
 * Brings `target`, a request's failure under the button that sent it, into view whenever it says something new
 * (`message`), without moving focus (src/lib/auth/into-view.ts). Before paint, so the message never shows behind the
 * privacy banner first.
 */
export function useBringIntoView(target: RefObject<HTMLElement | null>, message: string): void {
  useLayoutEffect(() => {
    bringIntoView(target.current, message);
  }, [target, message]);
}
