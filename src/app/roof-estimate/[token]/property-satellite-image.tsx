"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function PropertySatelliteImage({
  src,
  address,
}: {
  src: string;
  address: string;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; objectUrl: string } | { status: "unavailable" }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
          throw new Error("Satellite image unavailable");
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setState({ status: "ready", objectUrl });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (state.status === "unavailable") {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    return (
      <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_30%,#315b68_0_12%,transparent_13%),radial-gradient(circle_at_72%_64%,#274955_0_17%,transparent_18%),#17333d] p-8 text-center">
        <div className="max-w-sm rounded-2xl border border-white/10 bg-slate-950/60 p-6 backdrop-blur-md">
          <p className="text-base font-semibold text-white">Property imagery is temporarily unavailable.</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Your measurement and price range are saved. You can still view the address in Google Maps.
          </p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-block rounded-2xl bg-white px-5 py-3 text-sm font-bold !text-slate-950 transition active:translate-y-px"
          >
            Open Google Maps
          </a>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="estimate-map-skeleton grid h-full place-items-center p-8 text-center">
        <p className="rounded-2xl border border-white/10 bg-slate-950/55 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md">
          Loading the satellite view
        </p>
      </div>
    );
  }

  return (
    <Image
      src={state.objectUrl}
      alt={`Satellite view of the roof at ${address}`}
      fill
      priority
      unoptimized
      sizes="(min-width: 1024px) 58vw, 100vw"
      className="object-cover"
    />
  );
}
