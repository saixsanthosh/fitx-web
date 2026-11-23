"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { COACH_CLOSE_EVENT, COACH_OPEN_EVENT, openPrompt } from "./coach-events";

// The panel and the whole coach load only when someone first opens it.
const CoachPanel = lazy(() => import("./CoachPanel").then((module) => ({ default: module.CoachPanel })));

/** The AI Coach page is the coach itself: there the open event falls through to its navigation. */
export function hostHandles(pathname: string | null): boolean {
  return !(pathname === "/ai-coach" || pathname?.startsWith("/ai-coach/"));
}

/**
 * Mounted once in the dashboard layout (BRIEF 3.2). Listens for "fitx:coach-open", takes it (preventDefault) and opens
 * the AI Coach panel with the prompt it carries. On close the panel's own close event tells the launcher to take focus.
 */
export function CoachPanelHost() {
  const pathname = usePathname();
  const [state, setState] = useState<{ open: boolean; prompt?: string; key: number; loaded: boolean }>({ open: false, key: 0, loaded: false });
  const handles = useRef(hostHandles(pathname));

  useEffect(() => {
    const onOpen = (event: Event) => {
      if (!handles.current) return;
      event.preventDefault();
      const prompt = openPrompt((event as CustomEvent).detail);
      setState((old) => ({ open: true, prompt, key: prompt !== undefined ? old.key + 1 : old.key, loaded: true }));
    };
    window.addEventListener(COACH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COACH_OPEN_EVENT, onOpen);
  }, []);

  // Moving to the AI Coach page closes the panel: the page is the same coach.
  useEffect(() => {
    handles.current = hostHandles(pathname);
    if (!handles.current) setState((old) => (old.open ? { ...old, open: false } : old));
  }, [pathname]);

  if (!state.loaded) return null;
  return (
    <Suspense fallback={null}>
      <CoachPanel
        open={state.open}
        initialPrompt={state.prompt}
        promptKey={state.key}
        onClose={() => {
          setState((old) => ({ ...old, open: false }));
          window.dispatchEvent(new CustomEvent(COACH_CLOSE_EVENT));
        }}
      />
    </Suspense>
  );
}
