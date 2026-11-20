"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SIGNATURE_BOX, signaturePath, type SignaturePoint } from "@/domain/closeouts";

// Finger or mouse signature. Strokes are kept in the signature box's own
// 600×200 units, whatever size the canvas is drawn at, and handed to the
// form as an SVG path.
export function SignaturePad({ name, onChange }: { name: string; onChange?: (path: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<SignaturePoint[][]>([]);
  const drawing = useRef(false);
  const [path, setPath] = useState("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / SIGNATURE_BOX.width;
    const scaleY = canvas.height / SIGNATURE_BOX.height;
    context.lineWidth = 3 * ratio;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#182019";
    for (const stroke of strokes.current) {
      context.beginPath();
      stroke.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (stroke.length === 1) context.lineTo(stroke[0].x * scaleX + 0.1, stroke[0].y * scaleY);
      context.stroke();
    }
  }, []);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  function toBox(event: React.PointerEvent<HTMLCanvasElement>): SignaturePoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * SIGNATURE_BOX.width,
      y: ((event.clientY - rect.top) / rect.height) * SIGNATURE_BOX.height,
    };
  }

  function publish() {
    const next = signaturePath(strokes.current);
    setPath(next);
    onChange?.(next);
  }

  function clear() {
    strokes.current = [];
    redraw();
    publish();
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature area. Sign with your finger or mouse."
          role="img"
          className="block aspect-[3/1] w-full touch-none rounded-xl border border-border-strong bg-white"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = true;
            strokes.current.push([toBox(event)]);
            redraw();
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            strokes.current[strokes.current.length - 1]?.push(toBox(event));
            redraw();
          }}
          onPointerUp={() => {
            drawing.current = false;
            publish();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            publish();
          }}
        />
        <span aria-hidden className="pointer-events-none absolute right-6 bottom-6 left-6 border-b border-dashed border-border-strong" />
        {path === "" ? (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-subtle">
            Sign here
          </span>
        ) : null}
      </div>
      <input type="hidden" name={name} value={path} />
      <button type="button" onClick={clear} className="mt-2 text-[13px] font-medium text-tint hover:underline">
        Clear signature
      </button>
    </div>
  );
}
