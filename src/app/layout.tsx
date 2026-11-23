import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { BRAND } from "@/config/brand";
import { Toaster } from "@/components/ui/Toaster";
import { AnalyticsConsent } from "@/components/layout/AnalyticsConsent";
import { INTRO_BOOTSTRAP_SCRIPT } from "@/components/brand/introBootstrap";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { ReturningLogin } from "@/components/brand/logo/ReturningLogin";
import { MotionProvider } from "@/components/motion/MotionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fitnessx.vercel.app"),
  title: { default: BRAND.meta.title, template: "%s | FITX" },
  description: BRAND.meta.description,
  authors: [{ name: BRAND.meta.author }],
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  keywords: [
    "FITX",
    "fitness tracker",
    "workout planning",
    "nutrition tracking",
  ],
  openGraph: {
    title: BRAND.meta.title,
    description: BRAND.meta.description,
    type: "website",
    siteName: BRAND.name,
    url: "https://fitnessx.vercel.app/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "FITX fitness tracker" }],
  },
  alternates: { canonical: "/" },
  twitter: { card: "summary_large_image", title: BRAND.meta.title, description: BRAND.meta.description, images: ["/opengraph-image"] },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/brand/fitx-favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/brand/fitx-favicon-32.png",
    apple: [{ url: "/brand/fitx-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7F4" },
    { media: "(prefers-color-scheme: dark)", color: "#151715" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      // Visitors without JavaScript follow their device; the head script applies a saved choice.
      data-theme="system"
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* Theme + intro start, before the first paint (see introBootstrap.ts). */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-body bg-background text-foreground">
        <BrandLoader />
        {/* A returning member's sign-in: the logo reveal, hidden unless the head script marks it. */}
        <ReturningLogin />
        <MotionProvider>
          {children}
          <Toaster />
          <AnalyticsConsent />
        </MotionProvider>
      </body>
    </html>
  );
}
