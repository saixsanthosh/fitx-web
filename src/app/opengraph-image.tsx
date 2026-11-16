import { ImageResponse } from "next/og";

export const alt = "FITX: training, nutrition and progress in one place";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card: the FITX mark and wordmark with the landing headline, in the light brand palette. */
export default function OpenGraphImage() {
  const ink = "#191C19";
  const coral = "#C44933";
  const muted = "#525952";
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#F7F7F4", color: ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke={ink} strokeWidth="5.5" strokeLinecap="square">
          <path d="M10 13H54" />
          <path d="M32 13V54" />
          <path d="M10 29H32" />
          <path d="M32 31L53 52M32 52L53 31" />
        </svg>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 800, letterSpacing: -5 }}>FITX</div>
        <div style={{ display: "flex", width: 1, height: 40, marginLeft: 14, background: "#C7C9C1" }} />
        <div style={{ display: "flex", marginLeft: 14, color: muted, fontSize: 18, letterSpacing: 3 }}>TRAIN SMART. LIVE FIT.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 800, letterSpacing: -6, lineHeight: 0.95 }}>YOUR FITNESS.</div>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 800, letterSpacing: -6, lineHeight: 0.95, color: coral }}>YOUR WAY.</div>
        <div style={{ display: "flex", marginTop: 30, color: muted, fontSize: 28 }}>Workouts, food logging and progress, shaped around you.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, color: coral, fontSize: 22 }}>
        <div style={{ display: "flex", width: 40, height: 2, background: coral }} />
        fitnessx.vercel.app
      </div>
    </div>,
    size,
  );
}
