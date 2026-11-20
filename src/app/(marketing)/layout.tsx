import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

// Static pages, regenerated in the background at most every five minutes so the footer and the landing contact
// block pick up the website information saved in FITX Admin (src/components/landing/site-contact.ts).
export const revalidate = 300;

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col"><PublicHeader/>{children}<PublicFooter/></div>;
}
