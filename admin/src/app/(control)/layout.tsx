import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/admin-auth";
import { allowedPages } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page checks again with its own permission; this only frames the console.
  const operator = await requireAdmin();
  return <AdminShell username={operator.username} role={operator.role} pages={allowedPages(operator.role)}>{children}</AdminShell>;
}
