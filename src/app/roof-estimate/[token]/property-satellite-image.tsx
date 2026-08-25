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
      <div className="campaign-property-media-state">
        <div className="campaign-property-media-message">
          <p className="campaign-property-media-heading">Property imagery is temporarily unavailable.</p>
          <p>
            Your request is saved, and our roofing team can continue reviewing the property.
          </p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="campaign-property-media-link"
          >
            Open Google Maps
          </a>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="campaign-property-media-state estimate-map-skeleton">
        <p className="campaign-property-loading-label">
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
      className="campaign-property-image estimate-reveal"
    />
  );
}
