"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ProviderNotice } from "@/lib/ai/status";
import { CoachSettings } from "./CoachSettings";
import { announcementText } from "./focus-rules";

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
  // The same words twice are read twice (announcementText), as on the coach page.
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const announce = (text: string) => setAnnouncement((old) => ({ text, count: old.count + 1 }));

  return (
    <div className="grid justify-items-center gap-2">
      <button type="button" className="fitx-button fitx-button-secondary min-h-11 px-5" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" size={16} />
        Coach settings
      </button>
      <p className="text-sm text-fitx-text-secondary" role="status" aria-live="polite">{announcementText(announcement.text, announcement.count)}</p>
      <CoachSettings
        open={open}
        onClose={() => setOpen(false)}
        shareData={shareData}
        minor={minor}
        ageMissing={ageMissing}
        providers={providers}
        canTurnOn={false}
        onShareChange={(share) => {
          setShareData(share);
          announce(share ? "" : "The coach no longer uses your FITX data.");
        }}
        onDeleted={() => {
          setOpen(false);
          setShareData(false);
          announce("Your coach data was deleted.");
        }}
      />
    </div>
  );
}
