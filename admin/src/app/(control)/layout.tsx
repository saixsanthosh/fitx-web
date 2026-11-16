import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/admin-auth";
import { allowedPages } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email} role={admin.role} pages={allowedPages(admin.role)}>{children}</AdminShell>;
}
