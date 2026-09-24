import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { BRAND } from "@/config/brand";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fitx-web-five.vercel.app"),
  title: BRAND.meta.title,
  description: BRAND.meta.description,
  authors: [{ name: BRAND.meta.author }],
  keywords: [
    "fitness",
    "workout tracker",
    "nutrition tracker",
    "FITX",
  ],
  openGraph: {
    title: BRAND.meta.title,
    description: BRAND.meta.description,
    type: "website",
    siteName: BRAND.name,
  },
};

export const viewport: Viewport = {
  themeColor: "#070809",
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
    className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
