"use client";

import dynamic from "next/dynamic";

export const RoofPlaneMap = dynamic(() => import("./roof-plane-map"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full min-h-[28rem] place-items-center bg-slate-100 text-sm text-slate-500">Loading NJGIN aerial…</div>
  ),
});
