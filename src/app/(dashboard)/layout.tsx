import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { SessionKeeper } from "@/components/app/SessionKeeper";
import { UserContextProvider } from "@/components/app/UserContextProvider";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { IntroCompletionReporter } from "@/components/brand/IntroCompletionReporter";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <div className="flex min-h-dvh bg-background">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <WorkspaceHeader />
          {/* Renders nothing unless FITX Admin has a live announcement this person has not dismissed. */}
          <AnnouncementBanner />
          {/* The phone bar shows below 768 px, so the bottom padding stays clear of it until md. */}
          <main id="main-content" className="mx-auto w-full max-w-[1480px] px-4 py-5 pb-24 sm:px-6 sm:pt-7 md:pb-10 lg:px-8">{children}</main>
        </div>
        <BottomNav />
        <SessionKeeper />
        {/* Idle unless the head script marked the film pending (once per account) or Replay is pressed. */}
        <CinematicIntro />
        <IntroCompletionReporter />
      </div>
    </UserContextProvider>
  );
}
