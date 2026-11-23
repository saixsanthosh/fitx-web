import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_THEME_COOKIE, parseAdminTheme } from "@/components/theme/theme";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { getExploreWaiting } from "@/lib/data/explore";
import { getSupportUnread } from "@/lib/data/support";
import { allowedPages } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page checks again with its own permission; this only frames the console.
  const operator = await requireAdmin();
  const working = !operator.mustChangePassword;
  const [store, unread, waiting] = await Promise.all([
    cookies(),
    hasPermission(operator, "support.view") && working ? getSupportUnread() : Promise.resolve(null),
    hasPermission(operator, "explore.view") && working ? getExploreWaiting() : Promise.resolve(null),
  ]);
  const counts = { ...(unread ? { "/support": unread } : {}), ...(waiting ? { "/explore": waiting } : {}) };
  return (
    <AdminShell
      username={operator.username}
      role={operator.role}
      pages={allowedPages(operator.role)}
      counts={Object.keys(counts).length ? counts : undefined}
      theme={parseAdminTheme(store.get(ADMIN_THEME_COOKIE)?.value)}
    >
      {children}
    </AdminShell>
  );
}
