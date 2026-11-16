"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { countRecords, exportAccountData, exportFileName, ExportError } from "@/lib/account/export";
import { createClient } from "@/lib/supabase/client";

/**
 * Settings → "Your data": download everything FITX stores for the account (read in the browser under
 * row-level security) and delete the account (server route, after a recent sign-in). Mounted by the
 * Settings page; the section id "your-data" is where a re-sign-in for deletion returns to.
 */
export function SettingsData() {
  return (
    <section id="your-data" aria-labelledby="settings-your-data" className="fitx-panel scroll-mt-24 p-5">
      <h2 id="settings-your-data" className="text-base font-semibold text-fitx-text">Your data</h2>
      <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">Take a copy of everything FITX stores for you, or delete your account for good.</p>
      <div className="mt-4 divide-y divide-fitx-divider border-t border-fitx-divider">
        <DownloadData />
        <DeleteAccount />
      </div>
    </section>
  );
}

/** A section label inside a sentence: "Food log" becomes "food log", "AI coach messages" keeps its "AI". */
function inSentence(label: string) {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function DownloadData() {
  const [state, setState] = useState<{ kind: "idle" | "working" | "done" | "error"; text: string }>({ kind: "idle", text: "" });

  async function download() {
    const supabase = createClient();
    if (!supabase) return setState({ kind: "error", text: "Downloading isn't available right now because FITX can't reach its database." });
    setState({ kind: "working", text: "Collecting your data…" });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setState({ kind: "error", text: "Your session has ended. Sign in again to download your data." });
    try {
      const data = await exportAccountData(supabase, auth.user, {
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
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fitx-text">Download my data</h3>
        <p className="mt-1 max-w-prose text-sm leading-6 text-fitx-text-secondary">A JSON file with your profile, preferences, workouts, activities, food log, weigh-ins, goals, planner, AI coach conversations and help requests, plus the names of images you uploaded.</p>
        {state.text && (
          <p role={state.kind === "error" ? "alert" : "status"} className={`mt-2 text-sm ${state.kind === "error" ? "text-fitx-danger" : state.kind === "done" ? "text-fitx-success" : "text-fitx-text-secondary"}`}>{state.text}</p>
        )}
      </div>
      <button type="button" onClick={() => void download()} disabled={state.kind === "working"} className="fitx-button fitx-button-secondary min-h-11 shrink-0 px-4 text-sm">
        <Download size={16} aria-hidden="true" />{state.kind === "working" ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}
