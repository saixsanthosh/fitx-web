import Link from "next/link";
import { FitxMark } from "@/components/fitx-mark";
import { AdminNavigation } from "@/components/admin-navigation";
import { signOut } from "@/app/signin/actions";
import { ROLE_LABELS, type AdminRole } from "@/lib/roles";

export function AdminShell({ children, email, role, pages }: { children: React.ReactNode; email: string; role: AdminRole; pages: readonly string[] }) {
  const roleLabel = ROLE_LABELS[role];

  return (
    <div className="admin-shell">
      <aside className="sidebar" aria-label="Main sidebar">
        <Link href="/overview" className="brand-lockup" aria-label="FITX Admin overview">
          <span className="brand-mark"><FitxMark /></span>
          <span className="brand-copy"><strong>FITX</strong><small>ADMIN</small></span>
        </Link>
        <AdminNavigation allowed={pages} />
        <div className="sidebar-bottom">
          <div className="system-status"><span className="status-dot" />Private workspace</div>
          <p>Operations console</p>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <details className="mobile-menu">
            <summary aria-label="Open navigation"><span className="menu-glyph" /></summary>
            <div className="mobile-menu-panel">
              <AdminNavigation mobile allowed={pages} />
            </div>
          </details>
          <Link href="/overview" className="mobile-brand" aria-label="FITX Admin overview">
            <FitxMark size={28} /> <span>FITX <em>ADMIN</em></span>
          </Link>
          <div className="topbar-spacer" />
          <div className="account-chip">
            <span className="account-avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
            <span className="account-details"><strong>{email}</strong><small>{roleLabel}</small></span>
          </div>
          <form action={signOut}>
            <button className="signout-button" type="submit">Sign out</button>
          </form>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
