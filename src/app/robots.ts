import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/workouts", "/nutrition", "/progress", "/goals", "/planner", "/profile", "/settings", "/exercises", "/api/"] }],
    sitemap: "https://fitnessx.vercel.app/sitemap.xml",
  };
}
