import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <WorkspaceHeader />
        <main className="mx-auto w-full max-w-[1480px] px-4 py-5 pb-24 sm:px-6 sm:py-7 lg:px-8 lg:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
