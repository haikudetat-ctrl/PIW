import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("leaflet", () => ({
  divIcon: () => ({ kind: "test-map-marker" }),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({
    bounds,
    boundsOptions,
    children,
  }: {
    bounds?: [[number, number], [number, number]];
    boundsOptions?: { maxZoom: number };
    children: React.ReactNode;
  }) => (
    <div
      data-testid="leaflet-map"
      data-bounds={JSON.stringify(bounds)}
      data-max-zoom={boundsOptions?.maxZoom}
    >
      {children}
    </div>
  ),
  TileLayer: ({
    attribution,
    maxNativeZoom,
    maxZoom,
    url,
  }: {
    attribution: string;
    maxNativeZoom: number;
    maxZoom: number;
    url: string;
  }) => (
    <div
      data-testid="tile-layer"
      data-attribution={attribution}
      data-max-native-zoom={maxNativeZoom}
      data-max-zoom={maxZoom}
      data-url={url}
    />
  ),
  GeoJSON: ({
    data,
    children,
  }: {
    data: GeoJSON.Geometry;
    children: React.ReactNode;
  }) => (
    <div data-testid={`geojson-${data.type.toLowerCase()}`}>{children}</div>
  ),
  Marker: ({
    position,
    children,
  }: {
    position: [number, number];
    children: React.ReactNode;
  }) => (
    <div data-testid="map-marker" data-position={JSON.stringify(position)}>
      {children}
    </div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <span role="tooltip">{children}</span>
  ),
}));

const { ParcelMap } = await import("./parcel-map");

test("shows a loading state while the interactive map modules load", () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: null,
          label: "12 Birch Street",
          latitude: 40.22,
          longitude: -74.77,
        },
      ]}
    />,
  );

  expect(
    screen.getByRole("region", { name: "Parcel candidate map" }),
  ).toHaveAttribute("aria-busy", "true");
});

test("shows a useful empty state when no candidate has mappable evidence", () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: null,
          label: "Candidate without coordinates",
        },
      ]}
    />,
  );

  expect(
    screen.getByText("No map geometry is available for this review task."),
  ).toBeInTheDocument();
});

test("renders and fits a Polygon boundary", async () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-74.77, 40.22],
                [-74.76, 40.22],
                [-74.76, 40.23],
                [-74.77, 40.22],
              ],
            ],
          },
          label: "Block 10 · Lot 20",
        },
      ]}
    />,
  );

  await waitFor(() =>
    expect(screen.getByTestId("geojson-polygon")).toBeInTheDocument(),
  );
  expect(screen.getByTestId("leaflet-map")).toHaveAttribute(
    "data-bounds",
    JSON.stringify([
      [40.22, -74.77],
      [40.23, -74.76],
    ]),
  );
  expect(
    screen.getByRole("tooltip", { name: "Block 10 · Lot 20" }),
  ).toBeInTheDocument();
});

test("uses NJGIN aerial imagery and identifies its capture date", async () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: null,
          label: "12 Birch Street",
          latitude: 40.22,
          longitude: -74.77,
        },
      ]}
    />,
  );

  await waitFor(() =>
    expect(screen.getByTestId("tile-layer")).toBeInTheDocument(),
  );
  expect(screen.getByTestId("tile-layer")).toHaveAttribute(
    "data-url",
    "https://maps.nj.gov/arcgis/rest/services/Basemap/Orthos_Natural_2020_NJ_WM/MapServer/tile/{z}/{y}/{x}",
  );
  expect(screen.getByTestId("tile-layer")).toHaveAttribute(
    "data-max-native-zoom",
    "23",
  );
  expect(screen.getByTestId("tile-layer")).toHaveAttribute(
    "data-attribution",
    expect.stringContaining("NJ Office of GIS"),
  );
  expect(
    screen.getByText(/NJGIN aerial imagery was captured in 2020/i),
  ).toBeInTheDocument();
});

test("renders and fits every part of a MultiPolygon boundary", async () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-74.8, 40.1],
                  [-74.79, 40.1],
                  [-74.79, 40.11],
                  [-74.8, 40.1],
                ],
              ],
              [
                [
                  [-74.7, 40.3],
                  [-74.69, 40.3],
                  [-74.69, 40.31],
                  [-74.7, 40.3],
                ],
              ],
            ],
          },
          label: "Two-part parcel",
        },
      ]}
    />,
  );

  await waitFor(() =>
    expect(screen.getByTestId("geojson-multipolygon")).toBeInTheDocument(),
  );
  expect(screen.getByTestId("leaflet-map")).toHaveAttribute(
    "data-bounds",
    JSON.stringify([
      [40.1, -74.8],
      [40.31, -74.69],
    ]),
  );
});

test("renders and fits an address point without zooming past street level", async () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: null,
          label: "12 Birch Street",
          latitude: 40.22,
          longitude: -74.77,
        },
      ]}
    />,
  );

  await waitFor(() =>
    expect(screen.getByTestId("map-marker")).toBeInTheDocument(),
  );
  expect(screen.getByTestId("map-marker")).toHaveAttribute(
    "data-position",
    JSON.stringify([40.22, -74.77]),
  );
  expect(screen.getByTestId("leaflet-map")).toHaveAttribute(
    "data-bounds",
    JSON.stringify([
      [40.219, -74.771],
      [40.221, -74.769],
    ]),
  );
  expect(screen.getByTestId("leaflet-map")).toHaveAttribute(
    "data-max-zoom",
    "20",
  );
});

test("keeps every candidate label visible alongside its map popup", async () => {
  render(
    <ParcelMap
      candidates={[
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-74.77, 40.22],
                [-74.76, 40.22],
                [-74.76, 40.23],
                [-74.77, 40.22],
              ],
            ],
          },
          label: "Candidate 1 · Block 10 · Lot 20",
        },
        {
          geometry: null,
          label: "Candidate 2 · 14 Birch Street",
          latitude: 40.24,
          longitude: -74.75,
        },
      ]}
    />,
  );

  await waitFor(() =>
    expect(
      screen.getByRole("list", { name: "Mapped candidates" }),
    ).toBeInTheDocument(),
  );
  expect(
    screen.getByRole("list", { name: "Mapped candidates" }),
  ).toHaveTextContent("Candidate 1 · Block 10 · Lot 20");
  expect(
    screen.getByRole("list", { name: "Mapped candidates" }),
  ).toHaveTextContent("Candidate 2 · 14 Birch Street");
  expect(screen.getAllByRole("tooltip")).toHaveLength(2);
});
