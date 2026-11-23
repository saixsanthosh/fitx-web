import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { SessionKeeper } from "@/components/app/SessionKeeper";
import { UserContextProvider } from "@/components/app/UserContextProvider";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { IntroCompletionReporter } from "@/components/brand/IntroCompletionReporter";
import { CoachLauncher } from "@/components/layout/CoachLauncher";
import { CoachPanelHost } from "@/components/coach/CoachPanelHost";
import "@/components/layout/nav-icons/nav-icons.css";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <div className="flex min-h-dvh bg-background">
        {/* Idle unless the head script marked the film pending (once per account) or Replay is pressed. A fixed
            overlay, first in the page so that once it is gone Tab carries on from the top of the page (Skip to
            content), not from after the last control. */}
        <CinematicIntro />
        <Sidebar />
        <div className="min-w-0 flex-1">
          <WorkspaceHeader />
          {/* Renders nothing unless FITX Admin has a live announcement this person has not dismissed. */}
          <AnnouncementBanner />
          {/* The phone bar shows below 768 px, so the bottom padding stays clear of it (and the home indicator) until md. */}
          <main id="main-content" className="mx-auto w-full max-w-[1440px] px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-14 lg:px-10 lg:pt-10">{children}</main>
        </div>
        <BottomNav />
        {/* The floating AI Coach button: draggable, dismissable for this page load, off for good in Settings. */}
        <CoachLauncher />
        {/* Takes the launcher's fitx:coach-open event and opens the AI Coach panel (loaded on first open). */}
        <CoachPanelHost />
        <SessionKeeper />
        <IntroCompletionReporter />
      </div>
    </UserContextProvider>
  );
}
