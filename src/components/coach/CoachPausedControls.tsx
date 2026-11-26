"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import type { ProviderNotice } from "@/lib/ai/status";
import { CoachSettings } from "./CoachSettings";
import { NO_ANNOUNCEMENT, liveRegionText, nextAnnouncement, readablePlace, settleAnnouncement, type Announcement } from "./focus-rules";

/**
 * While the AI coach is switched off in Admin, /ai-coach lands on /unavailable: this keeps the coach's data
 * controls there (stop sharing, delete coach history), whose APIs stay open.
 */
export function CoachPausedControls({
  shareData: initialShareData,
  minor,
  ageMissing,
  providers,
}: {
  shareData: boolean;
  minor: boolean;
  ageMissing: boolean;
  providers: ProviderNotice[];
}) {
  const [open, setOpen] = useState(false);
  const [shareData, setShareData] = useState(initialShareData);
  // The same words twice are read twice (announcementText), as on the coach page. While Coach settings is open the page
  // behind it is inert, so what is said then is read in the dialog's own region (settleAnnouncement).
  const [announcement, setAnnouncement] = useState<Announcement>(NO_ANNOUNCEMENT);
  const announce = (text: string) => setAnnouncement((old) => nextAnnouncement(old, text));
  const settled = settleAnnouncement(announcement, readablePlace({ settings: open, history: false }));
  if (settled !== announcement) setAnnouncement(settled);

  return (
    <div className="grid justify-items-center gap-2">
      <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-5" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" size={16} />
        Coach settings
      </button>
      <p className="text-sm text-fitx-text-secondary" role="status" aria-live="polite">{liveRegionText(announcement, "page")}</p>
      <CoachSettings
        open={open}
        onClose={() => setOpen(false)}
        shareData={shareData}
        minor={minor}
        ageMissing={ageMissing}
        providers={providers}
        canTurnOn={false}
        status={liveRegionText(announcement, "settings")}
        onShareChange={(share) => {
          setShareData(share);
          announce(share ? "" : "The coach no longer uses your FITX data.");
        }}
        onDeleted={() => {
          // Closed at once (its effect runs inside flushSync), so the page is no longer inert when the result is read
          // on it.
          flushSync(() => setOpen(false));
          setShareData(false);
          announce("Your coach data was deleted.");
        }}
      />
    </div>
  );
}
