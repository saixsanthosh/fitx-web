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
      { src: "/brand/fitx-app-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/fitx-app-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
