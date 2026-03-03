"use client";

/**
 * ScanlineOverlay — fixed CRT scanline effect over entire page.
 * Already handled by CSS body::before, but this component adds
 * a subtle vignette effect via a React-managed overlay.
 */
export default function ScanlineOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9998]"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)",
      }}
    />
  );
}
