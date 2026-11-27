"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {Fragment, useEffect, useMemo, useRef, useState} from "react";
import {MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents} from "react-leaflet";
import {NJGIN_AERIAL_ATTRIBUTION, NJGIN_AERIAL_TILE_URL, NJGIN_MAX_NATIVE_ZOOM} from "@/components/parcel-map";
import {NJ_2025_MAX_NATIVE_ZOOM, NJ_2025_MIN_NATIVE_ZOOM, type NjImageryLayer} from "@/modules/roof-measure/nj-ortho";
import {roofEdgeKindLabels, toLocal, type LatLng, type RoofEdge, type RoofPlane} from "@/domain/roof-drawing";
import {cornerLetter} from "@/domain/roof-plane-edit";
import {edgeKindColors} from "@/modules/roof-measure/edge-colors";
import type {MeasureAction, MeasureMode} from "@/modules/roof-measure/measure-state";

// Loaded only in the browser (see roof-plane-map-loader.tsx): Leaflet needs window.

const vertexIcon = L.divIcon({
  className: "piw-roof-vertex",
  html: '<span style="display:block;width:12px;height:12px;background:#fff;border:2px solid #0f172a;box-shadow:0 1px 3px rgba(0,0,0,.5)"></span>',
  iconAnchor: [6, 6],
});

const midpointIcon = L.divIcon({
  className: "piw-roof-midpoint",
  html: '<span style="display:grid;place-items:center;width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.85);border:1px solid #0f172a;font:700 11px/1 sans-serif;color:#0f172a">+</span>',
  iconAnchor: [7, 7],
});

const draftIcon = L.divIcon({
  className: "piw-roof-draft",
  html: '<span style="display:block;width:10px;height:10px;border-radius:50%;background:#facc15;border:2px solid #0f172a"></span>',
  iconAnchor: [5, 5],
});

const moveIcon = L.divIcon({
  className: "piw-roof-move",
  html: '<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#facc15;border:2px solid #0f172a;font:700 13px/1 sans-serif;color:#0f172a;cursor:move">&#x2725;</span>',
  iconAnchor: [11, 11],
});

const snapIcon = L.divIcon({
  className: "piw-roof-snap",
  html: '<span style="display:block;width:16px;height:16px;border:2px solid #22d3ee;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></span>',
  iconAnchor: [8, 8],
});

// Rendered by PIW from the state's 2025 files (see nj-ortho-tiles.ts). Below
// zoom 18 only the 2020 layer shows; tiles outside the 2025 files 404 and the
// 2020 layer shows through.
const NJ_2025_TILE_URL = "/api/roof-measure/imagery/nj-2025/{z}/{x}/{y}.jpg";
const NJ_2025_ATTRIBUTION = 'Aerial imagery &copy; <a href="https://www.nj.gov/njgin/edata/imagery/">NJ Office of GIS</a> (2025)';

/** Average of a plane's corners: where its move handle sits. */
function planeCentre(plane: RoofPlane): LatLng {
  const n = plane.vertices.length;
  return {
    lat: plane.vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / n,
    lng: plane.vertices.reduce((sum, vertex) => sum + vertex.lng, 0) / n,
  };
}

const toTuple = (point: LatLng): [number, number] => [point.lat, point.lng];

