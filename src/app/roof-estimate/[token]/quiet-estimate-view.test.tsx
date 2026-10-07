import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { QuietEstimateView } from "./quiet-estimate-view";
import { QuoteLoadingView } from "./quote-loading-view";

vi.mock("./property-satellite-image", () => ({
  PropertySatelliteImage: ({address}: {address: string}) => <div data-testid="satellite">{address}</div>,
}));

const token = "11111111-1111-4111-8111-111111111111";
const brand = {
  name: "All Season Solar",
  logoUrl: "https://estimate.example.com/brand/all-season-mark.svg",
  phoneDisplay: "(888) 832-5050",
  phoneHref: "tel:+18888325050",
};

describe("quiet price-first estimate", () => {
  test("shows the range, roof facts, call link, refine link and Google attribution", () => {
    render(
      <QuietEstimateView
        token={token}
        address="1 Main St, Newark, NJ"
        brand={brand}
        state={{kind: "ready", lowCents: 1_200_000, highCents: 1_800_000, roofSquares: 24}}
      />,
    );
    expect(screen.getByAltText("All Season Solar").getAttribute("src")).toBe(brand.logoUrl);
    expect(screen.getByRole("heading", {name: "Your range is ready."})).toBeTruthy();
    expect(screen.getByText(/\$12,000/).textContent).toContain("$18,000");
    expect(screen.getByText("24.0 squares")).toBeTruthy();
    expect(screen.getByRole("link", {name: "Talk with a roofing specialist"}).getAttribute("href")).toBe(brand.phoneHref);
    expect(screen.getByRole("link", {name: "Refine your estimate with 6 quick questions"}).getAttribute("href"))
      .toBe(`/roof-estimate/${token}?refine=1`);
    expect(screen.getByText("Satellite imagery from Google Maps")).toBeTruthy();
  });

  test("explains a professional review without a price", () => {
    render(<QuietEstimateView token={token} address="1 Main St" brand={brand} state={{kind: "review"}} />);
    expect(screen.getByRole("heading", {name: "We are checking the property match."})).toBeTruthy();
    expect(screen.getByRole("link", {name: "Call (888) 832-5050"})).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  test("still offers refinement when no instant range exists", () => {
    render(<QuietEstimateView token={token} address="1 Main St" brand={brand} state={{kind: "received"}} />);
    expect(screen.getByRole("heading", {name: "Your request is with our team."})).toBeTruthy();
    expect(screen.getByRole("link", {name: "Refine your estimate with 6 quick questions"})).toBeTruthy();
  });
});

describe("quiet quote loading", () => {
  test("shows the brand name and progress for the address when there is no logo", () => {
    render(<QuoteLoadingView brand={{...brand, logoUrl: undefined}} address="1 Main St, Newark, NJ" />);
    expect(screen.getByText("ALL SEASON SOLAR")).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Preparing your estimate."})).toBeTruthy();
    expect(screen.getByText(/1 Main St, Newark, NJ/)).toBeTruthy();
    expect(screen.getByText("Roof measurement").closest("li")?.getAttribute("data-active")).toBe("true");
  });
});
