"use client";

import { RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";

/** Shown when the account check itself failed (offline, or FITX unreachable). */
export function AccountError() {
  return (
    <EmptyState
      title="FITX couldn’t be reached"
      description="Your account couldn’t be checked. Check your connection and try again. Anything recorded on this device is kept."
      action={<button type="button" onClick={() => window.location.reload()} className="fitx-button fitx-button-secondary min-h-11"><RefreshCw size={15} aria-hidden="true" />Try again</button>}
    />
  );
}
