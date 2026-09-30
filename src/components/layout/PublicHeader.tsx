import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export function PublicHeader() {
  return <header className="sticky top-0 z-40 border-b border-fitx-divider bg-[#090d0f]/90 backdrop-blur"><div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
    <Link href="/" aria-label="FITX home" className="flex items-center gap-2"><Logo size={36}/><span className="hidden text-xs font-medium tracking-[.18em] text-fitx-text-secondary sm:inline">TRAINING, CLEARLY TRACKED</span></Link>
    <nav aria-label="Public navigation" className="hidden items-center gap-6 text-sm text-fitx-text-secondary md:flex"><Link className="hover:text-fitx-text" href="/features">Features</Link><Link className="hover:text-fitx-text" href="/about">About</Link><Link className="hover:text-fitx-text" href="/pricing">Pricing</Link></nav>
    <div className="flex items-center gap-2"><Link href="/signin" className="hidden min-h-10 items-center px-3 text-sm text-fitx-text-secondary hover:text-fitx-text sm:inline-flex">Sign in</Link><Link href="/signup" className="fitx-button min-h-10 px-3 text-sm">Create account</Link></div>
  </div></header>;
}
