import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { SessionKeeper } from "@/components/app/SessionKeeper";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { IntroCompletionReporter } from "@/components/brand/IntroCompletionReporter";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <WorkspaceHeader />
        <main className="mx-auto w-full max-w-[1480px] px-4 py-5 pb-24 sm:px-6 sm:py-7 lg:px-8 lg:pb-10">{children}</main>
      </div>
      <BottomNav />
      <SessionKeeper />
      {/* Idle unless the head script marked the film pending (once per account) or Replay is pressed. */}
      <CinematicIntro />
      <IntroCompletionReporter />
    </div>
  );
}
