import { ImageResponse } from "next/og";

export const alt = "FITX fitness tracker for workouts, food, and progress";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#090d0f", color: "#f2f5f4", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 58, fontWeight: 900, fontStyle: "italic", letterSpacing: -7 }}><span>FIT</span><span style={{ color: "#79df83" }}>X</span></div>
        <div style={{ display: "flex", width: 1, height: 42, background: "#35403e" }} />
        <div style={{ display: "flex", color: "#a1adab", fontSize: 20, letterSpacing: 4 }}>FITNESS, CLEARLY TRACKED</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 920 }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.08 }}>Plan training. Log meals. See progress.</div>
        <div style={{ display: "flex", marginTop: 24, color: "#a1adab", fontSize: 26 }}>Workouts, nutrition, and your own progress in one place.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#79df83", fontSize: 22 }}>fitnessx.vercel.app</div>
    </div>,
    size,
  );
}
