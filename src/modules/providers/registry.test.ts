import { expect, test } from "vitest";
import { ProviderRegistry, ProviderUnavailableError } from "./registry";

test("resolves the lowest-cost enabled provider for a capability", () => {
  const registry = new ProviderRegistry([
    { id: "premium", capability: "address.validate", priority: 20, enabled: true },
    { id: "public", capability: "address.validate", priority: 10, enabled: true },
  ]);
  expect(registry.resolve("address.validate").id).toBe("public");
});

test("throws when no adapter supports the capability", () => {
  const registry = new ProviderRegistry([
    { id: "premium", capability: "address.validate", priority: 20, enabled: true },
  ]);
  expect(() => registry.resolve("parcel.lookup")).toThrow(ProviderUnavailableError);
});

test("falls through a disabled public adapter to an enabled premium adapter", () => {
  const registry = new ProviderRegistry([
    { id: "public", capability: "address.validate", priority: 10, enabled: false },
    { id: "premium", capability: "address.validate", priority: 20, enabled: true },
  ]);
  expect(registry.resolve("address.validate").id).toBe("premium");
});

test("throws when every adapter for a capability is disabled", () => {
  const registry = new ProviderRegistry([
    { id: "public", capability: "address.validate", priority: 10, enabled: false },
  ]);
  expect(() => registry.resolve("address.validate")).toThrow(ProviderUnavailableError);
});
