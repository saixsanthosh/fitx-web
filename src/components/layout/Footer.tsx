import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { BRAND } from "@/config/brand";

export function Footer() {
  return <footer className="border-t border-fitx-divider bg-fitx-bg"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6"><Link href="/dashboard" className="flex items-center gap-2"><Logo size={30}/><span className="font-medium">{BRAND.name}</span></Link><p className="text-xs text-fitx-text-disabled">Plan workouts, track meals, and follow your progress.</p></div></footer>;
}
