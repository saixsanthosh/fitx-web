import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.user.email ?? "Administrator"} role={admin.role}>{children}</AdminShell>;
}
