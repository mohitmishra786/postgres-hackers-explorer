import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// 180×180 Apple touch icon — same terminal theme, scaled up
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          border: "8px solid #00ff41",
          borderRadius: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          gap: 4,
        }}
      >
        {/* Top label */}
        <div
          style={{
            fontSize: 18,
            color: "#004d14",
            fontWeight: 700,
            letterSpacing: "2px",
          }}
        >
          pgsql-hackers
        </div>
        {/* Main monogram */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: "#00ff41",
            letterSpacing: "-4px",
            lineHeight: 1,
          }}
        >
          PG
        </div>
        {/* Blinking cursor bar */}
        <div
          style={{
            width: 32,
            height: 4,
            background: "#00ff41",
            marginTop: 4,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
