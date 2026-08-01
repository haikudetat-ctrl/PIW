import { expect, test } from "vitest";
import { createPropertyIdentityProviderRegistry } from "./property-identity-registry";

test("resolves Google as the paid address-validation provider", () => {
  process.env.PAID_PROVIDERS_ENABLED = "true";
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  const registry = createPropertyIdentityProviderRegistry();

  expect(registry.resolve("address.validate").id).toBe("google-places");
  delete process.env.GOOGLE_MAPS_API_KEY;
  process.env.PAID_PROVIDERS_ENABLED = "false";
});
