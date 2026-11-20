"use client";

import { ErrorScreen } from "../_error/ErrorScreen";

/** A sign-in or onboarding page failed to render. */
export default function AuthError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} retry={unstable_retry} home={{ href: "/signin", label: "Back to sign in" }} landmark="div" />;
}
