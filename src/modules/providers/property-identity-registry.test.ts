import { expect, test } from "vitest";
import { createPropertyIdentityProviderRegistry } from "./property-identity-registry";

test("resolves the free Census adapter for address validation and NJGIN for parcel lookup", () => {
  const registry = createPropertyIdentityProviderRegistry();

  expect(registry.resolve("address.validate").id).toBe("census-geocoder");
  expect(registry.resolve("parcel.lookup").id).toBe("njgin-parcel-lookup");
});
