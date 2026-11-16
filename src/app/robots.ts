import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [
      "/dashboard", "/workouts", "/nutrition", "/activity", "/ai-coach", "/progress", "/goals", "/planner",
      "/profile", "/settings", "/help", "/exercises", "/form-coach", "/onboarding", "/signin", "/signup",
      "/forgot-password", "/auth/", "/api/",
    ] }],
    sitemap: "https://fitnessx.vercel.app/sitemap.xml",
  };
}
