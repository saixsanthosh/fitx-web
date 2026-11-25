import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

// Static pages, regenerated in the background at most every five minutes so the footer and the landing contact
// block pick up the website information saved in FITX Admin (src/components/landing/site-contact.ts).
export const revalidate = 300;

export default function PublicLayout({ children }: { children: ReactNode }) {
  // The page ends in the footer's dark band: while the privacy banner is open, the room kept after the page's end
  // goes inside the band (globals.css, .fitx-holds-end-room and the footer's .fitx-band-end).
  return <div className="fitx-holds-end-room flex min-h-dvh flex-col"><PublicHeader/>{children}<PublicFooter/></div>;
}
