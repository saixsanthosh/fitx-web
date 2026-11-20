import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_THEME_COOKIE, parseAdminTheme } from "@/components/theme/theme";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { getSupportUnread } from "@/lib/data/support";
import { allowedPages } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page checks again with its own permission; this only frames the console.
  const operator = await requireAdmin();
  const [store, unread] = await Promise.all([
    cookies(),
    hasPermission(operator, "support.view") && !operator.mustChangePassword ? getSupportUnread() : Promise.resolve(null),
  ]);
  return (
    <AdminShell
      username={operator.username}
      role={operator.role}
      pages={allowedPages(operator.role)}
      counts={unread ? { "/support": unread } : undefined}
      theme={parseAdminTheme(store.get(ADMIN_THEME_COOKIE)?.value)}
    >
      {children}
    </AdminShell>
  );
}
