"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BookOpen, CalendarDays, ChartNoAxesColumn, Dumbbell, Ellipsis, House, Target, UserRound, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/progress", label: "Progress", icon: ChartNoAxesColumn },
];

const moreItems = [
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/profile", label: "Profile & settings", icon: UserRound },
  { href: "/exercises", label: "Exercise library", icon: BookOpen },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`)) || pathname === "/settings";

  if (pathname === "/workouts/active") return null;

  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-fitx-divider bg-fitx-nav px-1 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur lg:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined}
            className={cn("flex min-h-12 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-fitx-primary-text" : "text-fitx-text-disabled")}>
            <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
      <div className="relative flex min-h-12 items-center justify-center">
        <div id="mobile-more-links" hidden={!moreOpen} className="absolute bottom-full right-1 mb-3 w-56 rounded-xl border border-fitx-border bg-fitx-elevated p-2 shadow-2xl">
          {moreItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm", active ? "bg-fitx-primary/10 text-fitx-primary-text" : "text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text")}>
              <Icon size={17} aria-hidden="true"/><span>{label}</span>
            </Link>;
          })}
        </div>
        <button type="button" aria-expanded={moreOpen} aria-controls="mobile-more-links" onClick={() => setMoreOpen((open) => !open)} className={cn("flex min-h-12 w-full flex-col items-center justify-center gap-1 text-[11px]", moreActive || moreOpen ? "text-fitx-primary-text" : "text-fitx-text-disabled")}>
          <Ellipsis size={19} strokeWidth={moreActive || moreOpen ? 2.2 : 1.8} aria-hidden="true"/>
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
