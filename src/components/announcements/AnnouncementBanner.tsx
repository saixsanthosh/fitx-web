"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { m } from "framer-motion";
import { CircleCheck, Info, Megaphone, TriangleAlert, Wrench, X, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isMaintenanceLive, parsePlatformSettings, type Maintenance } from "@/lib/platform/settings";

type Tone = "info" | "success" | "warning";

type Notice = {
  id: string;
  title: string;
  body: string;
  tone: Tone;
  link_url: string | null;
  link_label: string | null;
};

const TONES: Record<Tone, { icon: LucideIcon; accent: string; iconColor: string }> = {
  info: { icon: Info, accent: "border-l-fitx-info", iconColor: "text-fitx-info" },
  success: { icon: CircleCheck, accent: "border-l-fitx-success", iconColor: "text-fitx-success" },
  warning: { icon: TriangleAlert, accent: "border-l-fitx-warning", iconColor: "text-fitx-warning" },
};

/** Hidden maintenance notices, for this tab only, so a long window cannot be missed on the next visit. */
const MAINTENANCE_HIDDEN_KEY = "fitx-maintenance-hidden";

/** "internal" for a FITX path, "external" for an https:// address, null for anything else. */
function linkKind(url: string | null): "internal" | "external" | null {
  if (!url) return null;
  if (url.startsWith("/") && !/^\/[/\\]/.test(url)) return "internal";
  return url.startsWith("https://") ? "external" : null;
}

function maintenanceKey(maintenance: Maintenance): string {
  return `${maintenance.title}|${maintenance.startsAt ?? ""}|${maintenance.endsAt ?? ""}`;
}

function readHidden(): string | null {
  try {
    return window.sessionStorage.getItem(MAINTENANCE_HIDDEN_KEY);
  } catch {
    return null;
  }
}

function NoticeCard({ label, notice, icon, dismissLabel, onDismiss }: { label: string; notice: Notice; icon?: LucideIcon; dismissLabel: string; onDismiss: () => void }) {
  const tone = TONES[notice.tone] ?? TONES.info;
  const Icon = icon ?? tone.icon;
  const kind = linkKind(notice.link_url);
  const linkClass = "mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-fitx-primary-text underline-offset-4 hover:underline";
  return (
    <m.section
      aria-label={label}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`fitx-panel flex items-start gap-3 border-l-4 ${tone.accent} p-3.5 sm:p-4`}
    >
      <Icon aria-hidden="true" size={19} className={`mt-0.5 shrink-0 ${tone.iconColor}`} />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-fitx-text">{notice.title}</h2>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fitx-text-secondary">{notice.body}</p>
        {kind === "internal" && notice.link_url && <Link href={notice.link_url} className={linkClass}>{notice.link_label}</Link>}
        {kind === "external" && notice.link_url && <a href={notice.link_url} target="_blank" rel="noopener noreferrer" className={linkClass}>{notice.link_label}</a>}
      </div>
      <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
        <X aria-hidden="true" size={18} />
      </button>
    </m.section>
  );
}

/**
 * What the FITX team wants signed-in members to see, written in FITX Admin: a maintenance notice (Settings,
 * during its window; hidden for this tab when closed), the newest notice sent to this account (Notifications,
 * until dismissed) and the newest announcement to everyone this account has not dismissed. Row-level
 * security returns only live announcements and the member's own notices and dismissals. Each part renders
 * nothing when signed out or before its migration is applied. Mounted once, under the workspace header.
 */
export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Notice | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [live, dismissed, notices, settings] = await Promise.all([
        supabase.from("announcements").select("id,title,body,tone,link_url,link_label").order("published_at", { ascending: false }).limit(5),
        supabase.from("announcement_dismissals").select("announcement_id"),
        supabase.from("member_notifications").select("id,title,body,tone,link_url,link_label").is("dismissed_at", null).order("created_at", { ascending: false }).limit(1),
        supabase.from("platform_settings").select("maintenance").eq("id", 1).maybeSingle(),
      ]);
      if (!active) return;
      if (!live.error && !dismissed.error) {
        const hidden = new Set((dismissed.data as Array<{ announcement_id: string }>).map((row) => row.announcement_id));
        const next = (live.data as Notice[]).find((row) => !hidden.has(row.id));
        if (next) setAnnouncement(next);
      }
      if (!notices.error && notices.data?.[0]) setMessage(notices.data[0] as Notice);
      if (!settings.error && settings.data) {
        const parsed = parsePlatformSettings({ maintenance: (settings.data as { maintenance: unknown }).maintenance }).maintenance;
        if (parsed && isMaintenanceLive(parsed) && readHidden() !== maintenanceKey(parsed)) setMaintenance(parsed);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!announcement && !message && !maintenance) return null;

  async function dismissAnnouncement() {
    const id = announcement?.id;
    setAnnouncement(null);
    const supabase = createClient();
    // A second dismissal from another device is a harmless duplicate, so errors are ignored.
    if (supabase && id) await supabase.from("announcement_dismissals").insert({ announcement_id: id });
  }

  async function dismissMessage() {
    const id = message?.id;
    setMessage(null);
    const supabase = createClient();
    // The database stamps the time itself; it only needs a value.
    if (supabase && id) await supabase.from("member_notifications").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
  }

  function hideMaintenance() {
    if (maintenance) {
      try {
        window.sessionStorage.setItem(MAINTENANCE_HIDDEN_KEY, maintenanceKey(maintenance));
      } catch {
        // Private windows can refuse storage; the notice then hides until the next page load.
      }
    }
    setMaintenance(null);
  }

  return (
    <div className="mx-auto grid w-full max-w-[1480px] gap-2 px-4 pt-4 sm:px-6 lg:px-8">
      {maintenance && (
        <NoticeCard
          label="Maintenance"
          icon={Wrench}
          notice={{ id: "maintenance", title: maintenance.title, body: maintenance.body, tone: "warning", link_url: null, link_label: null }}
          dismissLabel="Hide maintenance notice"
          onDismiss={hideMaintenance}
        />
      )}
      {message && <NoticeCard label="Message from FITX" icon={Megaphone} notice={message} dismissLabel="Dismiss message" onDismiss={dismissMessage} />}
      {announcement && <NoticeCard label="Announcement" notice={announcement} dismissLabel="Dismiss announcement" onDismiss={dismissAnnouncement} />}
    </div>
  );
}
