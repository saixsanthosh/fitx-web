import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://fitnessx.vercel.app";
  return ["", "/features", "/about", "/pricing", "/for-gyms", "/privacy", "/terms", "/cookies", "/refunds"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path ? "monthly" : "weekly",
    priority: path ? 0.7 : 1,
  }));
}
