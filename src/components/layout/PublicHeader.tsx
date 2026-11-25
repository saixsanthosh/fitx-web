import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { PublicMobileMenu } from "./PublicMobileMenu";
import { PUBLIC_NAV } from "./publicNav";
import { ShellEffects } from "./ShellEffects";
import { SkipLink } from "./SkipLink";
import styles from "./PublicHeader.module.css";

/**
 * The public pages' header: the logo, the site's sections (tablets and up), "Log in" (400 px and up), the main button
 * ("Create account", or "Open dashboard" for a signed-in visitor) and the phone menu. Below 320 px, a folding phone's
 * cover screen, the logo is the mark alone and the button a little narrower, so the row fits with the menu button in
 * full and no sideways scrolling (PublicHeader.module.css, bug 75).
 */
export function PublicHeader() {
  return (
    <header className="fitx-glass sticky top-0 z-40 border-b border-fitx-divider bg-background/92">
      <SkipLink />
      <ShellEffects />
      <div className="fitx-container flex h-[68px] items-center justify-between gap-3">
        <Link href="/" aria-label="FITX home" className={`${styles.brand} flex min-h-11 items-center`}><Logo size={32} /></Link>
        <nav aria-label="Site" className="hidden items-center gap-1 text-sm text-fitx-text-secondary md:flex">
          {PUBLIC_NAV.map(({ href, label }) => <Link key={href} className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-fitx-hover hover:text-fitx-text" href={href}>{label}</Link>)}
        </nav>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Both groups render; the head script marks signed-in visitors (fitx_auth cookie) before first paint, so static pages never show "Log in" to them. */}
          <span className={styles.signedOut}>
            <Link href="/signin" prefetch={false} className="hidden min-h-11 items-center rounded-lg px-3 text-sm text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text min-[400px]:inline-flex">Log in</Link>
            <Link href="/signup" prefetch={false} className={`fitx-button ${styles.cta} min-h-11 whitespace-nowrap text-sm`}>Create account</Link>
          </span>
          <span className={styles.signedIn}><Link href="/dashboard" prefetch={false} className={`fitx-button ${styles.cta} min-h-11 whitespace-nowrap text-sm`}>Open dashboard</Link></span>
          <PublicMobileMenu />
        </div>
      </div>
    </header>
  );
}