function MapClicks({mode, dispatch, onPointer}: {mode: MeasureMode; dispatch: (action: MeasureAction) => void; onPointer: (at: LatLng | null) => void}) {
  const map = useMapEvents({
    click(event) {
      if (mode !== "edit") dispatch({type: "addDraftPoint", at: {lat: event.latlng.lat, lng: event.latlng.lng}});
      else dispatch({type: "selectPlane", planeId: null});
    },
    mousemove(event) {
      if (mode === "cut") onPointer({lat: event.latlng.lat, lng: event.latlng.lng});
    },
    dblclick() {
      if (mode === "draw") dispatch({type: "finishDraw"});
    },
  });
  // MapContainer reads doubleClickZoom only once, so toggle it here: in draw
  // mode a double-click finishes the plane instead of zooming.
  useEffect(() => {
    if (mode === "draw") map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [map, mode]);
  return null;
}

export type RoofPlaneMapProps = {
  center: LatLng;
  planes: RoofPlane[];
  edges: RoofEdge[];
  selectedPlaneId: string | null;
  selectedEdgeId: string | null;
  mode: MeasureMode;
  draft: LatLng[];
  showPlaneFill: boolean;
  dispatch: (action: MeasureAction) => void;
  /** Aerial under the planes. The 2020 layer always sits underneath as the fallback. */
  imagery?: NjImageryLayer;
  /** Where a corner dragged to `to` would snap, for the live square marker. */
  previewSnap?: (planeId: string, index: number, to: LatLng) => {point: LatLng; snapped: boolean};
};

export default function RoofPlaneMap({center, planes, edges, selectedPlaneId, selectedEdgeId, mode, draft, showPlaneFill, dispatch, previewSnap, imagery = "nj2025"}: RoofPlaneMapProps) {
  const selected = useMemo(() => planes.find((plane) => plane.id === selectedPlaneId) ?? null, [planes, selectedPlaneId]);
  // Alt (Option) held while dragging turns snapping off.
  const freeDrag = useRef(false);
  const [snapHint, setSnapHint] = useState<LatLng | null>(null);
  const [pointer, setPointer] = useState<LatLng | null>(null);
  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      freeDrag.current = event.altKey;
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
    };
  }, []);

  return (
    <MapContainer
      center={toTuple(center)}
      zoom={20}
      maxZoom={23}
      scrollWheelZoom
      className="h-full min-h-[28rem] w-full"
    >
      <TileLayer attribution={NJGIN_AERIAL_ATTRIBUTION} url={NJGIN_AERIAL_TILE_URL} maxNativeZoom={NJGIN_MAX_NATIVE_ZOOM} maxZoom={23} keepBuffer={4} />
      {imagery === "nj2025" ? (
        <TileLayer
          attribution={NJ_2025_ATTRIBUTION}
          url={NJ_2025_TILE_URL}
          minZoom={NJ_2025_MIN_NATIVE_ZOOM - 1}
          minNativeZoom={NJ_2025_MIN_NATIVE_ZOOM}
          maxNativeZoom={NJ_2025_MAX_NATIVE_ZOOM}
          maxZoom={23}
          keepBuffer={2}
        />
      ) : null}
      <MapClicks mode={mode} dispatch={dispatch} onPointer={setPointer} />
      {planes.map((plane) => (
        <Polygon
          key={plane.id}
          positions={plane.vertices.map(toTuple)}
          pathOptions={{
            color: plane.id === selectedPlaneId ? "#facc15" : "#ffffff",
            weight: plane.id === selectedPlaneId ? 2 : 1,
            dashArray: plane.source === "solar" ? "4 4" : undefined,
            fillColor: plane.source === "solar" ? "#f59e0b" : "#38bdf8",
            fillOpacity: showPlaneFill ? (plane.id === selectedPlaneId ? 0.35 : 0.18) : 0,
          }}
          eventHandlers={{
            click(event) {
              if (mode !== "edit") return;
              L.DomEvent.stopPropagation(event);
              dispatch({type: "selectPlane", planeId: plane.id});
            },
          }}
        />
      ))}
      {edges.map((edge) => (
        <Polyline
          key={edge.id}
          positions={[toTuple(edge.start), toTuple(edge.end)]}
          pathOptions={{
            color: edgeKindColors[edge.kind],
            weight: edge.id === selectedEdgeId ? 7 : 4,
            dashArray: edge.needsReview ? "6 6" : undefined,
          }}
          eventHandlers={{
            click(event) {
              if (mode !== "edit") return;
              L.DomEvent.stopPropagation(event);
              dispatch({type: "selectEdge", edgeId: edge.id});
            },
          }}
        >
          <Tooltip sticky>{`${roofEdgeKindLabels[edge.kind]} · ${edge.trueLengthFt.toFixed(1)} ft${edge.needsReview ? " · check" : ""}`}</Tooltip>
        </Polyline>
      ))}
      {selected && mode === "edit" ? selected.vertices.map((vertex, index) => {
        const next = selected.vertices[(index + 1) % selected.vertices.length];
        const mid = {lat: (vertex.lat + next.lat) / 2, lng: (vertex.lng + next.lng) / 2};
        return (
          <Fragment key={`${selected.id}-${index}-${vertex.lat}-${vertex.lng}`}>
            <Marker
              position={toTuple(vertex)}
              icon={vertexIcon}
              draggable
              title={`Corner ${cornerLetter(index)}: drag to move, right-click to delete.`}
              eventHandlers={{
                drag(event) {
                  if (!previewSnap) return;
                  const at = (event.target as L.Marker).getLatLng();
                  const free = freeDrag.current || Boolean((event as unknown as {originalEvent?: MouseEvent}).originalEvent?.altKey);
                  const hint = free ? null : previewSnap(selected.id, index, {lat: at.lat, lng: at.lng});
                  setSnapHint(hint?.snapped ? hint.point : null);
                },
                dragend(event) {
                  const at = (event.target as L.Marker).getLatLng();
                  setSnapHint(null);
                  dispatch({type: "moveVertex", planeId: selected.id, index, to: {lat: at.lat, lng: at.lng}, snap: !freeDrag.current});
                },
                contextmenu() {
                  dispatch({type: "deleteVertex", planeId: selected.id, index});
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -6]} className="piw-corner-label">{cornerLetter(index)}</Tooltip>
            </Marker>
            <Marker
              position={toTuple(mid)}
              icon={midpointIcon}
              title="Add a corner here"
              eventHandlers={{click: () => dispatch({type: "insertVertex", planeId: selected.id, afterIndex: index, at: mid})}}
            />
          </Fragment>
        );
      }) : null}
      {selected && mode === "edit" ? (
        <Marker
          key={`move-${selected.id}-${planeCentre(selected).lat}-${planeCentre(selected).lng}`}
          position={toTuple(planeCentre(selected))}
          icon={moveIcon}
          draggable
          title="Drag to move the whole plane (hold Alt to leave joined planes behind). Arrow keys nudge it."
          eventHandlers={{
            dragend(event) {
              const at = (event.target as L.Marker).getLatLng();
              const offset = toLocal(planeCentre(selected), {lat: at.lat, lng: at.lng});
              dispatch({type: "movePlane", planeId: selected.id, east: offset.x, north: offset.y, carry: !freeDrag.current});
            },
          }}
        />
      ) : null}
      {snapHint ? <Marker position={toTuple(snapHint)} icon={snapIcon} interactive={false} /> : null}
      {mode === "cut" && draft.length === 1 && pointer ? (
        <Polyline positions={[toTuple(draft[0]), toTuple(pointer)]} pathOptions={{color: "#f43f5e", weight: 2, dashArray: "6 4"}} interactive={false} />
      ) : null}
      {draft.length > 0 ? (
        <>
          <Polyline positions={draft.map(toTuple)} pathOptions={{color: "#facc15", weight: 2, dashArray: "4 4"}} />
          {draft.map((point, index) => (
            <Marker key={`draft-${index}`} position={toTuple(point)} icon={draftIcon} interactive={false} />
          ))}
        </>
      ) : null}
    </MapContainer>
  );
}
