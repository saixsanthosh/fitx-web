import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col"><PublicHeader/>{children}<PublicFooter/></div>;
}
