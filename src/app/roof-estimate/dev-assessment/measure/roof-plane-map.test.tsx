import {render} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";
import {computeRoofEdges, degreesFromPitchRise, toLatLng, type RoofPlane} from "@/domain/roof-drawing";
import RoofPlaneMap from "./roof-plane-map";

const origin = {lat: 40.35, lng: -74.07};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const planes: RoofPlane[] = [
  {id: "a", vertices: [at(-5, 0), at(5, 0), at(5, 4), at(-5, 4)], pitchDegrees: degreesFromPitchRise(6), azimuthDegrees: 0, source: "solar", solarSlopedAreaSqft: 480},
  {id: "b", vertices: [at(-5, -4), at(5, -4), at(5, 0), at(-5, 0)], pitchDegrees: degreesFromPitchRise(6), azimuthDegrees: 180, source: "adjusted", solarSlopedAreaSqft: 480},
];

describe("roof plane map", () => {
  test("renders planes, edges, the selected plane's corner handles and a draft in Leaflet", () => {
    const dispatch = vi.fn();
    const {container} = render(
      <div style={{width: 800, height: 600}}>
        <RoofPlaneMap
          center={origin}
          planes={planes}
          edges={computeRoofEdges(origin, planes)}
          selectedPlaneId="a"
          selectedEdgeId={null}
          mode="edit"
          draft={[at(10, 0), at(12, 0)]}
          showPlaneFill
          dispatch={dispatch}
        />
      </div>,
    );
    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    // Four corners and four midpoints for the selected plane, two draft dots.
    expect(container.querySelectorAll(".piw-roof-vertex")).toHaveLength(4);
    expect(container.querySelectorAll(".piw-roof-midpoint")).toHaveLength(4);
    expect(container.querySelectorAll(".piw-roof-draft")).toHaveLength(2);
  });
});
