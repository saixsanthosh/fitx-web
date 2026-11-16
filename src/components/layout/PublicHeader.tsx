import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import styles from "./PublicHeader.module.css";

export function PublicHeader() {
  return <header className="sticky top-0 z-40 border-b border-fitx-divider bg-background/92 backdrop-blur"><div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
    <Link href="/" aria-label="FITX home" className="flex items-center gap-2"><Logo size={32}/><span className="hidden text-[10px] font-semibold tracking-[.14em] text-fitx-text-secondary lg:inline">TRAIN SMART. LIVE FIT.</span></Link>
    <nav aria-label="Public navigation" className="hidden items-center gap-6 text-sm text-fitx-text-secondary md:flex"><Link className="hover:text-fitx-text" href="/features">Features</Link><Link className="hover:text-fitx-text" href="/about">About</Link><Link className="hover:text-fitx-text" href="/pricing">Pricing</Link></nav>
    <div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeSwitcher/>
      {/* Both groups render; the head script marks signed-in visitors (fitx_auth cookie) before first paint, so static pages never show "Log in" to them. */}
      <span className={styles.signedOut}><Link href="/signin" prefetch={false} className="inline-flex min-h-10 items-center px-1.5 text-xs text-fitx-text-secondary hover:text-fitx-text sm:px-3 sm:text-sm">Log in</Link><Link href="/signup" prefetch={false} aria-label="Create a FITX account" className="fitx-button min-h-10 whitespace-nowrap px-2.5 text-xs sm:px-3 sm:text-sm"><span className="hidden sm:inline">Create account</span><span className="sm:hidden">Join</span></Link></span>
      <span className={styles.signedIn}><Link href="/dashboard" prefetch={false} className="fitx-button min-h-10 whitespace-nowrap px-2.5 text-xs sm:px-3 sm:text-sm">Open dashboard</Link></span>
    </div>
  </div></header>;
}
