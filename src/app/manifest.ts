import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FITX — Train smart. Live fit.",
    short_name: "FITX",
    description: "Plan workouts, track nutrition, and follow your fitness progress.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F7F4",
    theme_color: "#F7F7F4",
    icons: [
      // The new mark (logo.jpeg) on its dark tile; the maskable one keeps the mark inside the safe circle.
      { src: "/brand/fitx-app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/fitx-app-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/fitx-app-icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
