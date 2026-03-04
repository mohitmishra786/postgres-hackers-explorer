import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// 32×32 favicon — dark terminal bg, bright green "PG" in monospace box
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          border: "2px solid #00ff41",
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          fontWeight: 800,
          fontSize: 14,
          color: "#00ff41",
          letterSpacing: "-1px",
        }}
      >
        PG
      </div>
    ),
    { ...size }
  );
}
