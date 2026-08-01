export function buildGoogleSatelliteUrl(input: {
  latitude: number;
  longitude: number;
  apiKey: string;
}) {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${input.latitude},${input.longitude}`);
  url.searchParams.set("zoom", "20");
  url.searchParams.set("size", "640x480");
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "satellite");
  url.searchParams.set("format", "jpg");
  url.searchParams.set("key", input.apiKey);
  return url;
}
