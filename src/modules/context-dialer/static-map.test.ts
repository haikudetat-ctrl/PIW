import { describe, expect, it } from "vitest";
import { buildGoogleSatelliteUrl } from "./static-map";

describe("buildGoogleSatelliteUrl", () => {
  it("requests a high-resolution satellite view centered on the validated property", () => {
    const url = buildGoogleSatelliteUrl({
      latitude: 40.339484,
      longitude: -74.674807,
      apiKey: "server-only-key",
    });

    expect(url.origin).toBe("https://maps.googleapis.com");
    expect(url.pathname).toBe("/maps/api/staticmap");
    expect(url.searchParams.get("center")).toBe("40.339484,-74.674807");
    expect(url.searchParams.get("maptype")).toBe("satellite");
    expect(url.searchParams.get("scale")).toBe("2");
    expect(url.searchParams.get("key")).toBe("server-only-key");
  });
});
