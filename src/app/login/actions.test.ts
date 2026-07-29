import { expect, test } from "vitest";
import { loginInputSchema } from "./actions";

test("requires a valid email and nonempty password", () => {
  expect(() =>
    loginInputSchema.parse({ email: "invalid", password: "" }),
  ).toThrow();
  expect(
    loginInputSchema.parse({
      email: "admin@example.com",
      password: "correct horse battery staple",
    }),
  ).toEqual({
    email: "admin@example.com",
    password: "correct horse battery staple",
  });
});
