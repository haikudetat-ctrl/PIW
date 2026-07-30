"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useState } from "react";
import type * as Leaflet from "leaflet";
import type * as ReactLeaflet from "react-leaflet";

export type ParcelMapCandidate = {
  geometry: unknown;
  label: string;
  latitude?: number | null;
  longitude?: number | null;
};

function isGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "Polygon" ||
    type === "MultiPolygon" ||
    type === "Point" ||
    type === "MultiPoint" ||
    type === "LineString" ||
    type === "MultiLineString" ||
    type === "GeometryCollection"
  );
}

export function ParcelMap({
  candidates,
}: {
  candidates: ParcelMapCandidate[];
}) {
  const [leaflet, setLeaflet] = useState<typeof Leaflet | null>(null);
  const [reactLeaflet, setReactLeaflet] =
    useState<typeof ReactLeaflet | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([import("leaflet"), import("react-leaflet")]).then(
      ([leafletModule, reactLeafletModule]) => {
        if (!active) return;
        setLeaflet(leafletModule);
        setReactLeaflet(reactLeafletModule);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const visibleCandidates = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          isGeometry(candidate.geometry) ||
          (typeof candidate.latitude === "number" &&
            typeof candidate.longitude === "number"),
      ),
    [candidates],
  );

  if (visibleCandidates.length === 0) {
    return (
      <div
        role="region"
        aria-label="Parcel candidate map"
        className="grid min-h-56 place-items-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
      >
        No map geometry is available for this review task.
      </div>
    );
  }

  if (!leaflet || !reactLeaflet) {
    return (
      <div
        role="region"
        aria-label="Parcel candidate map"
        aria-busy="true"
        className="grid min-h-72 place-items-center rounded-lg border border-neutral-200 bg-neutral-100 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
      >
        Loading parcel map…
      </div>
    );
  }

  const { MapContainer, TileLayer, GeoJSON, Marker, Popup } = reactLeaflet;
  const markerIcon = leaflet.divIcon({
    className: "piw-map-marker",
    html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:#1d4ed8;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>',
    iconAnchor: [7, 7],
  });
  const pointCandidate = visibleCandidates.find(
    (candidate) =>
      typeof candidate.latitude === "number" &&
      typeof candidate.longitude === "number",
  );
  const center: [number, number] = pointCandidate
    ? [pointCandidate.latitude as number, pointCandidate.longitude as number]
    : [40.15, -74.65];

  return (
    <div
      role="region"
      aria-label="Parcel candidate map"
      className="overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
    >
      <MapContainer
        center={center}
        zoom={pointCandidate ? 17 : 8}
        scrollWheelZoom={false}
        className="h-80 w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {visibleCandidates.map((candidate, index) => (
          <Fragment key={`${candidate.label}-${index}`}>
            {isGeometry(candidate.geometry) ? (
              <GeoJSON
                data={candidate.geometry}
                style={{
                  color: index === 0 ? "#1d4ed8" : "#b45309",
                  fillOpacity: 0.2,
                  weight: 3,
                }}
              />
            ) : null}
            {typeof candidate.latitude === "number" &&
            typeof candidate.longitude === "number" ? (
              <Marker
                position={[candidate.latitude, candidate.longitude]}
                icon={markerIcon}
              >
                <Popup>{candidate.label}</Popup>
              </Marker>
            ) : null}
          </Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
