"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {Fragment, useEffect, useMemo} from "react";
import {MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMapEvents} from "react-leaflet";
import {NJGIN_AERIAL_ATTRIBUTION, NJGIN_AERIAL_TILE_URL} from "@/components/parcel-map";
import {roofEdgeKindLabels, type LatLng, type RoofEdge, type RoofPlane} from "@/domain/roof-drawing";
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

const toTuple = (point: LatLng): [number, number] => [point.lat, point.lng];

function MapClicks({mode, dispatch}: {mode: MeasureMode; dispatch: (action: MeasureAction) => void}) {
  const map = useMapEvents({
    click(event) {
      if (mode === "draw") dispatch({type: "addDraftPoint", at: {lat: event.latlng.lat, lng: event.latlng.lng}});
      else dispatch({type: "selectPlane", planeId: null});
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
};

export default function RoofPlaneMap({center, planes, edges, selectedPlaneId, selectedEdgeId, mode, draft, showPlaneFill, dispatch}: RoofPlaneMapProps) {
  const selected = useMemo(() => planes.find((plane) => plane.id === selectedPlaneId) ?? null, [planes, selectedPlaneId]);

  return (
    <MapContainer
      center={toTuple(center)}
      zoom={20}
      maxZoom={23}
      scrollWheelZoom
      className="h-full min-h-[28rem] w-full"
    >
      <TileLayer attribution={NJGIN_AERIAL_ATTRIBUTION} url={NJGIN_AERIAL_TILE_URL} maxNativeZoom={23} maxZoom={23} />
      <MapClicks mode={mode} dispatch={dispatch} />
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
              if (mode === "draw") return;
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
              if (mode === "draw") return;
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
              title="Drag to move. Right-click to delete this corner."
              eventHandlers={{
                dragend(event) {
                  const at = (event.target as L.Marker).getLatLng();
                  dispatch({type: "moveVertex", planeId: selected.id, index, to: {lat: at.lat, lng: at.lng}, snap: true});
                },
                contextmenu() {
                  dispatch({type: "deleteVertex", planeId: selected.id, index});
                },
              }}
            />
            <Marker
              position={toTuple(mid)}
              icon={midpointIcon}
              title="Add a corner here"
              eventHandlers={{click: () => dispatch({type: "insertVertex", planeId: selected.id, afterIndex: index, at: mid})}}
            />
          </Fragment>
        );
      }) : null}
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
