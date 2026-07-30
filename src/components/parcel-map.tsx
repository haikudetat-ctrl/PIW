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

type Position = [longitude: number, latitude: number];
type MapBounds = [
  southWest: [latitude: number, longitude: number],
  northEast: [latitude: number, longitude: number],
];

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

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function geometryPositions(geometry: GeoJSON.Geometry): Position[] {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(geometryPositions);
  }

  const positions: Position[] = [];
  const visit = (value: unknown) => {
    if (isPosition(value)) {
      positions.push([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return positions;
}

function pointPosition(
  candidate: ParcelMapCandidate,
): Position | null {
  return isPosition([candidate.longitude, candidate.latitude])
    ? [candidate.longitude as number, candidate.latitude as number]
    : null;
}

function positionsFor(candidate: ParcelMapCandidate): Position[] {
  const positions =
    isGeometry(candidate.geometry) ? geometryPositions(candidate.geometry) : [];
  const point = pointPosition(candidate);
  if (point) positions.push(point);
  return positions;
}

function boundsFor(candidates: ParcelMapCandidate[]): MapBounds {
  const positions = candidates.flatMap(positionsFor);
  let west = Math.min(...positions.map(([longitude]) => longitude));
  let east = Math.max(...positions.map(([longitude]) => longitude));
  let south = Math.min(...positions.map(([, latitude]) => latitude));
  let north = Math.max(...positions.map(([, latitude]) => latitude));

  // A zero-area point needs a small box so fitBounds can choose a useful
  // street-level view instead of an unbounded zoom.
  if (west === east) {
    west = Number((west - 0.001).toFixed(6));
    east = Number((east + 0.001).toFixed(6));
  }
  if (south === north) {
    south = Number((south - 0.001).toFixed(6));
    north = Number((north + 0.001).toFixed(6));
  }

  return [
    [south, west],
    [north, east],
  ];
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
    () => candidates.filter((candidate) => positionsFor(candidate).length > 0),
    [candidates],
  );
  const bounds = useMemo(
    () =>
      visibleCandidates.length > 0 ? boundsFor(visibleCandidates) : null,
    [visibleCandidates],
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
  return (
    <div
      role="region"
      aria-label="Parcel candidate map"
      className="overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
    >
      <MapContainer
        bounds={bounds!}
        boundsOptions={{ padding: [24, 24], maxZoom: 18 }}
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
              >
                <Popup>{candidate.label}</Popup>
              </GeoJSON>
            ) : null}
            {pointPosition(candidate) ? (
              <Marker
                position={[
                  candidate.latitude as number,
                  candidate.longitude as number,
                ]}
                icon={markerIcon}
              >
                <Popup>{candidate.label}</Popup>
              </Marker>
            ) : null}
          </Fragment>
        ))}
      </MapContainer>
      <ul
        aria-label="Mapped candidates"
        className="grid gap-2 border-t border-neutral-200 bg-white p-3 text-sm sm:grid-cols-2 dark:border-neutral-800 dark:bg-neutral-950"
      >
        {visibleCandidates.map((candidate, index) => {
          const hasBoundary = isGeometry(candidate.geometry);
          const hasPoint = pointPosition(candidate) !== null;
          return (
            <li
              key={`${candidate.label}-legend-${index}`}
              className="flex items-start gap-2"
            >
              <span
                aria-hidden="true"
                className="mt-1 block size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: index === 0 ? "#1d4ed8" : "#b45309",
                }}
              />
              <span>
                <span className="font-medium">{candidate.label}</span>
                <span className="block text-xs text-neutral-500">
                  {hasBoundary && hasPoint
                    ? "Parcel boundary and address point"
                    : hasBoundary
                      ? "Parcel boundary"
                      : "Address point"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
