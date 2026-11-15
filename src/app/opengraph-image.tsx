import { ImageResponse } from "next/og";

export const alt = "FITX fitness tracker for workouts, food, and progress";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#F7F7F4", color: "#191C19", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 58, fontWeight: 900, letterSpacing: -7 }}>FITX</div>
        <div style={{ display: "flex", width: 1, height: 42, background: "#c7c9c1" }} />
        <div style={{ display: "flex", color: "#656A63", fontSize: 18, letterSpacing: 3 }}>TRAIN SMART. LIVE FIT.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 920 }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.08 }}>Build a routine that fits your life.</div>
        <div style={{ display: "flex", marginTop: 24, color: "#656A63", fontSize: 26 }}>Training, nutrition, and progress in one place.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#C44933", fontSize: 22 }}>FITX · fitnessx.vercel.app</div>
    </div>,
    size,
  );
}
