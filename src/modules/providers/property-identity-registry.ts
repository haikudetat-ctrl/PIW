import { createGoogleGeocodingProvider } from "./adapters/google-geocoding";
import { ProviderRegistry } from "./registry";

export function createPropertyIdentityProviderRegistry() {
  const paidProvidersEnabled = process.env.PAID_PROVIDERS_ENABLED === "true";
  return new ProviderRegistry([
    createGoogleGeocodingProvider({
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      enabled: paidProvidersEnabled && Boolean(process.env.GOOGLE_MAPS_API_KEY),
    }),
  ]);
}
