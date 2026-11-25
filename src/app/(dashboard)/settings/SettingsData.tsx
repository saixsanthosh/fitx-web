"use client";

import { useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Cookie, Download } from "lucide-react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { checkSession, signInHref } from "@/components/account/session-state";
import { countRecords, exportAccountData, exportFileName, ExportError } from "@/lib/account/export";
import { createClient } from "@/lib/supabase/client";
import { SettingsGroup, SettingsLink } from "./SettingsParts";

/**
 * Settings → "Your data": download everything FITX stores for the account (read in the browser under
 * row-level security) and delete the account (server route, after a recent sign-in). Mounted by the
 * Settings page; the section id "your-data" is where a re-sign-in for deletion returns to.
 */
export function SettingsData() {
  return (
    <SettingsGroup id="settings-your-data" sectionId="your-data" title="Your data">
      {/* The cookie page is a public page: prefetched here it preloads the public header and footer's styles, which
          this page never uses (bug 95). */}
      <SettingsLink href="/cookies" prefetch={false} icon={Cookie} label="Cookies and analytics" />
      <DownloadData />
      <DeleteAccount />
    </SettingsGroup>
  );
}

/** A section label inside a sentence: "Food log" becomes "food log", "AI coach messages" keeps its "AI". */
function inSentence(label: string) {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function DownloadData() {
  const [state, setState] = useState<{ kind: "idle" | "working" | "done" | "error" | "signed_out"; text: string }>({ kind: "idle", text: "" });

  async function download() {
    // aria-disabled, not disabled, while working: a disabled button drops keyboard focus to the page (D5).
    if (state.kind === "working") return;
    const supabase = createClient();
    if (!supabase) return setState({ kind: "error", text: "Downloading isn't available right now because FITX can't reach its database." });
    setState({ kind: "working", text: "Collecting your data…" });
    // An ended session and a check that failed (offline) are told apart, as in the Account section.
    const { state: session, user } = await checkSession<User>(() => supabase.auth.getUser());
    if (session === "signed_out") return setState({ kind: "signed_out", text: "Your session has ended. Sign in again to download your data." });
    if (!user) return setState({ kind: "error", text: "We couldn't check that you're signed in, so nothing was downloaded. Check your connection and try again." });
    try {
      const data = await exportAccountData(supabase, user, {
        onProgress: ({ done, total, label }) => setState({ kind: "working", text: `Collecting ${inSentence(label)} (${done + 1} of ${total})…` }),
      });
      const name = exportFileName();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const records = countRecords(data);
      setState({ kind: "done", text: `Downloaded ${name}: ${records.toLocaleString("en-IN")} ${records === 1 ? "record" : "records"}${data.files.length ? ` and a list of ${data.files.length} uploaded ${data.files.length === 1 ? "image" : "images"}` : ""}.` });
    } catch (error) {
      const section = error instanceof ExportError ? inSentence(error.section) : "your data";
      setState({ kind: "error", text: `We couldn't read ${section}, so nothing was downloaded. Check your connection and try again.` });
    }
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fitx-text">Download my data</h3>
        <p className="mt-0.5 max-w-prose text-sm leading-6 text-fitx-text-secondary">Everything FITX stores for you, as a JSON file.</p>
        {state.text && (
          <p role={state.kind === "error" || state.kind === "signed_out" ? "alert" : "status"} className={`mt-2 text-sm ${state.kind === "error" || state.kind === "signed_out" ? "text-fitx-danger" : state.kind === "done" ? "text-fitx-success" : "text-fitx-text-secondary"}`}>
            {state.kind === "signed_out"
              ? <>Your session has ended. <Link href={signInHref("/settings#your-data")} className="font-medium text-fitx-primary-text underline underline-offset-2">Sign in again</Link> to download your data.</>
              : state.text}
          </p>
        )}
      </div>
      <button type="button" onClick={() => void download()} aria-disabled={state.kind === "working" || undefined} className="fitx-button fitx-button-secondary min-h-11 shrink-0 px-4 text-sm aria-disabled:opacity-60">
        <Download size={16} aria-hidden="true" />{state.kind === "working" ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}
