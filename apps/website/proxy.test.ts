import {NextRequest} from "next/server";
import {describe, expect, test} from "vitest";
import proxy from "./proxy";

describe("public static page proxy", () => {
  test("rewrites HTML pages through the consent runtime shell", () => {
    const response = proxy(new NextRequest("https://allseason.example/service-areas/atlantic-county.html"));

    expect(response.headers.get("x-middleware-rewrite"))
      .toBe("https://allseason.example/public-pages/service-areas/atlantic-county.html");
  });

  test("leaves App Router campaign routes on their single React provider", () => {
    const response = proxy(new NextRequest("https://allseason.example/campaigns/seasonal-shield"));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
