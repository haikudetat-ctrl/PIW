import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

test("service client module declares a server-only boundary", async () => {
  const serviceModule = await import("./service");
  expect(serviceModule.createServiceClient).toBeTypeOf("function");
});
