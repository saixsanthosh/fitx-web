import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ADMIN_THEME_COOKIE, parseAdminTheme, themeAttribute } from "@/components/theme/theme";
import "./globals.css";

// The Content-Security-Policy uses a nonce per response (src/proxy.ts). Next.js can only add it to
// pages rendered for a request, so every page renders dynamically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "FITX Admin", template: "%s · FITX Admin" },
  description: "Private FITX platform operations console.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The chosen theme is painted by the server, so nothing flashes; "system" leaves it to the device.
  const theme = parseAdminTheme((await cookies()).get(ADMIN_THEME_COOKIE)?.value);
  return (
    <html lang="en-GB" data-theme={themeAttribute(theme)}>
      <body>{children}</body>
    </html>
  );
}
