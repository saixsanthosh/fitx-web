"use client";

import { ErrorScreen } from "../_error/ErrorScreen";

/** A public page failed to render; the site header and footer stay usable. */
export default function MarketingError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorScreen error={error} retry={unstable_retry} home={{ href: "/", label: "Go to FITX" }} />;
}
