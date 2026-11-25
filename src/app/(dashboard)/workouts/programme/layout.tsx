import type { Metadata } from "next";

/** The programme page's title (bug 78); the page is a client component. */
export const metadata: Metadata = { title: "Programme" };

export default function ProgrammeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
