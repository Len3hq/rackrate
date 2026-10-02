import { ImageResponse } from "next/og";

export const alt = "Rackrate: weekly GPU rental-rate forwards on Monad";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0d0b12", padding: 72, color: "#eeebf5" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 48 48">
            <path d="M4.4 34 H12 V12 H18 V31 H24 V19 H30 V24" fill="none" stroke="#A08BFF" strokeWidth="3.2" />
            <rect x="29" y="22.4" width="13" height="3.2" fill="#45E3A6" />
            <circle cx="42" cy="24" r="3.6" fill="#45E3A6" />
          </svg>
          <span style={{ fontSize: 40, fontWeight: 600 }}>Rackrate</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.02 }}>Lock in next week&apos;s</span>
          <span style={{ fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.02, color: "#A08BFF" }}>GPU rate.</span>
          <span style={{ marginTop: 28, fontSize: 30, color: "#c5c0d2" }}>Weekly H100 rental-rate forwards on Monad, traded on Kuru.</span>
        </div>
      </div>
    ),
    size,
  );
}
