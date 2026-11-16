"use client";

import { Toaster as Sonner } from "sonner";

/** Toasts use the page's theme tokens, so they stay readable in light, dark and system themes. */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--fitx-elevated)",
          border: "1px solid var(--fitx-border)",
          color: "var(--fitx-text)",
        },
      }}
    />
  );
}
