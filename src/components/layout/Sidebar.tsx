"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChartNoAxesColumn, Dumbbell, House, Target, UserRound, Utensils } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/progress", label: "Progress", icon: ChartNoAxesColumn },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 flex-col border-r border-fitx-divider bg-fitx-surface lg:flex">
      <Link href="/dashboard" className="flex h-[76px] items-center gap-2.5 border-b border-fitx-divider px-6">
        <Logo size={39} />
      </Link>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 px-3 py-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                active ? "bg-fitx-primary/10 text-fitx-primary" : "text-fitx-text-secondary hover:bg-white/[.04] hover:text-fitx-text"
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-fitx-primary" />}
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-fitx-divider p-4 text-xs text-fitx-text-disabled">Your pace. Your progress.</div>
    </aside>
  );
}
