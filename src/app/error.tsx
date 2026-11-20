"use client";

import { ErrorScreen } from "./_error/ErrorScreen";

/**
 * Errors the route groups' own boundaries cannot catch: a failing group layout (app shell, public shell, sign-in
 * shell). The root layout still renders around it; only a failing root layout reaches global-error.tsx.
 */
export default function RootError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} retry={unstable_retry} home={{ href: "/", label: "Go to FITX" }} />;
}
