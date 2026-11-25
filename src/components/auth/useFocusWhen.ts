import { useEffect, type RefObject } from "react";

/**
 * Moves focus to `target` (a heading with tabIndex={-1}) once `when` turns true. When a sign-in page swaps its form for
 * what happened next ("Check your email", "Password updated"), the button the member pressed is gone, and focus would
 * fall to the page (bug 80's same mistake): it goes to the new heading instead, so a screen reader says where they are.
 */
export function useFocusWhen(target: RefObject<HTMLElement | null>, when: boolean): void {
  useEffect(() => {
    if (when) target.current?.focus({ preventScroll: true });
  }, [target, when]);
}
