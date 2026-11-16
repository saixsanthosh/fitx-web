"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Announcement = {
  id: string;
  title: string;
  body: string;
  tone: "info" | "success" | "warning";
  link_url: string | null;
  link_label: string | null;
};

const TONES = {
  info: { icon: Info, accent: "border-l-fitx-info", iconColor: "text-fitx-info" },
  success: { icon: CircleCheck, accent: "border-l-fitx-success", iconColor: "text-fitx-success" },
  warning: { icon: TriangleAlert, accent: "border-l-fitx-warning", iconColor: "text-fitx-warning" },
} as const;

/** "internal" for a FITX path, "external" for an https:// address, null for anything else. */
function linkKind(url: string | null): "internal" | "external" | null {
  if (!url) return null;
  if (url.startsWith("/") && !/^\/[/\\]/.test(url)) return "internal";
  return url.startsWith("https://") ? "external" : null;
}

/**
 * The newest published announcement this person has not dismissed, written in FITX Admin.
 * Row-level security returns only live announcements and the person's own dismissals. It renders
 * nothing when there is none, when signed out, or before the announcements migration is applied.
 * Mount it once, directly under the workspace header (see admin/README.md, Announcements).
 */
export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [live, dismissed] = await Promise.all([
        supabase.from("announcements").select("id,title,body,tone,link_url,link_label").order("published_at", { ascending: false }).limit(5),
        supabase.from("announcement_dismissals").select("announcement_id"),
      ]);
      if (live.error || dismissed.error) return;
      const hidden = new Set((dismissed.data as Array<{ announcement_id: string }>).map((row) => row.announcement_id));
      const next = (live.data as Announcement[]).find((row) => !hidden.has(row.id));
      if (active && next) setAnnouncement(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!announcement) return null;

  async function dismiss() {
    const id = announcement?.id;
    setAnnouncement(null);
    const supabase = createClient();
    // A second dismissal from another device is a harmless duplicate, so errors are ignored.
    if (supabase && id) await supabase.from("announcement_dismissals").insert({ announcement_id: id });
  }

  const tone = TONES[announcement.tone] ?? TONES.info;
  const Icon = tone.icon;
  const kind = linkKind(announcement.link_url);
  const linkClass = "mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-fitx-primary underline-offset-4 hover:underline";

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pt-4 sm:px-6 lg:px-8">
      <section aria-label="Announcement" className={`fitx-panel flex items-start gap-3 border-l-4 ${tone.accent} p-3.5 sm:p-4`}>
        <Icon aria-hidden="true" size={19} className={`mt-0.5 shrink-0 ${tone.iconColor}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fitx-text">{announcement.title}</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fitx-text-secondary">{announcement.body}</p>
          {kind === "internal" && announcement.link_url && <Link href={announcement.link_url} className={linkClass}>{announcement.link_label}</Link>}
          {kind === "external" && announcement.link_url && <a href={announcement.link_url} target="_blank" rel="noopener noreferrer" className={linkClass}>{announcement.link_label}</a>}
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss announcement" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
          <X aria-hidden="true" size={18} />
        </button>
      </section>
    </div>
  );
}
