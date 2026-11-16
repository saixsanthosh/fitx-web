import type { Metadata } from "next";
import "./globals.css";

// The Content-Security-Policy uses a nonce per response (src/proxy.ts). Next.js can only add it to
// pages rendered for a request, so every page renders dynamically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "FITX Admin", template: "%s · FITX Admin" },
  description: "Private FITX platform operations console.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
