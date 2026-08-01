import { createGooglePlacesProvider } from "./adapters/google-places";
import { ProviderRegistry } from "./registry";

export function createPropertyIdentityProviderRegistry() {
  const paidProvidersEnabled = process.env.PAID_PROVIDERS_ENABLED === "true";
  return new ProviderRegistry([
    createGooglePlacesProvider({
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      enabled: paidProvidersEnabled && Boolean(process.env.GOOGLE_MAPS_API_KEY),
    }),
  ]);
}
