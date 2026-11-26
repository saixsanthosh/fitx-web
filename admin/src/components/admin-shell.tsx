import Link from "next/link";
import { KeyRound, LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { AdminNavigation, MobileMenu, SectionTitle } from "@/components/admin-navigation";
import { FitxMark } from "@/components/fitx-mark";
import { RouteTransition } from "@/components/motion/route-transition";
import { SectionCountsProvider } from "@/components/section-counts";
import type { AdminTheme } from "@/components/theme/theme";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { ROLE_LABELS, type AdminRole } from "@/lib/roles";
import type { StampedCounts } from "@/lib/section-counts";
import styles from "./admin-shell.module.css";

/**
 * The console frame: the section rail (a menu dialog below 1024 px), the top bar and the page. `counts` are the menu's
 * badge counts as the layout read them; a page with a newer one tells the menu (components/section-counts.tsx).
 */
export function AdminShell({ children, username, role, pages, counts, theme }: { children: React.ReactNode; username: string; role: AdminRole; pages: readonly string[]; counts: StampedCounts; theme: AdminTheme }) {
  const home = pages[0] ?? "/account";
  return (
    <SectionCountsProvider counts={counts}>
      <div className={styles.shell}>
        <a className={styles.skip} href="#main">Skip to content</a>
        <aside className={styles.rail} aria-label="Console">
          <Link href={home} className={styles.brand} aria-label="FITX Admin home">
            <span className={styles.brandMark}><FitxMark size={26} /></span>
            <span className={styles.brandWord}>FITX<small>ADMIN</small></span>
          </Link>
          <svg className={styles.pulse} viewBox="0 0 200 24" aria-hidden="true" focusable="false">
            <path pathLength={1} d="M0 12H62L70 4L80 20L90 2L100 22L108 12H200" />
          </svg>
          <AdminNavigation allowed={pages} />
          <div className={styles.railFoot}>
            <span className={styles.operatorAvatar} aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
            <span className={styles.operatorText}><strong>{username}</strong><small>{ROLE_LABELS[role]}</small></span>
          </div>
        </aside>

        <div className={styles.column}>
          <header className={styles.topbar}>
            <MobileMenu allowed={pages} theme={theme} />
            <Link href={home} className={styles.topBrand} aria-label="FITX Admin home"><FitxMark size={24} /></Link>
            <SectionTitle />
            <div className={styles.topActions}>
              <span className={styles.themeSlot}><ThemeSwitch initial={theme} /></span>
              <span className={styles.topOperator}><strong>{username}</strong><small>{ROLE_LABELS[role]}</small></span>
              <Link href="/account" className={styles.iconButton} aria-label="Your account" title="Your account"><KeyRound aria-hidden="true" size={18} /></Link>
              <form action={signOut}>
                <button className={styles.signOut} type="submit"><LogOut aria-hidden="true" size={17} /><span>Sign out</span></button>
              </form>
            </div>
          </header>
          <main id="main" className={styles.main} tabIndex={-1}>
            <RouteTransition>{children}</RouteTransition>
          </main>
        </div>
      </div>
    </SectionCountsProvider>
  );
}
