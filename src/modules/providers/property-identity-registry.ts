import { censusGeocodeAddressValidationProvider } from "./adapters/census-geocode";
import { njginParcelLookupProvider } from "./adapters/njgin-parcel-lookup";
import { ProviderRegistry } from "./registry";

export function createPropertyIdentityProviderRegistry() {
  return new ProviderRegistry([
    censusGeocodeAddressValidationProvider,
    njginParcelLookupProvider,
  ]);
}
