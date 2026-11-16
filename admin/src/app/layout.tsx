import type { Metadata } from "next";
import "./globals.css";

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
