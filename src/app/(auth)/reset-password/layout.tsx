import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component, which can't export metadata: its title lives here, so the tab, history and
// the route announcer say "New password | FITX" instead of the home page's title.
export const metadata: Metadata = { title: "New password" };

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
