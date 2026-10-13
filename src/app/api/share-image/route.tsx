import {ImageResponse} from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div style={{display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#f6f4ef", color: "#0f2a4a", padding: "72px", fontFamily: "sans-serif"}}>
      <div style={{display: "flex", fontSize: 28, letterSpacing: 4}}>PROPERTY INTELLIGENCE WORKER</div>
      <div style={{display: "flex", flexDirection: "column", gap: 20}}>
        <div style={{display: "flex", fontSize: 140, fontWeight: 700, letterSpacing: -6}}>Rake</div>
        <div style={{display: "flex", fontSize: 34}}>Property intelligence. Roofing operations.</div>
      </div>
      <div style={{display: "flex", fontSize: 26, borderTop: "2px solid #d3cec0", paddingTop: 24}}>rake.2-stack.com</div>
    </div>,
    {width: 1200, height: 630},
  );
}
