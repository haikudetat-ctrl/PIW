import { expect, test } from "vitest";
import { sanitizeAuditMetadata } from "./write-audit-entry";

test("redacts lead contact fields recursively", () => {
  expect(
    sanitizeAuditMetadata({
      email: "person@example.com",
      nested: { phone: "555-555-5555", status: "received" },
    }),
  ).toEqual({
    email: "[REDACTED]",
    nested: { phone: "[REDACTED]", status: "received" },
  });
});

test("redacts sensitive keys case-insensitively at every level", () => {
  expect(
    sanitizeAuditMetadata({
      Email: "person@example.com",
      Token: "abc123",
      raw_payload: { foo: "bar" },
      details: { Authorization: "Bearer xyz", secret: "shh", name: "Chris" },
      count: 3,
    }),
  ).toEqual({
    Email: "[REDACTED]",
    Token: "[REDACTED]",
    raw_payload: "[REDACTED]",
    details: { Authorization: "[REDACTED]", secret: "[REDACTED]", name: "[REDACTED]" },
    count: 3,
  });
});
