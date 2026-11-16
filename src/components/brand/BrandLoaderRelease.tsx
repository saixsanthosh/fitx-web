"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Set by the head script while the brand loader shows; hides it after its minimum time. */
    __fitxReleaseLoader?: () => void;
  }
}

/** Ends the brand loader once the app has hydrated. */
export function BrandLoaderRelease() {
  useEffect(() => {
    window.__fitxReleaseLoader?.();
  }, []);
  return null;
}
